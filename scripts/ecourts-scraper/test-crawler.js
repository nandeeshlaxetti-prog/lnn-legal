const { chromium } = require('playwright');
const Tesseract = require('tesseract.js');
const https = require('https');
const fs = require('fs');

async function downloadWithCookies(url, cookies, destPath) {
    return new Promise((resolve, reject) => {
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://services.ecourts.gov.in/ecourtindia_v6/',
                'Cookie': cookieStr
            }
        };
        const file = fs.createWriteStream(destPath);
        https.get(url, options, (res) => {
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
    });
}

async function solveCaptchaFromUrl(captchaUrl, cookies, attempt) {
    const imgPath = `captcha_attempt_${attempt}.png`;
    
    // Download captcha image directly using session cookies
    await downloadWithCookies(captchaUrl, cookies, imgPath);
    console.log(`CAPTCHA downloaded: ${imgPath} (${fs.statSync(imgPath).size} bytes)`);
    
    // Run Tesseract OCR
    const { data: { text } } = await Tesseract.recognize(imgPath, 'eng', {
        tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        tessedit_pageseg_mode: '7'  // Treat image as single text line
    });

    const solved = text.replace(/\s+/g, '').trim();
    console.log(`OCR result: "${solved}"`);
    return { solved, imgPath };
}

async function dismissAnyModal(page) {
    try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        // Force remove modal backdrop via JS
        await page.evaluate(() => {
            document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
        });
        await page.waitForTimeout(300);
    } catch (e) { /* ignore */ }
}

async function scrapeCase(page, cnr) {
    console.log(`\n====== Scraping CNR: ${cnr} ======`);

    // Load homepage fresh
    console.log('Loading homepage...');
    await page.goto('https://services.ecourts.gov.in/ecourtindia_v6/', {
        waitUntil: 'networkidle',
        timeout: 30000
    });

    // Click CNR tab
    console.log('Clicking #leftPaneMenuCnr...');
    await page.waitForSelector('#leftPaneMenuCnr', { timeout: 15000 });
    await page.evaluate(() => document.getElementById('leftPaneMenuCnr').click());
    await page.waitForSelector('#cnr_div', { state: 'visible', timeout: 10000 });

    // Fill CNR number
    await page.fill('#cino', cnr);
    console.log('CNR filled.');

    // Get the CAPTCHA image src from the page
    const captchaSrc = await page.$eval('#captcha_image', el => el.src);
    console.log('CAPTCHA src:', captchaSrc);

    // Get session cookies for downloading
    const cookies = await page.context().cookies();

    for (let attempt = 1; attempt <= 8; attempt++) {
        console.log(`\n--- Attempt ${attempt} ---`);

        // On retries, get fresh CAPTCHA URL from page
        let freshCaptchaSrc = captchaSrc;
        if (attempt > 1) {
            freshCaptchaSrc = await page.$eval('#captcha_image', el => el.src).catch(() => captchaSrc);
            // Trigger captcha refresh by clicking the reload icon if available
            const reloadCaptcha = await page.$('#reload');
            if (reloadCaptcha) {
                await page.evaluate(el => el.click(), reloadCaptcha);
                await page.waitForTimeout(800);
                freshCaptchaSrc = await page.$eval('#captcha_image', el => el.src).catch(() => captchaSrc);
            }
            console.log('Fresh CAPTCHA src:', freshCaptchaSrc);
        }

        const freshCookies = await page.context().cookies();
        const { solved, imgPath } = await solveCaptchaFromUrl(freshCaptchaSrc, freshCookies, attempt);

        if (!solved || solved.length < 4) {
            console.log('CAPTCHA solve too short, skipping...');
            continue;
        }

        // Clear and fill CAPTCHA input
        await page.fill('#fcaptcha_code', '');
        await page.type('#fcaptcha_code', solved, { delay: 50 });
        await page.waitForTimeout(200);

        // Click search via JS to avoid any backdrop issues
        await page.evaluate(() => document.getElementById('searchbtn').click());

        // Wait for result
        const result = await Promise.race([
            page.waitForSelector('#history_cnr', { state: 'visible', timeout: 12000 }).then(() => 'success'),
            page.waitForSelector('#caseBusinessDiv_cnr table', { state: 'visible', timeout: 12000 }).then(() => 'success'),
            page.waitForSelector('#validateError.show, #msg-danger:visible', { state: 'visible', timeout: 12000 }).then(() => 'error'),
        ]).catch(() => 'timeout');

        console.log('Result:', result);

        if (result === 'success') {
            console.log('\n✅ SUCCESS! Case data found!');
            await page.screenshot({ path: `result_${cnr}.png`, fullPage: true });
            const text = await page.$eval('body', el => el.innerText).catch(() => '');
            console.log('Page content (first 2000 chars):\n', text.substring(0, 2000));
            return true;
        }

        if (result === 'error') {
            const errMsg = await page.$eval('#validateError, #msg-danger', el => el.innerText).catch(() => '?');
            console.log('Error:', errMsg.trim().substring(0, 150));
            await dismissAnyModal(page);
            continue;
        }

        if (result === 'timeout') {
            console.log('Timeout. Checking page...');
            const txt = await page.$eval('body', el => el.innerText.substring(0, 300)).catch(() => '');
            console.log(txt);
            await dismissAnyModal(page);
        }
    }

    return false;
}

async function run() {
    console.log('Starting eCourts Scraper...');
    const testCnr = 'KABC030534362020';

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 900 }
    });

    const page = await context.newPage();
    const ok = await scrapeCase(page, testCnr);
    
    if (ok) {
        console.log('\n✅ FINAL: Test SUCCESSFUL!');
    } else {
        console.log('\n❌ FINAL: Test FAILED.');
    }

    await browser.close();
}

run();
