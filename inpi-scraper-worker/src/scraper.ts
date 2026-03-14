import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import * as dotenv from 'dotenv';
import { prisma } from './db.js';
import { updateWorkerState, state } from './state.js';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const DOWNLOAD_DIR = path.resolve(process.cwd(), 'data', 'pdfs');
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Add stealth plugin and use defaults
// Add stealth plugin and use defaults
puppeteer.use(StealthPlugin());

const INPI_USER = process.env.INPI_USER || '';
const INPI_PASSWORD = process.env.INPI_PASSWORD || '';
const WAIT_MS = 2000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function initBrowser() {
    console.log("Launching Puppeteer Stealth Browser...");
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
    return browser;
}

async function scrapeMonth(year: number, month: number) {
    console.log(`\n=== Starting Scraping for ${month.toString().padStart(2, '0')}/${year} ===`);
    const browser = await initBrowser();
    const page = await browser.newPage();

    // Set a realistic viewport
    await page.setViewport({ width: 1280, height: 800 });

    try {
        console.log("Navigating to INPI Login...");
        await page.goto('https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login', { waitUntil: 'networkidle2', timeout: 60000 });

        if (INPI_USER && INPI_PASSWORD) {
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
            }
        } else {
            console.log("Using anonymous session... (PDFs won't be downloaded)");
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const continuarLink = links.find(l => (l.textContent || '').includes('Continuar'));
                    if (continuarLink) continuarLink.click();
                })
            ]);
        }

        console.log("Going to Patentes section...");
        await page.goto('https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchBasico.jsp', { waitUntil: 'networkidle2' });

        console.log("Going to Advanced Search...");
        await page.goto('https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=SearchAvancado', { waitUntil: 'networkidle2' });

        const startDate = `01/${month.toString().padStart(2, '0')}/${year}`;
        const endDate = `31/${month.toString().padStart(2, '0')}/${year}`;

        let currentPage = 1;
        let keepGoing = true;

        while (keepGoing) {
            console.log(`\nFetching Page ${currentPage} for ${startDate} to ${endDate}...`);

            // Go to advanced search
            await page.goto('https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=SearchAvancado', { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Fill dates
            await page.type('input[name="DataDeposito1"]', startDate);
            await page.type('input[name="DataDeposito2"]', endDate);

            // Choose 100 per page
            await page.select('select[name="RegisterPerPage"]', '100');

            // Click Search
            console.log("Executing search (INPI may be slow)...");
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }),
                page.click('input[name="botao"]'),
            ]);

            // If we are past page 1, we need to jump
            if (currentPage > 1) {
                const canJump = await page.$(`form[name="TargetPageForm"]`);
                if (!canJump) {
                    console.log("No pagination form found. Assuming end of results.");
                    break;
                }

                // We are already on Page 1 after the search button, now we trigger the JS jump function
                // INPI uses window.jumpPage(pageNumber)
                const pageJumped = await page.evaluate((targetPage) => {
                    // @ts-ignore
                    if (typeof window.jumpPage === 'function') {
                        // @ts-ignore
                        window.jumpPage(targetPage);
                        return true;
                    }
                    return false;
                }, currentPage.toString());

                if (pageJumped) {
                    console.log(`Waiting for page ${currentPage} to load...`);
                    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 });
                } else {
                    console.log("Could not trigger jumpPage, stopping pagination.");
                    break;
                }
            }

            const html = await page.content();
            const $ = cheerio.load(html);

            const rows = $('table').eq(1).find('tr:not(:first-child)');
            if (!rows || rows.length === 0 || html.includes('Nenhum resultado de')) {
                console.log("No more results for this month.");
                break;
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

            if (patentsToProcess.length === 0) break;
            console.log(`Found ${patentsToProcess.length} patents on page ${currentPage}. Processing details...`);

            for (const cod of patentsToProcess) {
                await sleep(WAIT_MS);
                console.log(`-> Fetching detail for: ${cod}`);

                // Access Detail Page
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
                    numero_publicacao: '', // Needs parsing depending on the block
                    title: extractValue('Título:'),
                    abstract: extractValue('Resumo:'),
                    applicant: extractValue('Depositante:'),
                    inventors: extractValue('Inventor:'),
                    status: 'Extracted',
                    filing_date: extractValue('Data do Depósito:'),
                    ipc_codes: extractValue('Classificação IPC:'),
                };

                // Save to PostgreSQL VPS Database
                try {
                    await prisma.inpiPatent.upsert({
                        where: { cod_pedido: data.cod_pedido },
                        update: {
                            numero_publicacao: data.numero_publicacao,
                            title: data.title,
                            abstract: data.abstract,
                            applicant: data.applicant,
                            inventors: data.inventors,
                            status: data.status,
                            filing_date: data.filing_date,
                            ipc_codes: data.ipc_codes
                        },
                        create: {
                            cod_pedido: data.cod_pedido,
                            numero_publicacao: data.numero_publicacao,
                            title: data.title,
                            abstract: data.abstract,
                            applicant: data.applicant,
                            inventors: data.inventors,
                            status: data.status,
                            filing_date: data.filing_date,
                            ipc_codes: data.ipc_codes
                        }
                    });
                    console.log(`   + Upserted ${cod} to PostgreSQL success.`);
                } catch (error: any) {
                    console.error(`Failed to upsert ${cod} to DB:`, error.message);
                }

                // Handling PDF download if available
                const hasDocs = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    return links.some(l => l.innerText.includes('Documentos'));
                });

                if (hasDocs) {
                    console.log(`   --> Documentos tab found for ${cod}. Initiating download...`);

                    // Set up download directory for this page via CDP
                    const client = await page.target().createCDPSession();
                    await client.send('Page.setDownloadBehavior', {
                        behavior: 'allow',
                        downloadPath: DOWNLOAD_DIR,
                    });

                    // Click Documentos and wait for reload
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'networkidle2' }),
                        page.evaluate(() => {
                            const links = Array.from(document.querySelectorAll('a'));
                            const docLink = links.find(l => l.innerText.includes('Documentos'));
                            if (docLink) docLink.click();
                        })
                    ]);

                    // Wait briefly for table to render if dynamic, though networkidle2 covers most
                    await sleep(1000);

                    // Find PDF links and click them
                    const pdfDownloaded = await page.evaluate(() => {
                        const allLinks = Array.from(document.querySelectorAll('a'));
                        const pdfLinks = allLinks.filter(l => l.innerText.toLowerCase().includes('pdf') || (l.href && l.href.includes('Download')));
                        if (pdfLinks.length > 0) {
                            // Click the very first one which is usually the main compiled document
                            pdfLinks[0].click();
                            return true;
                        }
                        return false;
                    });

                    if (pdfDownloaded) {
                        console.log(`   --> Triggered PDF download for ${cod}. Waiting for file...`);
                        // Wait a few seconds for the download stream to finish
                        await sleep(5000);
                    } else {
                        console.log(`   --> No valid PDF link found inside Documentos for ${cod}.`);
                    }
                }
            }

            currentPage++;
        }
    } catch (err: any) {
        console.error(`Error during scraping session: ${err.message}`);
    } finally {
        await browser.close();
        console.log(`Browser closed for ${month}/${year}`);
    }
}

