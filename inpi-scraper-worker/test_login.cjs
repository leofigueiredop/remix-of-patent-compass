const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', request => {
        if (request.url().includes('LoginController') && request.method() === 'POST') {
            console.log("URL:", request.url());
            console.log("HEADERS:", JSON.stringify(request.headers(), null, 2));
            console.log("BODY:", request.postData());
        }
        request.continue();
    });

    await page.goto('https://busca.inpi.gov.br/pePI/', { waitUntil: 'networkidle2' });
    await page.type('input[name="T_Login"]', 'leopickler');
    await page.type('input[name="T_Senha"]', 'b!Lmeu93RK3Q');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.evaluate(() => document.querySelector('form[name="F_LoginCliente"]').submit())
    ]);

    await browser.close();
})();
