import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import { prisma } from '../db';
import type { Browser, Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

const INPI_USER = process.env.INPI_USER || '';
const INPI_PASSWORD = process.env.INPI_PASSWORD || '';
const DOWNLOAD_DIR = '/tmp/inpi_pdfs';
const COOKIE_PATH = '/tmp/inpi_session_cookies.json';
const INPI_SESSION_TTL_MS = Math.max(5 * 60_000, parseInt(process.env.INPI_SESSION_TTL_MINUTES || '30', 10) * 60_000);

let sharedBrowser: Browser | null = null;
let sharedPage: Page | null = null;
let sessionStartedAt = 0;
let sessionQueue: Promise<void> = Promise.resolve();

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

async function withSessionLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = sessionQueue;
    let release!: () => void;
    sessionQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
        return await task();
    } finally {
        release();
    }
}

async function tryLoadCookies(page: Page) {
    if (!fs.existsSync(COOKIE_PATH)) return;
    const raw = fs.readFileSync(COOKIE_PATH, 'utf8').trim();
    if (!raw) return;
    const cookies = JSON.parse(raw);
    if (Array.isArray(cookies) && cookies.length > 0) {
        await page.setCookie(...cookies);
    }
}

async function persistCookies(page: Page) {
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies), 'utf8');
}

async function ensureLoggedIn(page: Page) {
    await page.goto('https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login', { waitUntil: 'networkidle2', timeout: 60000 });
    let hasLoginInput = await page.$('input[name="T_Login"]');
    if (!hasLoginInput) {
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const loginLink = links.find((link) => (link.textContent || '').toLowerCase().includes('login'));
            if (loginLink) (loginLink as HTMLAnchorElement).click();
        });
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => undefined);
        hasLoginInput = await page.$('input[name="T_Login"]');
    }
    if (hasLoginInput && INPI_USER && INPI_PASSWORD) {
        console.log(`Logging in as ${INPI_USER}...`);
        await page.type('input[name="T_Login"]', INPI_USER, { delay: 20 });
        await page.type('input[name="T_Senha"]', INPI_PASSWORD, { delay: 20 });
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
            page.click('input[type="submit"]')
        ]);
    } else if (hasLoginInput) {
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const continuarLink = links.find((link) => (link.textContent || '').toLowerCase().includes('continuar'));
            if (continuarLink) (continuarLink as HTMLAnchorElement).click();
        });
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => undefined);
    }
    await persistCookies(page).catch(() => undefined);
}

async function ensureSessionPage(): Promise<Page> {
    const now = Date.now();
    const expired = !sharedBrowser || !sharedPage || (now - sessionStartedAt) > INPI_SESSION_TTL_MS;
    if (expired) {
        if (sharedBrowser) {
            await sharedBrowser.close().catch(() => undefined);
        }
        sharedBrowser = await initBrowser();
        sharedPage = await sharedBrowser.newPage();
        await sharedPage.setViewport({ width: 1280, height: 1024 });
        await tryLoadCookies(sharedPage).catch(() => undefined);
        await ensureLoggedIn(sharedPage);
        sessionStartedAt = Date.now();
    }
    if (!sharedPage) {
        throw new Error('INPI browser session unavailable');
    }
    return sharedPage;
}

async function searchAndOpenPatentDetail(page: Page, codPedido: string) {
    const searchUrl = 'https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchBasico.jsp';
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    const normalized = codPedido.toUpperCase().replace(/[^0-9A-Z]/g, '');
    const searchPrepared = await page.evaluate((target) => {
        const normalize = (value: string) => value.toUpperCase().replace(/[^0-9A-Z]/g, '');
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')) as HTMLInputElement[];
        const input = inputs.find((item) => {
            const key = `${item.name || ''} ${(item.id || '')} ${(item.placeholder || '')}`.toLowerCase();
            return key.includes('pedido') || key.includes('patente') || key.includes('processo') || key.includes('numero');
        }) || inputs[0];
        if (!input) return { ok: false, selector: null };
        input.focus();
        input.value = target;
        const form = input.form || (document.querySelector('form') as HTMLFormElement | null);
        if (!form) return { ok: false, selector: input.name || input.id || '(anon)' };
        const submit = form.querySelector('input[type="submit"], button[type="submit"], input[name="botao"]') as HTMLElement | null;
        if (submit) {
            submit.click();
        } else {
            form.submit();
        }
        return { ok: true, selector: input.name || input.id || '(anon)' };
    }, codPedido);

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => undefined);

    const resultLink = await page.evaluate((target) => {
        const normalize = (value: string) => value.toUpperCase().replace(/[^0-9A-Z]/g, '');
        const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
        const ranked = links
            .map((link) => {
                const href = link.getAttribute('href') || '';
                const text = (link.textContent || '').trim();
                const hrefNorm = normalize(href);
                const textNorm = normalize(text);
                const score = (href.includes('CodPedido=') ? 2 : 0)
                    + (hrefNorm.includes(target) ? 4 : 0)
                    + (textNorm.includes(target) ? 3 : 0);
                return { href, text, score };
            })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score);
        if (!ranked.length) return null;
        const picked = ranked[0];
        const hit = links.find((link) => (link.getAttribute('href') || '') === picked.href && (link.textContent || '').trim() === picked.text);
        if (hit) hit.click();
        return picked;
    }, normalized);

    if (resultLink) {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => undefined);
        return { searchPrepared, resultLinkClicked: true, resultLink };
    }

    const detailUrl = `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${codPedido}`;
    await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    return { searchPrepared, resultLinkClicked: false, resultLink: null };
}

