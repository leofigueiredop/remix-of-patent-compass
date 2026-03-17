const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function clickByText(page, terms) {
  return page.evaluate((needles) => {
    const normalized = needles.map((item) => item.toLowerCase());
    const list = Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"], li, span, div'));
    for (const el of list) {
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!text) continue;
      if (!normalized.some((needle) => text.includes(needle))) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      el.click();
      return true;
    }
    return false;
  }, terms);
}

async function hasPatentContent(page) {
  return page.evaluate(() => {
    const text = String(document.body?.innerText || '').toLowerCase();
    return text.includes('bibliographic data') || text.includes('original document') || text.includes('drawings');
  }).catch(() => false);
}

async function run() {
  const publication = process.argv[2] || 'BRPI1005510A2';
  const outPath = process.argv[3] || '/tmp/espacenet-session-test.pdf';
  const userDataDir = '/tmp/espacenet-profile';
  fs.mkdirSync(userDataDir, { recursive: true });
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1400,900',
      '--lang=en-US,en'
    ]
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8' });

  let downloaded = false;
  page.on('response', async (resp) => {
    if (downloaded) return;
    const url = String(resp.url() || '');
    const type = String(resp.headers()['content-type'] || '').toLowerCase();
    if (resp.status() >= 200 && resp.status() < 400 && (type.includes('application/pdf') || /\.pdf(\?|$)/i.test(url) || url.toLowerCase().includes('pdf'))) {
      try {
        const buffer = await resp.buffer();
        if (buffer && buffer.length > 1024) {
          fs.writeFileSync(outPath, buffer);
          downloaded = true;
          console.log(`PDF_SAVED ${outPath} bytes=${buffer.length}`);
        }
      } catch (_) {}
    }
  });

  await page.goto(`https://worldwide.espacenet.com/patent/search/publication/${publication}`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => undefined);
  console.log(`OPENED publication=${publication}`);
  console.log('Resolva challenge/manual refresh na janela se necessário. O script tenta baixar automaticamente.');

  const started = Date.now();
  while (Date.now() - started < 20 * 60 * 1000) {
    const ready = await hasPatentContent(page);
    if (ready) {
      await clickByText(page, ['original document', 'documento original']).catch(() => undefined);
      await wait(800);
      await clickByText(page, ['download', 'baixar']).catch(() => undefined);
      await wait(700);
      await clickByText(page, ['original document', 'documento original']).catch(() => undefined);
      await wait(1500);
      if (downloaded) break;
    } else {
      await wait(2000);
    }
  }

  console.log(downloaded ? 'RESULT success' : 'RESULT no_pdf_captured');
  await wait(120000);
}

run().catch((error) => {
  console.error(`SESSION_TEST_ERROR ${error?.message || String(error)}`);
  process.exit(1);
});
