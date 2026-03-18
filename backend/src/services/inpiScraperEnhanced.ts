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
const INPI_HUMANIZE_MIN_MS = Math.max(400, parseInt(process.env.INPI_HUMANIZE_MIN_MS || '900', 10));
const INPI_HUMANIZE_MAX_MS = Math.max(INPI_HUMANIZE_MIN_MS + 150, parseInt(process.env.INPI_HUMANIZE_MAX_MS || '2600', 10));
const INPI_HUMANIZE_TYPING_DELAY_MIN = Math.max(12, parseInt(process.env.INPI_HUMANIZE_TYPING_DELAY_MIN || '24', 10));
const INPI_HUMANIZE_TYPING_DELAY_MAX = Math.max(INPI_HUMANIZE_TYPING_DELAY_MIN, parseInt(process.env.INPI_HUMANIZE_TYPING_DELAY_MAX || '72', 10));

let sharedBrowser: Browser | null = null;
let sharedPage: Page | null = null;
let sessionStartedAt = 0;
let sessionQueue: Promise<void> = Promise.resolve();

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function randomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanPause(multiplier = 1) {
    const waitMs = Math.round(randomInt(INPI_HUMANIZE_MIN_MS, INPI_HUMANIZE_MAX_MS) * multiplier);
    await sleep(waitMs);
}

function humanTypingDelay() {
    return randomInt(INPI_HUMANIZE_TYPING_DELAY_MIN, INPI_HUMANIZE_TYPING_DELAY_MAX);
}

async function humanScroll(page: Page) {
    await page.evaluate((delta) => window.scrollBy(0, delta), randomInt(180, 520));
    await humanPause(0.45);
}