async function navigatePatentSearch(page: Page, codPedido: string) {
    await page.goto('https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const patenteLink = links.find((link) => {
            const txt = (link.textContent || '').toLowerCase();
            return txt.includes('patente') || txt.includes('patentes');
        });
        if (patenteLink) (patenteLink as HTMLAnchorElement).click();
    });
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => undefined);
    await searchAndOpenPatentDetail(page, codPedido);
}

export async function debugInpiScrapeSteps(codPedido: string) {
    const steps: Array<Record<string, unknown>> = [];
    const push = (step: string, data: Record<string, unknown> = {}) => steps.push({ step, ...data, at: new Date().toISOString() });
    const browser = await initBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 });
    try {
        await page.goto('https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login', { waitUntil: 'networkidle2', timeout: 60000 });
        push('open_login', { url: page.url(), title: await page.title() });

        let hasLoginInput = Boolean(await page.$('input[name="T_Login"]'));
        push('check_login_form', { hasLoginInput, hasCredentials: Boolean(INPI_USER && INPI_PASSWORD) });

        if (!hasLoginInput) {
            const clickedLoginLink = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const loginLink = links.find((link) => (link.textContent || '').toLowerCase().includes('login'));
                if (loginLink) {
                    (loginLink as HTMLAnchorElement).click();
                    return true;
                }
                return false;
            });
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => undefined);
            hasLoginInput = Boolean(await page.$('input[name="T_Login"]'));
            push('open_login_form', { clickedLoginLink, hasLoginInput });
        }

        if (hasLoginInput && INPI_USER && INPI_PASSWORD) {
            await page.type('input[name="T_Login"]', INPI_USER, { delay: 15 });
            await page.type('input[name="T_Senha"]', INPI_PASSWORD, { delay: 15 });
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
                page.click('input[type="submit"]')
            ]);
            push('submit_login', { url: page.url(), title: await page.title() });
        }

        const searchResult = await searchAndOpenPatentDetail(page, codPedido);
        push('search_and_click_result', searchResult as Record<string, unknown>);
        push('open_detail', { url: page.url(), title: await page.title() });

        const html = await page.content();
        const $ = cheerio.load(html);
        const extractValue = (label: string) => {
            const td = $(`font:contains("${label}")`).closest('td').next('td');
            return td.text().replace(/\s+/g, ' ').trim();
        };

        const fields = {
            title: extractValue('Título:'),
            abstract: extractValue('Resumo:'),
            applicant: extractValue('Depositante:'),
            inventor: extractValue('Inventor:'),
            filingDate: extractValue('Data do Depósito:'),
            ipc: extractValue('Classificação IPC:'),
            status: extractValue('Situação:') || extractValue('Despacho:')
        };
        push('extract_fields', {
            lengths: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, (value || '').length])),
            hasAny: Object.values(fields).some(Boolean),
            labelsPresent: {
                titulo: html.includes('Título:'),
                resumo: html.includes('Resumo:'),
                depositante: html.includes('Depositante:'),
                inventor: html.includes('Inventor:'),
                dataDeposito: html.includes('Data do Depósito:'),
                ipc: html.includes('Classificação IPC:')
            }
        });
        return { ok: Object.values(fields).some(Boolean), codPedido, steps };
    } catch (error: any) {
        push('error', { message: error?.message || String(error) });
        return { ok: false, codPedido, steps };
    } finally {
        await browser.close().catch(() => undefined);
    }
}

export async function scrapeInpiPatent(codPedido: string) {
    return withSessionLock(async () => {
        console.log(`Starting full scrape for patent: ${codPedido}`);
        const page = await ensureSessionPage();
        await navigatePatentSearch(page, codPedido);
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
        const hasBibliographicData = Boolean(title || applicant || inventors || ipc_codes || filing_date);
        if (!hasBibliographicData) {
            throw new Error(`INPI bibliographic data not found for ${codPedido}`);
        }

        await prisma.inpiPatent.upsert({
            where: { cod_pedido: codPedido },
            update: {
                title: title || undefined,
                abstract: abstract || undefined,
                applicant: applicant || undefined,
                inventors: inventors || undefined,
                filing_date: filing_date || undefined,
                ipc_codes: ipc_codes || undefined,
                status: status || undefined,
                updated_at: new Date()
            },
            create: {
                cod_pedido: codPedido,
                title: title || '',
                abstract: abstract || '',
                applicant: applicant || '',
                inventors: inventors || '',
                filing_date: filing_date || '',
                ipc_codes: ipc_codes || '',
                status: status || ''
            }
        });

        const annuitiesTable = $('font:contains("Anuidades")').closest('table').next('table');
        if (annuitiesTable.length) {
            const rows = annuitiesTable.find('tr').slice(2);
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

        console.log(`Scrape completed for ${codPedido}`);
    }).catch((err: any) => {
        console.error(`Scrape failed for ${codPedido}: ${err.message}`);
        throw err;
    });
}