import { processRpi } from './rpi-crawler.js';

export async function startWorkerLoop() {
    console.log("=== INPI RPI Worker Loop Started ===");
    updateWorkerState({ status: 'Running' });
    
    // For now, let's process the current week and the last few weeks to ensure coverage
    const latestRpi = 2879; // Hand-picked for 2026 test
    const startRpi = 2870; // Start of year approximately
    
    for (let current = latestRpi; current >= startRpi; current--) {
        try {
            console.log(`\n[Worker] Syncing RPI ${current}...`);
            updateWorkerState({ currentRPI: current });
            await processRpi(current);
            console.log(`[Worker] RPI ${current} synced successfully.`);
            
            // Humanized delay between RPI journals (ZIP downloads)
            const delay = Math.floor(Math.random() * 5000) + 3000;
            console.log(`[Worker] Waiting ${delay}ms before next journal...`);
            await sleep(delay);
        } catch (error: any) {
            console.error(`[Worker] Failed to process RPI ${current}:`, error.message);
            updateWorkerState({ errors: (state as any).errors + 1 });
        }
    }

    console.log("=== Initial 2026 Sync Complete ===");
    updateWorkerState({ status: 'Idle' });
    
    // Idle loop: check for new RPI every 12 hours
    while (true) {
        console.log("[Worker] Sleeping for 12 hours before next check...");
        await sleep(12 * 60 * 60 * 1000);
        updateWorkerState({ status: 'Running' });
        // Add logic to autodiscover next RPI here eventually
    }
}
