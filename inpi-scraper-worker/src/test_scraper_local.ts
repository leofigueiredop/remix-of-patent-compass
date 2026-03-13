import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';

puppeteer.use(StealthPlugin());

const INPI_USER = process.env.INPI_USER || 'leopickler';
const INPI_PASSWORD = process.env.INPI_PASSWORD || 'b!Lmeu93RK3Q';

async function runLocalTest() {
    console.log("Launching Puppeteer Stealth Browser for LOCAL TEST...");
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
        console.log("Navigating to INPI Login Portal...");
        await page.goto('https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login', { waitUntil: 'networkidle2', timeout: 60000 });

        console.log(`Authenticating with INPI credentials (${INPI_USER})...`);

        console.log("Opening login form...");
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const loginLink = links.find(l => (l.textContent || '').includes('Login'));
                if (loginLink) loginLink.click();
            })
        ]);

        const loginInput = await page.$('input[name="T_Login"]');
        const passInput = await page.$('input[name="T_Senha"]');

        if (loginInput && passInput) {
            await loginInput.type(INPI_USER);
            await passInput.type(INPI_PASSWORD);

            console.log("Submitting login form...");
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                page.click('input[type="submit"]'),
            ]);
            console.log("Logged in successfully!");
        } else {
            console.error("Login fields not found! Dumping HTML...");
            const html = await page.content();
            console.log(html.substring(0, 500));
        }

        console.log("Going to Advanced Search...");
        await page.goto('https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=SearchAvancado', { waitUntil: 'networkidle2' });

        // Let's search for a very specific recent date to get a small result set
        const startDate = `01/01/2024`;
        const endDate = `05/01/2024`;

        console.log(`Filling dates: ${startDate} to ${endDate}`);
        await page.type('input[name="DataDeposito1"]', startDate);
        await page.type('input[name="DataDeposito2"]', endDate);
        await page.select('select[name="RegisterPerPage"]', '20');

        console.log("Clicking Search...");
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }),
            page.click('input[name="botao"]'),
        ]);

        const html = await page.content();
        const $ = cheerio.load(html);

        const rows = $('table').eq(1).find('tr:not(:first-child)');
        if (!rows || rows.length === 0 || html.includes('Nenhum resultado de')) {
            console.log("No results found for test date range.");
            await browser.close();
            return;
        }

        const patentsToProcess: string[] = [];
        rows.each((i, el) => {
            const cols = $(el).find('td');
            if (cols.length >= 2) {
                const codPedido = $(cols[0]).text().trim();
                if (codPedido) {
                    patentsToProcess.push(codPedido);
                }
            }
        });

        console.log(`Found ${patentsToProcess.length} patents. Testing extraction on the first one: ${patentsToProcess[0]}`);

        const cod = patentsToProcess[0];

        const detailUrl = `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${cod}`;
        await page.goto(detailUrl, { waitUntil: 'networkidle2' });
        const detailHtml = await page.content();
        const $d = cheerio.load(detailHtml);

        const extractValue = (fontType: string) => {
            const el = $d(`font:contains("${fontType}")`).closest('td').next('td').find('font');
            if (el.length === 0) return null;
            const cloned = el.clone();
            cloned.find('br').replaceWith('\n');
            return cloned.text().trim();
        };

        const data = {
            cod_pedido: cod,
            numero_publicacao: '',
            title: extractValue('Título:'),
            abstract: extractValue('Resumo:'),
            applicant: extractValue('Depositante:'),
            inventors: extractValue('Inventor:'),
            status: 'Extracted Local Test',
            filing_date: extractValue('Data do Depósito:'),
            ipc_codes: extractValue('Classificação IPC:'),
        };

        console.log("\n=== SUCCESSFUL EXTRACTION ===");
        console.log(JSON.stringify(data, null, 2));
        console.log("=============================\n");

    } catch (err: any) {
        console.error(`TEST ERROR: ${err.message}`);
    } finally {
        await browser.close();
        console.log("Browser closed. Test finished.");
    }
}

runLocalTest();
