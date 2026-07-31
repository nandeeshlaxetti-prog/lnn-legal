const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');

// ─── Gemini Vision CAPTCHA Solver ────────────────────────────────────────────
async function solveCaptchaWithGemini(imgPath, geminiKey) {
    const imgData = fs.readFileSync(imgPath);
    const base64 = imgData.toString('base64');

    // Disable thinking (thinkingBudget:0) so all tokens go to the actual answer
    // gemini-2.5-flash uses "thinking tokens" by default which eats the token budget
    const requestBody = JSON.stringify({
        contents: [{
            parts: [
                { text: 'Read the CAPTCHA text in this image. Reply with ONLY the characters shown, no spaces, no explanation.' },
                { inline_data: { mime_type: 'image/png', data: base64 } }
            ]
        }],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 100,
            thinkingConfig: { thinkingBudget: 0 }
        }
    });

    return new Promise((resolve, reject) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
        const urlObj = new URL(url);
        const req = https.request({
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`Gemini status: ${res.statusCode}`);
                try {
                    const json = JSON.parse(data);
                    const finishReason = json?.candidates?.[0]?.finishReason;
                    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    console.log(`Gemini finishReason: ${finishReason}, text: "${text}"`);
                    resolve(text.replace(/\s+/g, '').trim());
                } catch (e) {
                    console.log(`Gemini parse error: ${e.message}, raw: ${data.substring(0, 200)}`);
                    resolve('');
                }
            });
        });
        req.on('error', (e) => { console.log(`Gemini request error: ${e.message}`); resolve(''); });
        req.write(requestBody);
        req.end();
    });
}


// ─── Download CAPTCHA with session cookies ────────────────────────────────────
async function downloadCaptcha(url, cookies, destPath) {
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://services.ecourts.gov.in/ecourtindia_v6/',
                'Cookie': cookieStr
            }
        };
        const urlObj = new URL(url);
        const file = fs.createWriteStream(destPath);
        https.get({ hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, ...options }, (res) => {
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
    });
}

// ─── Dismiss any modal blocking the page ─────────────────────────────────────
async function dismissModal(page) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    await page.evaluate(() => {
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        document.querySelectorAll('.modal.show').forEach(el => {
            el.classList.remove('show');
            el.style.display = 'none';
        });
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    });
    await page.waitForTimeout(200);
}