function normalizeFlat(value?: string) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function parseBrDate(value?: string): Date | null {
    const text = normalizeFlat(value);
    const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const dt = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function classifyPatentStatus(despachoCode?: string, complement?: string) {
    const code = normalizeFlat(despachoCode).toLowerCase();
    const text = normalizeFlat(complement).toLowerCase();
    const merged = `${code} ${text}`;
    if (merged.includes('indefer')) return 'indeferida';
    if (merged.includes('conced')) return 'concedida';
    if (merged.includes('arquivad')) return 'arquivada';
    if (merged.includes('exig')) return 'com_exigencia';
    if (merged.includes('defer')) return 'deferida';
    return 'em_andamento';
}

function rankPublicationEvent(item: { rpi?: string; date?: string }) {
    const dateWeight = parseBrDate(item.date)?.getTime() || 0;
    const rpiWeight = Number((item.rpi || '').replace(/[^\d]/g, '')) || 0;
    return dateWeight * 100000 + rpiWeight;
}

function isInpiMaintenancePage(html?: string, title?: string) {
    const text = normalizeFlat(`${title || ''} ${html || ''}`).toLowerCase();
    if (!text) return false;
    return text.includes('manutenção')
        || text.includes('manutencao')
        || text.includes('temporariamente indispon')
        || text.includes('serviço indispon')
        || text.includes('servico indispon');
}

function hasJavaApplet(html?: string): boolean {
    const text = html || '';
    return text.includes('<applet')
        || text.includes('java:')
        || text.includes('javax.swing')
        || text.includes('java.lang')
        || text.includes('java.awt')
        || text.includes('class="applet"')
        || text.includes('type="application/x-java-applet"');
}

function isBrokenLinkPage(html?: string, title?: string): boolean {
    const text = normalizeFlat(`${title || ''} ${html || ''}`).toLowerCase();
    return text.includes('página não encontrada')
        || text.includes('404')
        || text.includes('erro')
        || text.includes('não existe')
        || text.includes('link inválido')
        || text.includes('sessão expirada');
}

function detectInpiInterfaceType(html: string): 'modern' | 'legacy' | 'applet' | 'broken' {
    if (hasJavaApplet(html)) return 'applet';
    if (isBrokenLinkPage(html)) return 'broken';
    if (html.includes('PatenteSearchBasico.jsp') || html.includes('PatenteServletController')) return 'legacy';
    return 'modern';
}

function isSessionExpired(html: string, url: string): boolean {
    const text = normalizeFlat(html).toLowerCase();
    return text.includes('sessão expirada')
        || text.includes('login')
        || text.includes('autenticação')
        || url.includes('login')
        || url.includes('LoginController');
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

async function ensureLoggedIn(page: Page): Promise<boolean> {
    const loginUrl = 'https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login';
    
    // Tentar carregar cookies primeiro
    await tryLoadCookies(page).catch(() => undefined);
    
    // Verificar se já está logado
    await page.goto('https://busca.inpi.gov.br/pePI/', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => undefined);
    await humanPause(0.8);
    
    const isLoggedIn = await page.evaluate(() => {
        const bodyText = (document.body?.innerText || '').toLowerCase();
        return !bodyText.includes('login') && !bodyText.includes('entrar') && !bodyText.includes('autenticação');
    }).catch(() => false);
    
    if (isLoggedIn) {
        console.log('✅ Sessão INPI já ativa');
        await persistCookies(page).catch(() => undefined);
        return true;
    }
    
    // Fazer login
    console.log('🔐 Realizando login no INPI...');
    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await humanPause(1.0);
    
    let hasLoginInput = await page.$('input[name="T_Login"]');
    if (!hasLoginInput) {
        // Tentar encontrar link de login
        const foundLogin = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const loginLink = links.find((link) => {
                const text = (link.textContent || '').toLowerCase();
                return text.includes('login') || text.includes('entrar') || text.includes('acessar');
            });
            if (loginLink) {
                (loginLink as HTMLAnchorElement).click();
                return true;
            }
            return false;
        }).catch(() => false);
        
        if (foundLogin) {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => undefined);
            await humanPause(1.2);
            hasLoginInput = await page.$('input[name="T_Login"]');
        }
    }
    
    if (hasLoginInput && INPI_USER && INPI_PASSWORD) {
        console.log(`🔑 Logando como: ${INPI_USER}`);
        await humanPause(0.7);
        
        // Preencher login com cuidado
        await page.click('input[name="T_Login"]', { clickCount: 3 }).catch(() => undefined);
        await page.keyboard.press('Backspace').catch(() => undefined);
        await page.type('input[name="T_Login"]', INPI_USER, { delay: humanTypingDelay() });
        
        await humanPause(0.5);
        
        // Preencher senha
        await page.click('input[name="T_Senha"]', { clickCount: 3 }).catch(() => undefined);
        await page.keyboard.press('Backspace').catch(() => undefined);
        await page.type('input[name="T_Senha"]', INPI_PASSWORD, { delay: humanTypingDelay() });
        
        await humanPause(0.8);
        
        // Clicar no botão de submit
        const loginSuccess = await Promise.race([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }),
            new Promise(resolve => setTimeout(() => resolve(false), 5000))
        ]).then(() => true).catch(() => false);
        
        if (!loginSuccess) {
            // Tentar enviar o form manualmente
            await page.evaluate(() => {
                const forms = document.querySelectorAll('form');
                if (forms.length > 0) {
                    (forms[0] as HTMLFormElement).submit();
                }
            }).catch(() => undefined);
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => undefined);
        }
        
        await humanPause(1.5);
        
        // Verificar se login foi bem sucedido
        const currentUrl = page.url();
        const loginWorked = !currentUrl.includes('login') && !currentUrl.includes('autenticação');
        
        if (loginWorked) {
            console.log('✅ Login no INPI realizado com sucesso');
            await persistCookies(page).catch(() => undefined);
            return true;
        }
    }
    
    console.log('❌ Falha no login do INPI');
    return false;
}

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
        
        const loginSuccess = await ensureLoggedIn(sharedPage);
        if (!loginSuccess) {
            throw new Error('Falha no login do INPI');
        }
        
        sessionStartedAt = Date.now();
    }
    if (!sharedPage) {
        throw new Error('INPI browser session unavailable');
    }
    return sharedPage;
}

async function navigateToPatentSearch(page: Page) {
    await page.goto('https://busca.inpi.gov.br/pePI/', { waitUntil: 'networkidle2', timeout: 60000 });
    await humanPause(1.0);
    
    // Verificar se precisa navegar para patentes
    const needsNavigation = await page.evaluate(() => {
        const bodyText = (document.body?.innerText || '').toLowerCase();
        return !bodyText.includes('patente') && !bodyText.includes('pesquisa');
    }).catch(() => true);
    
    if (needsNavigation) {
        await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const patenteLink = links.find((link) => {
                const txt = (link.textContent || '').toLowerCase();
                return txt.includes('patente') || txt.includes('patentes');
            });
            if (patenteLink) (patenteLink as HTMLAnchorElement).click();
        });
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => undefined);
        await humanPause(1.2);
    }
}

