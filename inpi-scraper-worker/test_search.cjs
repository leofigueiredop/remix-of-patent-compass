const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    await page.goto('https://busca.inpi.gov.br/pePI/', { waitUntil: 'networkidle2' });
    await page.type('input[name="T_Login"]', 'leopickler');
    await page.type('input[name="T_Senha"]', 'b!Lmeu93RK3Q');
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.evaluate(() => document.querySelector('form[name="F_LoginCliente"]').submit())
    ]);

    await page.goto('https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchBasico.jsp', { waitUntil: 'networkidle2' });
    await page.goto('https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=SearchAvancado', { waitUntil: 'networkidle2' });

    await page.evaluate(() => {
        document.querySelector('input[name="Titular"]').value = 'Vale';
    });

    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.evaluate(() => document.querySelector('input[name="botao"]').click())
    ]);

    const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a'))
            .filter(a => a.href && a.href.includes('CodPedido='))
            .map(a => a.href)
            .slice(0, 3);
    });

    console.log("Found Links:", links);
    await browser.close();
})();
