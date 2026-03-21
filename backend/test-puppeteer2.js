const puppeteer = require('puppeteer');
async function test() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const cands = ["BR122025017980", "BR122025020294", "BR122025021511"];
    for (const c of cands) {
        console.log("Checking:", c);
        const url = `https://patents.google.com/patent/${c}/en`;
        const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
        console.log("Status:", response.status());
        if (response.status() === 200) {
            const hasHref = await page.evaluate(() => {
                const a = Array.from(document.querySelectorAll('a')).find(el => el.textContent.includes('Download PDF'));
                return a ? !!a.href : false;
            });
            console.log("Has download link href?", hasHref);
        }
    }
    await browser.close();
}
test();