async function searchAndOpenPatentDetail(page: Page, codPedido: string) {
    await navigateToPatentSearch(page);
    
    const searchUrl = 'https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchBasico.jsp';
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await humanPause(1.2);
    await humanScroll(page);
    
    const normalized = codPedido.toUpperCase().replace(/[^0-9A-Z]/g, '');
    
    // Preencher campo de busca
    const searchFilled = await page.evaluate((target) => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')) as HTMLInputElement[];
        const input = inputs.find((item) => {
            const key = `${item.name || ''} ${(item.id || '')} ${(item.placeholder || '')}`.toLowerCase();
            return key.includes('pedido') || key.includes('patente') || key.includes('processo') || key.includes('numero');
        }) || inputs[0];
        
        if (!input) return false;
        
        input.focus();
        input.value = target;
        
        const form = input.form || (document.querySelector('form') as HTMLFormElement | null);
        if (!form) return false;
        
        const submit = form.querySelector('input[type="submit"], button[type="submit"], input[name="botao"]') as HTMLElement | null;
        if (submit) {
            submit.click();
            return true;
        } else {
            form.submit();
            return true;
        }
    }, normalized);
    
    if (!searchFilled) {
        throw new Error('Não foi possível encontrar o campo de busca');
    }
    
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => undefined);
    await humanPause(1.3);
    await humanScroll(page);
    
    // Verificar se a sessão expirou durante a busca
    const currentHtml = await page.content();
    const currentUrl = page.url();
    
    if (isSessionExpired(currentHtml, currentUrl)) {
        console.log('🔄 Sessão expirou durante a busca, reconectando...');
        await ensureLoggedIn(page);
        return await searchAndOpenPatentDetail(page, codPedido);
    }
    
    // Tentar clicar no resultado
    const resultClicked = await page.evaluate((target) => {
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
                return { href, text, score, element: link };
            })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score);
        
        if (!ranked.length) return false;
        
        const bestMatch = ranked[0];
        bestMatch.element.click();
        return true;
    }, normalized);
    
    if (resultClicked) {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => undefined);
        await humanPause(1.15);
        await humanScroll(page);
        return true;
    }
    
    // Se não encontrou resultado, tentar URL direta
    const detailUrl = `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${codPedido}`;
    await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await humanPause(1.2);
    
    return false;
}

async function extractPatentData(page: Page, codPedido: string) {
    const html = await page.content();
    
    // Verificar se sessão expirou
    if (isSessionExpired(html, page.url())) {
        console.log('🔄 Sessão expirou durante extração, reconectando...');
        await ensureLoggedIn(page);
        await searchAndOpenPatentDetail(page, codPedido);
        return await extractPatentData(page, codPedido);
    }
    
    const $ = cheerio.load(html);
    
    // Extrair dados básicos da patente
    const data = {
        numeroProcesso: codPedido,
        titulo: normalizeFlat($('h1, .titulo, .title').first().text()),
        resumo: normalizeFlat($('.resumo, .abstract, .summary').first().text()),
        dataDeposito: normalizeFlat($('td:contains("Data do Depósito")').next().text()),
        titular: normalizeFlat($('td:contains("Titular")').next().text()),
        inventor: normalizeFlat($('td:contains("Inventor")').next().text()),
        classificacao: normalizeFlat($('td:contains("Classificação")').next().text()),
        status: classifyPatentStatus(
            normalizeFlat($('td:contains("Despacho")').next().text()),
            normalizeFlat($('td:contains("Complemento")').next().text())
        ),
        html: html
    };
    
    return data;
}

export async function scrapeInpiPatent(codPedido: string) {
    return await withSessionLock(async () => {
        const page = await ensureSessionPage();
        
        try {
            console.log(`🔍 Buscando patente INPI: ${codPedido}`);
            
            const success = await searchAndOpenPatentDetail(page, codPedido);
            if (!success) {
                throw new Error(`Não foi possível encontrar a patente ${codPedido}`);
            }
            
            const patentData = await extractPatentData(page, codPedido);
            console.log(`✅ Patente ${codPedido} processada com sucesso`);
            
            return patentData;
            
        } catch (error) {
            console.error(`❌ Erro ao processar patente ${codPedido}:`, error);
            throw error;
        }
    });
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
            push('login_attempt', { user: INPI_USER });
        }
        
        // Continuar com os passos de busca...
        
    } catch (error) {
        push('error', { message: (error as Error).message });
    } finally {
        await browser.close();
    }
    
    return steps;
}