
import * as cheerio from 'cheerio';
import * as fs from 'fs';

const html = fs.readFileSync('detail_debug.html', 'utf8');
const $ = cheerio.load(html);

const extract = (label: string) => {
    // Find td containing the label, then get the next td's text
    // Note: The label might be in a font tag inside the td
    const td = $('td').filter((_, el) => $(el).text().includes(label)).first();
    console.log(`Searching for "${label}"... Found TD text: "${td.text().trim()}"`);
    const nextTd = td.next();
    console.log(`Next TD text: "${nextTd.text().trim()}"`);
    return nextTd.text().replace(/\s+/g, ' ').trim();
};

const applicant = extract('Nome do Depositante:');
const inventor = extract('Nome do Inventor:');
const title = extract('Título:');
const abstract = extract('Resumo:');

console.log({
    applicant,
    inventor,
    title,
    abstract
});
