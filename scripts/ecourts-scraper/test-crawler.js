const { chromium } = require('playwright');
const Tesseract = require('tesseract.js');

async function solveCaptcha(page) {
    console.log('Solving CAPTCHA...');
    const captchaElement = await page.$('#captcha_image');
    if (!captchaElement) {
        console.log('No CAPTCHA image found.');
        return '';
    }

    const buffer = await captchaElement.screenshot();
    const { data: { text } } = await Tesseract.recognize(buffer, 'eng', {
        tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    });

    const solved = text.replace(/\s+/g, '').trim();
    console.log('CAPTCHA solved as:', `"${solved}"`);
    return solved;
}

async function scrapeCase(page, cnr) {
    console.log(`\n====== Scraping CNR: ${cnr} ======`);
    let retries = 5;

    while (retries > 0) {
        try {
            console.log(`Navigating to eCourts homepage... (Retries left: ${retries})`);
            await page.goto('https://services.ecourts.gov.in/ecourtindia_v6/', {
                waitUntil: 'networkidle',
                timeout: 30000
            });

            // Click the CNR tab in the left sidebar (id=leftPaneMenuCnr)
            console.log('Clicking CNR tab in left sidebar (#leftPaneMenuCnr)...');
            await page.waitForSelector('#leftPaneMenuCnr', { timeout: 15000 });
            await page.click('#leftPaneMenuCnr');

            // Wait for the CNR div to become visible
            console.log('Waiting for CNR form (#cnr_div) to appear...');
            await page.waitForSelector('#cnr_div', { state: 'visible', timeout: 10000 });

            // Fill in the CNR number
            console.log(`Filling in CNR: ${cnr}`);
            await page.fill('#cino', cnr);
            await page.waitForTimeout(500);

            // Take a screenshot of the CAPTCHA
            const captchaElement = await page.$('#captcha_image');
            if (captchaElement) {
                await captchaElement.screenshot({ path: `captcha_${cnr}.png` });
                console.log(`CAPTCHA image saved as captcha_${cnr}.png`);
            }

            // Solve CAPTCHA
            const captchaText = await solveCaptcha(page);
            if (!captchaText) {
                console.log('Empty CAPTCHA solve. Retrying...');
                retries--;
                continue;
            }

            // Fill CAPTCHA
            console.log('Filling CAPTCHA text...');
            await page.fill('#fcaptcha_code', captchaText);
            await page.waitForTimeout(300);

            // Click search
            console.log('Clicking search button (#searchbtn)...');
            await page.click('#searchbtn');

            // Wait for results or error
            console.log('Waiting for results...');
            const result = await Promise.race([
                page.waitForSelector('#history_cnr', { state: 'visible', timeout: 15000 }).then(() => 'success'),
                page.waitForSelector('.alert-danger, .alert, #error-msg', { state: 'visible', timeout: 15000 }).then(() => 'captcha_error'),
            ]).catch(() => 'timeout');

            console.log('Result status:', result);

            if (result === 'captcha_error') {
                const errText = await page.$eval('.alert-danger, .alert, #error-msg', el => el.innerText).catch(() => 'Unknown error');
                console.log('Error on page:', errText);
                retries--;
                continue;
            }

            if (result === 'timeout') {
                console.log('Timed out waiting for results.');
                // Dump whatever is on the page
                const bodyText = await page.$eval('body', el => el.innerText.substring(0, 1000)).catch(() => '');
                console.log('Page content:', bodyText);
                retries--;
                continue;
            }

            // SUCCESS — extract data
            console.log('SUCCESS! Extracting case data...');
            await page.screenshot({ path: `result_${cnr}.png` });
            console.log(`Screenshot saved as result_${cnr}.png`);

            const pageText = await page.$eval('body', el => el.innerText).catch(() => '');
            console.log('Page text (first 2000 chars):', pageText.substring(0, 2000));

            return { success: true };

        } catch (e) {
            console.error(`Error on attempt:`, e.message);
            retries--;
        }
    }

    console.log('All retries exhausted.');
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
        console.log('\n✅ Test SUCCESSFUL! The scraper can read eCourts data.');
    } else {
        console.log('\n❌ Test FAILED. CAPTCHA solving needs improvement.');
    }

    await browser.close();
}

runTest();
