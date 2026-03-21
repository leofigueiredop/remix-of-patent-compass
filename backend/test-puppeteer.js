const puppeteer = require('puppeteer');
const fs = require('fs');
async function test() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const candidate = "BR122025025676";
    
    console.log("Going directly to patent page...");
    const url = `https://patents.google.com/patent/${candidate}/en`;
    const response = await page.goto(url, { waitUntil: 'networkidle2' });
    console.log("Status:", response.status());
    
    const html = await page.content();
    fs.writeFileSync('page.html', html);
    
    await browser.close();
}
test();
