const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const Tesseract = require('tesseract.js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function solveCaptcha(page) {
    console.log('Solving CAPTCHA...');
    // The eCourts CAPTCHA image is usually #captcha_image
    const captchaElement = await page.$('#captcha_image');
    if (!captchaElement) return '';

    const buffer = await captchaElement.screenshot();
    
    // Use Tesseract to read the image
    const { data: { text } } = await Tesseract.recognize(buffer, 'eng', {
        tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    });
    
    const solved = text.replace(/\\s+/g, '').trim();
    console.log('CAPTCHA solved as:', solved);
    return solved;
}

async function scrapeCase(page, cnr) {
    console.log(`\n--- Scraping CNR: ${cnr} ---`);
    let retries = 3;

    while (retries > 0) {
        try {
            await page.goto('https://services.ecourts.gov.in/ecourtindia_v6/?p=home/searchCnr', { waitUntil: 'networkidle' });
            
            // Wait for CNR input field
            await page.waitForSelector('#cino', { timeout: 10000 });
            await page.fill('#cino', cnr);

            // Solve and fill CAPTCHA
            const captchaText = await solveCaptcha(page);
            await page.fill('#fcaptcha_code', captchaText);

            // Click Search
            await page.click('#searchbtn');

            // Wait for results or error (error happens if CAPTCHA is wrong)
            // We use Promise.race to wait for either the results table or an alert modal
            
            const result = await Promise.race([
                page.waitForSelector('#showList2', { timeout: 15000 }).then(() => 'success'),
                page.waitForSelector('.alert-danger, .alert-warning', { timeout: 15000 }).then(() => 'error'),
                page.waitForFunction(() => document.querySelector('#errSpan')?.innerText?.length > 0, { timeout: 15000 }).then(() => 'error')
            ]).catch(() => 'timeout');

            if (result === 'error' || result === 'timeout') {
                console.log('CAPTCHA failed or timeout. Retrying...');
                retries--;
                continue; // Loop again
            }

            console.log('Search successful. Extracting data...');
            // In a real eCourts page, clicking "View" opens a new tab or expands a div.
            // Usually, #showList2 has an 'a' tag to view the case.
            const viewLink = await page.$('#showList2 a');
            if (viewLink) {
                await viewLink.click();
                await page.waitForSelector('.HistoryTable', { timeout: 10000 });
                
                // Extract Status
                const caseStatus = await page.$eval('label:has-text("Case Status") + span, td:has-text("Case Status") + td', el => el.innerText.trim()).catch(() => 'Unknown');
                const nextHearing = await page.$eval('label:has-text("Next Hearing Date") + span, td:has-text("Next Hearing Date") + td', el => el.innerText.trim()).catch(() => null);
                
                return {
                    status: caseStatus,
                    next_hearing: nextHearing ? new Date(nextHearing).toISOString().split('T')[0] : null
                };
            }
            
            return null;

        } catch (e) {
            console.error(`Error scraping ${cnr}:`, e.message);
            retries--;
        }
    }
    return null;
}

async function run() {
    console.log('Starting Background Crawler...');
    
    // Fetch cases that need syncing
    const { data: cases, error } = await supabase
        .from('cases')
        .select('id, cnr, case_no, case_type')
        .not('cnr', 'is', null)
        .neq('cnr', '')
        .neq('status', 'Disposed') // Assuming 'status' is how you track disposal, or use another filter
        .limit(10); // Batch size for testing

    if (error || !cases || cases.length === 0) {
        console.log('No cases to sync.');
        return;
    }

    console.log(`Found ${cases.length} cases to sync.`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    for (const c of cases) {
        const result = await scrapeCase(page, c.cnr);
        if (result) {
            console.log(`Updating ${c.cnr}...`, result);
            await supabase.from('cases').update({
                purpose: result.status,
                next_hearing: result.next_hearing,
            }).eq('id', c.id);
        } else {
            console.log(`Failed to extract data for ${c.cnr}`);
        }
        
        // Anti-bot delay
        await page.waitForTimeout(5000);
    }

    await browser.close();
    console.log('Crawler finished.');
}

run();
