const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const fs = require('fs');

// ─── Supabase Client ──────────────────────────────────────────────────────────
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// ─── Gemini Vision CAPTCHA Solver (thinkingBudget:0 = no wasted tokens) ──────
async function solveCaptchaWithGemini(imgPath, geminiKey) {
    const base64 = fs.readFileSync(imgPath).toString('base64');
    const body = JSON.stringify({
        contents: [{ parts: [
            { text: 'Read the CAPTCHA text in this image. Reply with ONLY the characters shown, no spaces, no explanation.' },
            { inline_data: { mime_type: 'image/png', data: base64 } }
        ]}],
        generationConfig: { temperature: 0, maxOutputTokens: 100, thinkingConfig: { thinkingBudget: 0 } }
    });

    return new Promise((resolve) => {
        const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`);
        const req = https.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    const solved = text.replace(/\s+/g, '').trim();
                    console.log(`  Gemini: "${solved}" (reason: ${json?.candidates?.[0]?.finishReason})`);
                    resolve(solved);
                } catch (e) { resolve(''); }
            });
        });
        req.on('error', () => resolve(''));
        req.write(body);
        req.end();
    });
}

// ─── Download CAPTCHA with session cookies ────────────────────────────────────
async function downloadCaptcha(url, cookies, path) {
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const file = fs.createWriteStream(path);
        https.get({ hostname: u.hostname, path: u.pathname + u.search,
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://services.ecourts.gov.in/', 'Cookie': cookieStr }
        }, res => { res.pipe(file); file.on('finish', () => { file.close(); resolve(); }); }).on('error', reject);
    });
}

// ─── Dismiss modal backdrop ───────────────────────────────────────────────────
async function dismissModal(page) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    await page.evaluate(() => {
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        document.querySelectorAll('.modal.show').forEach(el => { el.classList.remove('show'); el.style.display = 'none'; });
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
    });
    await page.waitForTimeout(200);
}

// ─── Parse extracted case text into structured data ───────────────────────────
function parseBodyText(text) {
    const extract = (patterns) => {
        for (const p of patterns) {
            const m = text.match(p);
            if (m) return m[1]?.trim() || null;
        }
        return null;
    };

    // Extract next hearing date
    const nextHearingRaw = extract([
        /Next Hearing Date\s+(\d{2}[a-z]{2}\s+\w+\s+\d{4})/i,
        /Next Hearing Date\s+([\d-]+)/i,
    ]);

    // Parse date to ISO format
    let nextHearing = null;
    if (nextHearingRaw) {
        const months = { January:'01', February:'02', March:'03', April:'04', May:'05', June:'06',
                         July:'07', August:'08', September:'09', October:'10', November:'11', December:'12' };
        // e.g. "01st August 2026"
        const dm = nextHearingRaw.match(/(\d+)\w*\s+(\w+)\s+(\d{4})/);
        if (dm) {
            const day = dm[1].padStart(2, '0');
            const month = months[dm[2]] || '01';
            nextHearing = `${dm[3]}-${month}-${day}`;
        } else {
            // e.g. "01-08-2026"
            const dm2 = nextHearingRaw.match(/(\d{2})-(\d{2})-(\d{4})/);
            if (dm2) nextHearing = `${dm2[3]}-${dm2[2]}-${dm2[1]}`;
        }
    }

    const caseStage   = extract([/Case Stage\s+([^\n]+)/i]);
    const petitioner  = extract([/\n1\)\s+([^\n]+)\n\s+Advocate/i, /\n1\)\s+([^\n]+)/]);
    const respondent  = extract([/Respondent[^\n]*\n1\)\s+([^\n]+)/i]);
    const judge       = extract([/Court Number and Judge\s+[^\n]*\n?([^\n]+)/i]);
    const actSection  = extract([/Under Section\(s\)\s*\n([^\n]+)/i]);

    // Extract full hearing history
    const historyLines = [];
    const historyRegex = /([A-Z\s,]+MAGISTRATE[^\t]*)\t(\d{2}-\d{2}-\d{4})\t(\d{2}-\d{2}-\d{4})\t([^\n]+)/gi;
    let m;
    while ((m = historyRegex.exec(text)) !== null) {
        historyLines.push({
            judge: m[1].trim(),
            businessOnDate: m[2].trim(),
            hearingDate: m[3].trim(),
            purpose: m[4].trim()
        });
    }

    return { nextHearing, caseStage, petitioner, respondent, judge, actSection, hearingHistory: historyLines };
}

// ─── Scrape a single CNR ──────────────────────────────────────────────────────
async function scrapeCase(page, cnr, geminiKey) {
    console.log(`\n  Scraping ${cnr}...`);

    await page.goto('https://services.ecourts.gov.in/ecourtindia_v6/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('#leftPaneMenuCnr', { timeout: 15000 });
    await page.evaluate(() => document.getElementById('leftPaneMenuCnr').click());
    await page.waitForSelector('#cnr_div', { state: 'visible', timeout: 10000 });
    await page.fill('#cino', cnr);

    for (let attempt = 1; attempt <= 6; attempt++) {
        await dismissModal(page);

        if (attempt > 1) {
            await page.evaluate(() => {
                const img = document.getElementById('captcha_image');
                img.src = img.src.split('?')[0] + '?' + Date.now();
            });
            await page.waitForTimeout(800);
        }

        const captchaUrl = await page.$eval('#captcha_image', el => el.src).catch(() => null);
        if (!captchaUrl) break;

        const cookies = await page.context().cookies();
        const imgPath = `captcha_${cnr}_${attempt}.png`;
        await downloadCaptcha(captchaUrl, cookies, imgPath);

        const solved = await solveCaptchaWithGemini(imgPath, geminiKey);
        fs.unlink(imgPath, () => {});

        if (!solved || solved.length < 4 || solved.length > 8) {
            console.log(`  Attempt ${attempt}: Invalid solve, retrying...`);
            continue;
        }

        await page.fill('#fcaptcha_code', '');
        await page.type('#fcaptcha_code', solved, { delay: 30 });
        await page.evaluate(() => document.getElementById('searchbtn').click());

        const outcome = await Promise.race([
            page.waitForSelector('#history_cnr', { state: 'visible', timeout: 12000 }).then(() => 'success'),
            page.waitForSelector('#caseBusinessDiv_cnr table', { state: 'visible', timeout: 12000 }).then(() => 'success'),
            page.waitForSelector('#validateError.show', { state: 'visible', timeout: 12000 }).then(() => 'error'),
            page.waitForSelector('#msg-danger', { state: 'visible', timeout: 12000 }).then(() => 'error'),
        ]).catch(() => 'timeout');

        if (outcome === 'success') {
            const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');
            return parseBodyText(bodyText);
        }

        if (outcome === 'error') {
            await dismissModal(page);
        }
    }

    return null;
}

// ─── Main runner ──────────────────────────────────────────────────────────────
async function run() {
    const GEMINI_KEY    = process.env.GEMINI_API_KEY;
    const SUPABASE_URL  = process.env.SUPABASE_URL;
    const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;

    if (!GEMINI_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
        console.error('❌ Missing env vars: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY');
        process.exit(1);
    }

    console.log('🚀 LNN Legal — eCourts Background Crawler starting...');

    // Fetch all active cases with a CNR number from Supabase
    const { data: cases, error } = await supabase
        .from('cases')
        .select('id, cnr, case_no, case_type, petitioner')
        .not('cnr', 'is', null)
        .neq('cnr', '')
        .limit(50); // Process up to 50 cases per run

    if (error) { console.error('Supabase error:', error.message); process.exit(1); }
    if (!cases || cases.length === 0) { console.log('No cases with CNR numbers found.'); process.exit(0); }

    console.log(`Found ${cases.length} cases to sync.\n`);

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 900 }
    });
    const page = await context.newPage();

    let updated = 0, failed = 0;

    for (const c of cases) {
        try {
            const data = await scrapeCase(page, c.cnr, GEMINI_KEY);
            if (data) {
                const updatePayload = { last_ecourts_sync: new Date().toISOString() };
                if (data.nextHearing) updatePayload.next_hearing = data.nextHearing;
                if (data.caseStage)   updatePayload.purpose = data.caseStage;
                if (data.hearingHistory?.length > 0) updatePayload.hearing_history = data.hearingHistory;

                const { error: updateErr } = await supabase.from('cases').update(updatePayload).eq('id', c.id);
                if (updateErr) {
                    console.log(`  ⚠️  DB update failed for ${c.cnr}: ${updateErr.message}`);
                    failed++;
                } else {
                    console.log(`  ✅ Updated ${c.cnr} | Next: ${data.nextHearing || 'N/A'} | Stage: ${data.caseStage || 'N/A'}`);
                    updated++;
                }
            } else {
                console.log(`  ❌ Failed to scrape ${c.cnr}`);
                failed++;
            }
        } catch (e) {
            console.log(`  ❌ Error on ${c.cnr}: ${e.message}`);
            failed++;
        }

        // Polite delay between cases (8 seconds) — avoids rate-limiting
        if (cases.indexOf(c) < cases.length - 1) {
            console.log('  Waiting 8s before next case...');
            await page.waitForTimeout(8000);
        }
    }

    await browser.close();
    console.log(`\n✅ Crawler done. Updated: ${updated} | Failed: ${failed}`);
}

run();
