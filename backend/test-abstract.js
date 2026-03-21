const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

async function test() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const candidate = "BR122025025676";
    
    console.log("Going directly to /pt...");
    const url = `https://patents.google.com/patent/${candidate}/pt`;
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    console.log("Status:", response.status());
    
    if (response.status() === 200) {
        const html = await page.content();
        const $ = cheerio.load(html);
        
        const candidates = [
            $('meta[name="DC.description"]').attr('content'),
            $('meta[name="description"]').attr('content'),
            $('section[itemprop="abstract"] div.abstract').first().text(),
            $('div.abstract').first().text(),
            $('abstract').first().text()
        ];
        console.log("Candidates:");
        candidates.forEach((c, i) => {
            const v = (c || '').trim();
            console.log(`[${i}] len=${v.length}`, v.substring(0, 50));
        });
    }
    
    await browser.close();
}
test();