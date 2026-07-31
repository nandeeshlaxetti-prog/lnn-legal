const { chromium } = require('playwright');
const Tesseract = require('tesseract.js');
const fs = require('fs');

async function solveCaptcha(page, attempt) {
    const captchaElement = await page.$('#captcha_image');
    if (!captchaElement) {
        console.log('No CAPTCHA image found.');
        return '';
    }

    // Save captcha screenshot for inspection
    const imgPath = `captcha_attempt_${attempt}.png`;
    const buffer = await captchaElement.screenshot({ path: imgPath });
    console.log(`CAPTCHA saved as ${imgPath}`);

    const { data: { text } } = await Tesseract.recognize(imgPath, 'eng', {
        tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    });

    const solved = text.replace(/\s+/g, '').trim();
    console.log(`CAPTCHA solved as: "${solved}"`);
    return solved;
}

async function dismissModal(page) {
    // Try pressing Escape to close any open modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Also try clicking any visible close button in the modal
    const closeBtn = await page.$('#validateError .btn-close, #validateError .close, button[data-dismiss="modal"], button[data-bs-dismiss="modal"]');
    if (closeBtn) {
        // Use JS click to bypass backdrop
        await page.evaluate(el => el.click(), closeBtn);
        await page.waitForTimeout(500);
    }

    // Wait for backdrop to disappear
    try {
        await page.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 5000 });
        console.log('Modal dismissed successfully.');
    } catch {
        console.log('Modal backdrop still present, continuing anyway...');
        // Force remove the backdrop via JS as last resort
        await page.evaluate(() => {
            document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
            document.body.classList.remove('modal-open');
        });
    }
}

async function refreshCaptcha(page) {
    // Click the refresh CAPTCHA button if it exists
    const refreshBtn = await page.$('#captcha_image_source_wav, a[onclick*="captcha"], #reload_captcha, .captcha-reload');
    if (refreshBtn) {
        await page.evaluate(el => el.click(), refreshBtn);
        await page.waitForTimeout(1000);
        console.log('Captcha refreshed.');
    }
}

async function scrapeCase(page, cnr) {
    console.log(`\n====== Scraping CNR: ${cnr} ======`);

    // Step 1: Navigate fresh each time
    console.log('Navigating to eCourts homepage...');
    await page.goto('https://services.ecourts.gov.in/ecourtindia_v6/', {
        waitUntil: 'networkidle',
        timeout: 30000
    });

    // Step 2: Click the CNR tab
    console.log('Clicking CNR tab (#leftPaneMenuCnr)...');
    await page.waitForSelector('#leftPaneMenuCnr', { timeout: 15000 });
    await page.evaluate(() => document.getElementById('leftPaneMenuCnr').click());
    await page.waitForSelector('#cnr_div', { state: 'visible', timeout: 10000 });
    console.log('CNR form is visible.');

    // Step 3: Fill CNR number
    await page.fill('#cino', cnr);

    // Step 4: Try CAPTCHA up to 8 times
    let attempt = 0;
    while (attempt < 8) {
        attempt++;
        console.log(`\n--- CAPTCHA attempt ${attempt} ---`);

        // Refresh captcha on retries
        if (attempt > 1) {
            await refreshCaptcha(page);
        }

        const captchaText = await solveCaptcha(page, attempt);
        if (!captchaText || captchaText.length < 4) {
            console.log('CAPTCHA too short or empty. Skipping.');
            continue;
        }

        // Clear and fill CAPTCHA field
        await page.fill('#fcaptcha_code', '');
        await page.fill('#fcaptcha_code', captchaText);
        await page.waitForTimeout(200);

        // Click Search via JS to avoid modal-backdrop intercept
        console.log('Clicking search via JS...');
        await page.evaluate(() => document.getElementById('searchbtn').click());

        // Wait for result or error
        const result = await Promise.race([
            page.waitForSelector('#history_cnr', { state: 'visible', timeout: 12000 }).then(() => 'success'),
            page.waitForSelector('#caseBusinessDiv_cnr table', { state: 'visible', timeout: 12000 }).then(() => 'success'),
            page.waitForSelector('#validateError.show', { state: 'visible', timeout: 12000 }).then(() => 'modal_error'),
            page.waitForFunction(
                () => {
                    const el = document.querySelector('.alert-danger, #errSpan');
                    return el && el.innerText && el.innerText.trim().length > 5;
                },
                { timeout: 12000 }
            ).then(() => 'captcha_error'),
        ]).catch(() => 'timeout');

        console.log('Result:', result);

        if (result === 'success') {
            console.log('\n✅ Search returned results! Extracting data...');
            await page.screenshot({ path: `result_${cnr}.png` });
            console.log(`Screenshot saved: result_${cnr}.png`);

            const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');
            console.log('Page text (first 3000 chars):\n', bodyText.substring(0, 3000));
            return { success: true };
        }

        if (result === 'modal_error' || result === 'captcha_error') {
            const errText = await page.$eval('#validateError, .alert-danger, #errSpan', el => el.innerText).catch(() => 'unknown error');
            console.log('Error message:', errText.trim().substring(0, 200));
            console.log('Dismissing modal and retrying...');
            await dismissModal(page);
            continue;
        }

        if (result === 'timeout') {
            console.log('Timeout. Checking page state...');
            const bodyText = await page.$eval('body', el => el.innerText.substring(0, 500)).catch(() => '');
            console.log('Page text:', bodyText);
            await dismissModal(page);
        }
    }

    console.log('All CAPTCHA attempts exhausted.');
    return null;
}

async function runTest() {
    console.log('Starting eCourts CNR Test Scraper...');
    const testCnr = 'KABC030534362020';

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();
    const result = await scrapeCase(page, testCnr);

    if (result) {
        console.log('\n✅ FINAL: Test SUCCESSFUL!');
    } else {
        console.log('\n❌ FINAL: Test FAILED.');
    }

    await browser.close();
}

runTest();