// ─── Main scraper ─────────────────────────────────────────────────────────────
async function scrapeCase(page, cnr, geminiKey) {
    console.log(`\n====== Scraping CNR: ${cnr} ======`);

    await page.goto('https://services.ecourts.gov.in/ecourtindia_v6/', {
        waitUntil: 'networkidle', timeout: 30000
    });

    // Click CNR tab
    await page.waitForSelector('#leftPaneMenuCnr', { timeout: 15000 });
    await page.evaluate(() => document.getElementById('leftPaneMenuCnr').click());
    await page.waitForSelector('#cnr_div', { state: 'visible', timeout: 10000 });
    console.log('CNR form open.');

    await page.fill('#cino', cnr);

    for (let attempt = 1; attempt <= 6; attempt++) {
        console.log(`\n--- Attempt ${attempt} ---`);

        // Dismiss any leftover modals from prior attempts
        await dismissModal(page);

        // Get fresh CAPTCHA URL
        const captchaUrl = await page.$eval('#captcha_image', el => el.src).catch(() => null);
        if (!captchaUrl) {
            console.log('CAPTCHA image not found, retrying page...');
            break;
        }

        // On retries, refresh the CAPTCHA image first
        if (attempt > 1) {
            const reloadBtn = await page.$('#reload');
            if (reloadBtn) {
                await page.evaluate(el => el.click(), reloadBtn);
                await page.waitForTimeout(800);
            } else {
                // Force reload captcha via URL change
                await page.evaluate(() => {
                    const img = document.getElementById('captcha_image');
                    const src = img.src.split('?')[0];
                    img.src = src + '?' + Date.now();
                });
                await page.waitForTimeout(800);
            }
        }

        const freshCaptchaUrl = await page.$eval('#captcha_image', el => el.src).catch(() => captchaUrl);
        const cookies = await page.context().cookies();
        const imgPath = `captcha_${attempt}.png`;

        // Download CAPTCHA image
        await downloadCaptcha(freshCaptchaUrl, cookies, imgPath);
        const size = fs.statSync(imgPath).size;
        console.log(`CAPTCHA image downloaded: ${imgPath} (${size} bytes)`);

        // Solve with Gemini Vision
        console.log('Sending to Gemini Vision...');
        const solved = await solveCaptchaWithGemini(imgPath, geminiKey);
        console.log(`Gemini solved CAPTCHA as: "${solved}"`);

        if (!solved || solved.length < 4 || solved.length > 8) {
            console.log('Invalid CAPTCHA solve, retrying...');
            continue;
        }

        // Fill CAPTCHA and search
        await page.fill('#fcaptcha_code', '');
        await page.type('#fcaptcha_code', solved, { delay: 40 });
        await page.waitForTimeout(200);
        await page.evaluate(() => document.getElementById('searchbtn').click());
        console.log('Search submitted.');

        // Wait for result
        const outcome = await Promise.race([
            page.waitForSelector('#history_cnr', { state: 'visible', timeout: 12000 }).then(() => 'success'),
            page.waitForSelector('#caseBusinessDiv_cnr table', { state: 'visible', timeout: 12000 }).then(() => 'success'),
            page.waitForSelector('#validateError.show', { state: 'visible', timeout: 12000 }).then(() => 'modal_error'),
            page.waitForSelector('#msg-danger', { state: 'visible', timeout: 12000 }).then(() => 'msg_error'),
        ]).catch(() => 'timeout');

        console.log('Outcome:', outcome);

        if (outcome === 'success') {
            console.log('\n✅ SUCCESS! Extracting case data...');
            await page.screenshot({ path: `result_${cnr}.png`, fullPage: true });

            const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');
            console.log('\n--- CASE DATA ---');
            console.log(bodyText.substring(0, 3000));

            // Extract specific fields
            const nextHearing = bodyText.match(/Next\s+(?:Date|Hearing)[^\n]*\n([^\n]+)/)?.[1]?.trim();
            const caseStatus  = bodyText.match(/Case\s+Status[^\n]*\n([^\n]+)/)?.[1]?.trim();
            if (nextHearing) console.log('\nNext Hearing:', nextHearing);
            if (caseStatus)  console.log('Case Status:', caseStatus);

            return { success: true, nextHearing, caseStatus };
        }

        if (outcome === 'modal_error' || outcome === 'msg_error') {
            const errMsg = await page.$eval('#validateError, #msg-danger', el => el.innerText)
                .catch(() => 'unknown');
            console.log('Page error:', errMsg.trim().substring(0, 150));
            await dismissModal(page);
            continue;
        }

        if (outcome === 'timeout') {
            const pg = await page.$eval('body', el => el.innerText.substring(0, 200)).catch(() => '');
            console.log('Timeout. Page snippet:', pg);
            await dismissModal(page);
        }
    }

    return null;
}

// ─── Entry point ──────────────────────────────────────────────────────────────
async function run() {
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
        console.error('❌ GEMINI_API_KEY environment variable is not set!');
        process.exit(1);
    }

    const testCnr = process.argv[2] || 'KABC030534362020';
    console.log(`Starting eCourts Scraper with Gemini Vision for CNR: ${testCnr}`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 900 }
    });

    const page = await context.newPage();

    try {
        const result = await scrapeCase(page, testCnr, GEMINI_KEY);
        if (result) {
            console.log('\n✅ FINAL: Test SUCCESSFUL!');
        } else {
            console.log('\n❌ FINAL: CAPTCHA still failing — check captcha_*.png artifacts.');
        }
    } finally {
        await browser.close();
    }
}

run();
