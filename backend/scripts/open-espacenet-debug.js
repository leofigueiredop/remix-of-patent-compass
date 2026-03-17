const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const urls = [
  'https://worldwide.espacenet.com/patent/search/publication/BRPI1005510A2',
  'https://worldwide.espacenet.com/patent/search/publication/BR20230011476'
];

async function run() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1400,900',
      '--lang=en-US,en'
    ]
  });

  for (const url of urls) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => undefined);
  }

  console.log('DEBUG_BROWSER_OPEN');
  console.log('Janela ficou aberta para você inspecionar.');
  setInterval(() => {}, 1000);
}

run().catch((error) => {
  console.error('DEBUG_BROWSER_ERROR', error?.message || String(error));
  process.exit(1);
});
