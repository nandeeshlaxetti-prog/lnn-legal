const { chromium } = require('playwright');
const Tesseract = require('tesseract.js');

async function solveCaptcha(page) {
    console.log('Solving CAPTCHA...');
    // eCourts India CAPTCHA is typically an image with id 'captcha_image'
    const captchaElement = await page.$('#captcha_image');
    if (!captchaElement) {
        console.log('No CAPTCHA found');
        return '';
    }

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
    console.log(`\\n--- Scraping CNR: ${cnr} ---`);
    let retries = 5;

    while (retries > 0) {
        try {
            console.log(`Navigating to eCourts home page... (Retries left: ${retries})`);
            await page.goto('https://services.ecourts.gov.in/ecourtindia_v6/', { waitUntil: 'networkidle' });
            
            // Try to find and click the CNR tab or button
            console.log('Looking for CNR tab...');
            const cnrTab = await page.$('a:has-text("CNR")');
            if (cnrTab) {
                console.log('Found CNR tab. Clicking it...');
                await cnrTab.click();
            } else {
                console.log('No CNR tab found, assuming we are on the right page or it requires another action.');
            }

            // Wait for CNR input field
            console.log('Waiting for #cino input field...');
            await page.waitForSelector('#cino', { timeout: 15000 });
            await page.fill('#cino', cnr);

            // Solve and fill CAPTCHA
            const captchaText = await solveCaptcha(page);
            if (!captchaText) {
                console.log('Could not extract CAPTCHA text. Retrying...');
                retries--;
                continue;
            }
            await page.fill('#fcaptcha_code', captchaText);

            // Click Search
            console.log('Clicking Search...');
            await page.click('#searchbtn');

            // Wait for results or error
            const result = await Promise.race([
                page.waitForSelector('#showList2', { timeout: 10000 }).then(() => 'success'),
                page.waitForSelector('.alert-danger, .alert-warning, #errSpan', { timeout: 10000 }).then(() => 'error')
            ]).catch(() => 'timeout');

            if (result === 'error' || result === 'timeout') {
                console.log('CAPTCHA failed or timeout. Retrying...');
                retries--;
                continue;
            }

            console.log('Search successful. Extracting data...');
            const html = await page.innerHTML('#showList2');
            console.log('HTML Dump of results:', html.substring(0, 500) + '...');
            
            // Attempt to click view button
            const viewLink = await page.$('#showList2 a');
            if (viewLink) {
                console.log('Clicking view case details...');
                await viewLink.click();
                await page.waitForTimeout(5000); // Wait for details to load
                
                const fullHtml = await page.innerHTML('.HistoryTable').catch(() => 'No history table');
                console.log('History Table HTML:', fullHtml.substring(0, 500));
                
                return { success: true };
            } else {
                console.log('View link not found in results.');
            }
            
            return null;

        } catch (e) {
            console.error(`Error scraping ${cnr}:`, e.message);
            console.log('--- PAGE INPUTS DUMP START ---');
            const inputs = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('input, button, a')).map(el => {
                    return `${el.tagName.toLowerCase()} id="${el.id}" name="${el.name || ''}" class="${el.className}" text="${el.innerText || el.value || ''}"`;
                });
            }).catch(() => []);
            console.log(inputs.join('\\n'));
            console.log('--- PAGE INPUTS DUMP END ---');
            retries--;
        }
    }
    return null;
}

async function runTest() {
    console.log('Starting eCourts CNR Test crawler...');
    const testCnr = 'KABC030534362020';

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    console.log('Testing single CNR extraction...');
    const result = await scrapeCase(page, testCnr);
    
    if (result) {
        console.log('Test SUCCESSFUL!');
    } else {
        console.log('Test FAILED.');
    }

    await browser.close();
}

runTest();
