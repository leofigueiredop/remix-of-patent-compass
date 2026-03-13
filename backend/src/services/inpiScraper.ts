import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../db';
import { randomUUID } from 'crypto';

puppeteer.use(StealthPlugin());

const INPI_USER = process.env.INPI_USER || '';
const INPI_PASSWORD = process.env.INPI_PASSWORD || '';
const DOWNLOAD_DIR = '/tmp/inpi_pdfs';

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function initBrowser() {
    return await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });
}

export async function scrapeInpiPatent(codPedido: string) {
    console.log(`Starting full scrape for patent: ${codPedido}`);
    const browser = await initBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 });

    try {
        // Step 1: Login
        await page.goto('https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login', { waitUntil: 'networkidle2', timeout: 60000 });

        if (INPI_USER && INPI_PASSWORD) {
            console.log(`Logging in as ${INPI_USER}...`);
            await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const loginLink = links.find(l => (l.textContent || '').includes('Login'));
                if (loginLink) loginLink.click();
            });
            await page.waitForSelector('input[name="T_Login"]', { timeout: 10000 });
            await page.type('input[name="T_Login"]', INPI_USER);
            await page.type('input[name="T_Senha"]', INPI_PASSWORD);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                page.click('input[type="submit"]'),
            ]);
        } else {
            console.log("Using anonymous session...");
            await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const continuarLink = links.find(l => (l.textContent || '').includes('Continuar'));
                if (continuarLink) continuarLink.click();
            });
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
        }

        // Step 2: Navigate to Detail Page
        const detailUrl = `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${codPedido}`;
        await page.goto(detailUrl, { waitUntil: 'networkidle2' });
        
        const html = await page.content();
        const $ = cheerio.load(html);

        // Extract Header Data
        const extractValue = (label: string) => {
            const td = $(`font:contains("${label}")`).closest('td').next('td');
            return td.text().replace(/\s+/g, ' ').trim();
        };

        const title = extractValue('Título:');
        const abstract = extractValue('Resumo:');
        const applicant = extractValue('Depositante:');
        const inventors = extractValue('Inventor:');
        const filing_date = extractValue('Data do Depósito:');
        const ipc_codes = extractValue('Classificação IPC:');
        const status = extractValue('Situação:') || extractValue('Despacho:');

        // Upsert Main Patent Record
        await prisma.inpiPatent.upsert({
            where: { cod_pedido: codPedido },
            update: {
                title,
                abstract,
                applicant,
                inventors,
                filing_date,
                ipc_codes,
                status,
                updated_at: new Date()
            },
            create: {
                cod_pedido: codPedido,
                title,
                abstract,
                applicant,
                inventors,
                filing_date,
                ipc_codes,
                status
            }
        });

        // Step 3: Parse Tables
        
        // 3.1 Annuities
        const annuitiesTable = $('font:contains("Anuidades")').closest('table').next('table');
        if (annuitiesTable.length) {
            const rows = annuitiesTable.find('tr').slice(2); // Skip header rows
            for (let i = 0; i < rows.length; i++) {
                const cols = $(rows[i]).find('td');
                if (cols.length >= 2) {
                    const title = $(cols[0]).text().trim();
                    const dates = $(cols[1]).text().trim().split(' ');
                    const start_date = dates[0] || '';
                    const end_date = dates[2] || '';
                    if (title) {
                        await prisma.inpiAnnuity.create({
                            data: {
                                patent_id: codPedido,
                                title,
                                start_date,
                                end_date,
                                status: 'Parsed' // Simplified
                            }
                        });
                    }
                }
            }
        }

        // 3.2 Petitions
        const petitionsTable = $('font:contains("Petições")').closest('table').next('table');
        if (petitionsTable.length) {
            const rows = petitionsTable.find('tr').slice(1);
            for (let i = 0; i < rows.length; i++) {
                const cols = $(rows[i]).find('td');
                if (cols.length >= 4) {
                    await prisma.inpiPetition.create({
                        data: {
                            patent_id: codPedido,
                            service_code: $(cols[0]).text().trim(),
                            protocol: $(cols[2]).text().trim(),
                            date: $(cols[3]).text().trim(),
                            client: $(cols[6]).text().trim(),
                            delivery: $(cols[7]).text().trim()
                        }
                    });
                }
            }
        }

        // 3.3 Publications (Crucial for PDFs)
        const publicationsTable = $('font:contains("Publicações")').closest('table').next('table');
        if (publicationsTable.length) {
            const rows = publicationsTable.find('tr').slice(1);
            for (let i = 0; i < rows.length; i++) {
                const cols = $(rows[i]).find('td');
                if (cols.length >= 3) {
                    const rpi = $(cols[0]).text().trim();
                    const date = $(cols[1]).text().trim();
                    const despacho_code = $(cols[2]).text().trim();
                    const complement = $(cols[4]).text().trim();
                    
                    // In a real scenario, we might want to capture the link if it exists
                    const pdfLink = $(cols[3]).find('a').attr('href');
                    
                    await prisma.inpiPublication.create({
                        data: {
                            patent_id: codPedido,
                            rpi,
                            date,
                            despacho_code,
                            complement,
                            rpi_url: pdfLink
                        }
                    });
                }
            }
        }

        // Optional: Trigger PDF downloads if needed (handled by the specific worker phase)
        console.log(`Scrape completed for ${codPedido}`);

    } catch (err: any) {
        console.error(`Scrape failed for ${codPedido}: ${err.message}`);
        throw err;
    } finally {
        await browser.close();
    }
}
