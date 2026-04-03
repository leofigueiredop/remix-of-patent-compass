import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import anticaptcha from '@antiadmin/anticaptchaofficial';
import { prisma } from '../db';
import type { Browser, Page } from 'puppeteer';
import { sanitizeInpiDetailedAbstract } from './inpiSummarySanitizer';

puppeteer.use(StealthPlugin());

const INPI_USER = process.env.INPI_USER || '';
const INPI_PASSWORD = process.env.INPI_PASSWORD || '';
const ANTI_CAPTCHA_API_KEY = process.env.ANTI_CAPTCHA_API_KEY || '';
const DOWNLOAD_DIR = process.env.INPI_DOWNLOAD_DIR || '/tmp/inpi_documents';
const COOKIE_PATH = '/tmp/inpi_session_cookies.json';

// Configurações de humanização AVANÇADAS
const INPI_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutos
const INPI_HUMANIZE_MIN_MS = 1200; // Aumentado para evitar bloqueio
const INPI_HUMANIZE_MAX_MS = 3500; // Aumentado para parecer mais humano
const INPI_HUMANIZE_TYPING_DELAY_MIN = 45; // Digitação mais lenta
const INPI_HUMANIZE_TYPING_DELAY_MAX = 120;
const INPI_RANDOM_MOUSE_MOVEMENTS = true;
const INPI_RANDOM_SCROLLING = true;
const INPI_NAVIGATION_TIMEOUT_MS = Math.max(120_000, parseInt(process.env.INPI_NAVIGATION_TIMEOUT_MS || '180000', 10));
const INPI_WAIT_TIMEOUT_MS = Math.max(90_000, parseInt(process.env.INPI_WAIT_TIMEOUT_MS || '180000', 10));
const INPI_DOWNLOAD_TIMEOUT_MS = Math.max(90_000, parseInt(process.env.INPI_DOWNLOAD_TIMEOUT_MS || '150000', 10));
const TARGET_DOCUMENT_DISPATCHES = ['3.1', '1.3', '16.1'] as const;

// Controle de rate limiting
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3000; // 3 segundos entre requests

let sharedBrowser: Browser | null = null;
let sharedPage: Page | null = null;
let sessionStartedAt = 0;
let sessionQueue: Promise<void> = Promise.resolve();
const CHROME_CANDIDATE_PATHS = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/lib/chromium/chromium',
    '/usr/lib/chromium/chrome',
    '/snap/bin/chromium'
].filter((item): item is string => Boolean(item && item.trim()));

function formatLaunchError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (error && typeof error === 'object') {
        const anyErr = error as any;
        if (typeof anyErr.message === 'string' && anyErr.message.trim()) return anyErr.message;
        try {
            return JSON.stringify(anyErr);
        } catch {
            return String(anyErr);
        }
    }
    return String(error);
}

function isDetachedFrameError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    const lower = message.toLowerCase();
    return lower.includes('detached frame')
        || lower.includes('execution context was destroyed')
        || lower.includes('target closed')
        || lower.includes('session closed');
}

async function resetSharedSession() {
    if (sharedBrowser) {
        await sharedBrowser.close().catch(() => undefined);
    }
    sharedBrowser = null;
    sharedPage = null;
    sessionStartedAt = 0;
}

async function getSessionCookieHeader(): Promise<string | undefined> {
    try {
        const page = sharedPage;
        if (!page) return undefined;
        const cookies = await page.cookies();
        if (!cookies || !cookies.length) return undefined;
        return cookies.map(c => `${c.name}=${c.value}`).join('; ');
    } catch {
        return undefined;
    }
}
// Garantir diretório de downloads
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
    if (!INPI_RANDOM_SCROLLING) return;
    
    const scrollAmount = randomInt(200, 600);
    const scrollDirection = Math.random() > 0.5 ? 1 : -1;
    
    await page.evaluate((amount, direction) => {
        window.scrollBy(0, amount * direction);
    }, scrollAmount, scrollDirection);
    
    await humanPause(0.3);
}

async function humanMouseMovement(page: Page) {
    if (!INPI_RANDOM_MOUSE_MOVEMENTS) return;
    
    try {
        const x = randomInt(100, 400);
        const y = randomInt(100, 300);
        await page.mouse.move(x, y);
        await humanPause(0.2);
    } catch (error) {
        // Ignora erros de movimento do mouse
    }
}

function normalizeFlat(value?: string) {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function cleanBibliographicField(value?: string): string {
    const normalized = normalizeFlat(value);
    if (!normalized) return '';
    return normalized
        .replace(/\b(?:resumo|classifica[cç][aã]o(?:\s+(?:ipc|cpc|internacional))?|titular|depositante|inventor(?:es)?|procurador)\s*[:\-]\s*$/i, '')
        .replace(/\(\s*(?:57|71|72|73|74)\s*\)\s*$/i, '')
        .trim();
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

async function rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        await sleep(waitTime + randomInt(100, 500)); // Adiciona variação
    }
    
    lastRequestTime = Date.now();
}

async function tryLoadCookies(page: Page) {
    if (!fs.existsSync(COOKIE_PATH)) return;
    try {
        const raw = fs.readFileSync(COOKIE_PATH, 'utf8').trim();
        if (!raw) return;
        const cookies = JSON.parse(raw);
        if (Array.isArray(cookies) && cookies.length > 0) {
            await page.setCookie(...cookies);
        }
    } catch (error) {
        // Ignora erros de cookies
    }
}

async function persistCookies(page: Page) {
    try {
        const cookies = await page.cookies();
        fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies), 'utf8');
    } catch (error) {
        // Ignora erros de persistência
    }
}

async function ensureLoggedIn(page: Page): Promise<boolean> {
    await rateLimit();
    
    const loginUrl = 'https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login';
    
    await tryLoadCookies(page);
    await humanPause(0.8);
    
    // Verificar se já está logado
    await page.goto('https://busca.inpi.gov.br/pePI/', { 
        waitUntil: 'networkidle2', 
        timeout: INPI_NAVIGATION_TIMEOUT_MS 
    }).catch(() => undefined);
    
    await humanPause(1.2);
    await humanMouseMovement(page);
    
    const isLoggedIn = await page.evaluate(() => {
        const bodyText = (document.body?.innerText || '').toLowerCase();
        return !bodyText.includes('login') && !bodyText.includes('entrar') && !bodyText.includes('autenticação');
    }).catch(() => false);
    
    if (isLoggedIn) {
        console.log('✅ Sessão INPI ativa');
        await persistCookies(page);
        return true;
    }
    
    // Fazer login
    console.log('🔐 Realizando login no INPI...');
    await page.goto(loginUrl, { 
        waitUntil: 'networkidle2', 
        timeout: INPI_NAVIGATION_TIMEOUT_MS 
    });
    
    await humanPause(1.5);
    await humanScroll(page);
    await humanMouseMovement(page);
    
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
            await page.waitForNavigation({ 
                waitUntil: 'networkidle2', 
                timeout: INPI_WAIT_TIMEOUT_MS 
            }).catch(() => undefined);
            
            await humanPause(1.8);
            hasLoginInput = await page.$('input[name="T_Login"]');
        }
    }
    
    if (hasLoginInput && INPI_USER && INPI_PASSWORD) {
        console.log(`🔑 Logando como: ${INPI_USER}`);
        await humanPause(1.0);
        
        // Preencher login com comportamento humano
        await humanMouseMovement(page);
        await page.click('input[name="T_Login"]', { 
            clickCount: 3,
            delay: humanTypingDelay() 
        }).catch(() => undefined);
        
        await humanPause(0.3);
        await page.keyboard.press('Backspace').catch(() => undefined);
        
        for (const char of INPI_USER.split('')) {
            await page.type('input[name="T_Login"]', char, { 
                delay: humanTypingDelay() 
            });
            await humanPause(0.05);
        }
        
        await humanPause(0.7);
        
        // Preencher senha
        await humanMouseMovement(page);
        await page.click('input[name="T_Senha"]', { 
            clickCount: 3,
            delay: humanTypingDelay() 
        }).catch(() => undefined);
        
        await humanPause(0.3);
        await page.keyboard.press('Backspace').catch(() => undefined);
        
        for (const char of INPI_PASSWORD.split('')) {
            await page.type('input[name="T_Senha"]', char, { 
                delay: humanTypingDelay() 
            });
            await humanPause(0.06);
        }
        
        await humanPause(0.9);
        
        // Clicar no botão de submit
        const loginSuccess = await Promise.race([
            page.waitForNavigation({ 
                waitUntil: 'networkidle2', 
                timeout: INPI_WAIT_TIMEOUT_MS 
            }),
            new Promise(resolve => setTimeout(() => resolve(false), 6000))
        ]).then(() => true).catch(() => false);
        
        if (!loginSuccess) {
            // Tentar enviar o form manualmente
            await page.evaluate(() => {
                const forms = document.querySelectorAll('form');
                if (forms.length > 0) {
                    (forms[0] as HTMLFormElement).submit();
                }
            }).catch(() => undefined);
            
            await page.waitForNavigation({ 
                waitUntil: 'networkidle2', 
                timeout: INPI_WAIT_TIMEOUT_MS 
            }).catch(() => undefined);
        }
        
        await humanPause(2.0); // Pausa longa após login
        
        // Verificar se login foi bem sucedido
        const currentUrl = page.url();
        const loginWorked = !currentUrl.includes('login') && !currentUrl.includes('autenticação');
        
        if (loginWorked) {
            console.log('✅ Login no INPI realizado com sucesso');
            await persistCookies(page);
            return true;
        }
    }
    
    console.log('❌ Falha no login do INPI');
    return false;
}

async function initBrowser() {
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1280,1024',
        '--headless=new'
    ];
    const launchErrors: string[] = [];
    const launchModes: Array<{ pipe: boolean; dumpio: boolean; label: string }> = [
        { pipe: false, dumpio: false, label: 'ws' },
        { pipe: true, dumpio: true, label: 'pipe' }
    ];
    const launchAttempts: Array<{ executablePath?: string }> = [{}, ...CHROME_CANDIDATE_PATHS
        .filter((p) => fs.existsSync(p))
        .map((p) => ({ executablePath: p }))];
    for (const mode of launchModes) {
        for (const attempt of launchAttempts) {
            try {
                return await puppeteer.launch({
                    headless: true,
                    pipe: mode.pipe,
                    dumpio: mode.dumpio,
                    args,
                    protocolTimeout: 120000,
                    ...(attempt.executablePath ? { executablePath: attempt.executablePath } : {})
                });
            } catch (error) {
                const msg = formatLaunchError(error);
                const origin = attempt.executablePath ? attempt.executablePath : 'default';
                launchErrors.push(`${mode.label}:${origin}: ${msg}`);
            }
        }
    }
    throw new Error(`INPI_BROWSER_LAUNCH_FAILED ${launchErrors.join(' | ')}`);
}

async function ensureSessionPage(): Promise<Page> {
    await rateLimit();
    
    const now = Date.now();
    const pageClosed = sharedPage ? sharedPage.isClosed() : true;
    const expired = !sharedBrowser || !sharedPage || pageClosed || (now - sessionStartedAt) > INPI_SESSION_TTL_MS;
    
    if (expired) {
        await resetSharedSession();
        
        sharedBrowser = await initBrowser();
        sharedPage = await sharedBrowser.newPage();
        sharedPage.setDefaultNavigationTimeout(INPI_NAVIGATION_TIMEOUT_MS);
        sharedPage.setDefaultTimeout(INPI_WAIT_TIMEOUT_MS);
        
        // Configurações realistas do navegador
        await sharedPage.setViewport({ width: 1280, height: 1024 });
        await sharedPage.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await tryLoadCookies(sharedPage);
        
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
    await rateLimit();
    
    await page.goto('https://busca.inpi.gov.br/pePI/', { 
        waitUntil: 'networkidle2', 
        timeout: INPI_NAVIGATION_TIMEOUT_MS 
    });
    
    await humanPause(1.5);
    await humanScroll(page);
    await humanMouseMovement(page);
    
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
        
        await page.waitForNavigation({ 
            waitUntil: 'networkidle2', 
            timeout: INPI_WAIT_TIMEOUT_MS 
        }).catch(() => undefined);
        
        await humanPause(1.8);
    }
}

async function searchAndOpenPatentDetail(page: Page, codPedido: string) {
    await navigateToPatentSearch(page);
    await rateLimit();
    
    const searchUrl = 'https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchBasico.jsp';
    await page.goto(searchUrl, { 
        waitUntil: 'networkidle2', 
        timeout: INPI_NAVIGATION_TIMEOUT_MS 
    });
    
    await humanPause(2.0); // Pausa longa
    await humanScroll(page);
    await humanMouseMovement(page);
    
    const normalized = codPedido.toUpperCase().replace(/[^0-9A-Z]/g, '');
    
    // Preencher campo de busca com comportamento humano
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
    
    await page.waitForNavigation({ 
        waitUntil: 'networkidle2', 
        timeout: INPI_WAIT_TIMEOUT_MS 
    }).catch(() => undefined);
    
    await humanPause(2.5); // Pausa longa após busca
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
        await page.waitForNavigation({ 
            waitUntil: 'networkidle2', 
            timeout: INPI_WAIT_TIMEOUT_MS 
        }).catch(() => undefined);
        
        await humanPause(2.0);
        await humanScroll(page);
        return true;
    }
    
    // Se não encontrou resultado, tentar URL direta
    const detailUrl = `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${codPedido}`;
    await page.goto(detailUrl, { 
        waitUntil: 'networkidle2', 
        timeout: INPI_NAVIGATION_TIMEOUT_MS 
    });
    
    await humanPause(2.0);
    return false;
}

async function downloadDocument(url: string, filename: string): Promise<string> {
    await rateLimit();
    
    const filePath = path.join(DOWNLOAD_DIR, filename);
    const cookieHeader = await getSessionCookieHeader();
    
    try {
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: INPI_DOWNLOAD_TIMEOUT_MS,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/pdf,text/html,*/*',
                'Referer': 'https://busca.inpi.gov.br/',
                ...(cookieHeader ? { 'Cookie': cookieHeader } : {})
            }
        });
        
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(filePath));
            writer.on('error', reject);
        });
        
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`Falha ao baixar documento: ${msg}`);
    }
}

type CaptchaMode = 'V2_PROXY_OFF' | 'V2_ENTERPRISE_PROXY_OFF';
type InpiDocumentFailureCode =
    | 'DOC_INPI_RPI_DOC_NOT_FOUND'
    | 'DOC_INPI_CAPTCHA_NOT_SOLVED'
    | 'DOC_INPI_CAPTCHA_VALIDATE_FAILED'
    | 'DOC_INPI_DOWNLOAD_HTTP_FAILED'
    | 'DOC_INPI_DOWNLOAD_CONTENT_INVALID'
    | 'DOC_INPI_DOWNLOAD_FAILED';
type InpiCaptchaDownloadResult = {
    filePath: string | null;
    failureCode?: InpiDocumentFailureCode;
    failureDetail?: string;
};

async function solveInpiDownloadCaptchaToken(page: Page, mode: CaptchaMode): Promise<{ token: string; mode: CaptchaMode } | null> {
    if (!ANTI_CAPTCHA_API_KEY) {
        console.log('⚠️ ANTI_CAPTCHA_API_KEY ausente');
        return null;
    }

    const siteKey = await page.evaluate(() => {
        const node = document.querySelector('.g-recaptcha');
        return node ? node.getAttribute('data-sitekey') : null;
    }).catch(() => null);

    if (!siteKey) return null;

    anticaptcha.setAPIKey(ANTI_CAPTCHA_API_KEY);
    const pageUrl = page.url();

    try {
        if (mode === 'V2_PROXY_OFF') {
            const tokenV2 = await anticaptcha.solveRecaptchaV2Proxyless(pageUrl, siteKey, false);
            if (tokenV2) return { token: tokenV2, mode };
        } else {
            const tokenEnterprise = await anticaptcha.solveRecaptchaV2EnterpriseProxyless(pageUrl, siteKey, false, 0, null);
            if (tokenEnterprise) return { token: tokenEnterprise, mode };
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`⚠️ AntiCaptcha ${mode} falhou: ${msg}`);
    }

    return null;
}

async function downloadDocumentViaCaptcha(page: Page, codPedido: string, numeroID: string, rpi: string, numero: string): Promise<InpiCaptchaDownloadResult> {
    try {
        await page.evaluate((docId) => {
            const selector = `img.salvaDocumento[id="${docId}"]`;
            const img = document.querySelector(selector) as HTMLElement | null;
            if (img) img.click();
        }, numeroID);

        await page.waitForSelector('.g-recaptcha', { visible: true, timeout: INPI_WAIT_TIMEOUT_MS });

        const captchaModes: CaptchaMode[] = ['V2_PROXY_OFF', 'V2_ENTERPRISE_PROXY_OFF'];
        let lastFailureCode: InpiDocumentFailureCode | undefined;
        let lastFailureDetail = '';
        let tokenSolvedCount = 0;
        let validaCaptchaOkCount = 0;

        for (let attempt = 0; attempt < captchaModes.length; attempt++) {
            const mode = captchaModes[attempt];
            if (attempt > 0) {
                await page.evaluate((docId) => {
                    const selector = `img.salvaDocumento[id="${docId}"]`;
                    const img = document.querySelector(selector) as HTMLElement | null;
                    if (img) img.click();
                }, numeroID);
                await page.waitForSelector('.g-recaptcha', { visible: true, timeout: INPI_WAIT_TIMEOUT_MS });
            }

            const solved = await solveInpiDownloadCaptchaToken(page, mode);
            if (!solved?.token) {
                console.log(`⚠️ Token de captcha não obtido (${mode}) para RPI ${rpi}`);
                lastFailureCode = 'DOC_INPI_CAPTCHA_NOT_SOLVED';
                lastFailureDetail = `stage=captcha_token mode=${mode} solved_tokens=${tokenSolvedCount} validated=${validaCaptchaOkCount}`;
                continue;
            }
            tokenSolvedCount += 1;

            await page.evaluate((captchaToken) => {
                const textarea = document.getElementById('g-recaptcha-response') || document.querySelector('textarea[name="g-recaptcha-response"]');
                if (textarea) {
                    (textarea as HTMLTextAreaElement).value = captchaToken;
                    (textarea as HTMLTextAreaElement).innerHTML = captchaToken;
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    textarea.dispatchEvent(new Event('change', { bubbles: true }));
                }
                const win = window as any;
                if (win.grecaptcha && typeof win.grecaptcha.getResponse === 'function') {
                    win.grecaptcha.getResponse = () => captchaToken;
                }
                const button = document.getElementById('captchaButton') as HTMLButtonElement | null;
                if (button) button.style.display = 'inline-block';
            }, solved.token);
            const downloadMeta = await page.evaluate(() => {
                const getVal = (id: string) => {
                    const node = document.getElementById(id) as HTMLInputElement | null;
                    return node?.value || '';
                };
                return {
                    codDiretoria: getVal('codDiretoria') || '200',
                    codPedido: getVal('CodPedido'),
                    certificado: getVal('certificado'),
                    numeroProcesso: getVal('numeroProcesso'),
                    ipasDoc: getVal('ipasDoc')
                };
            });

            const validaCaptchaResult = await page.evaluate(async ({ numId, captchaToken }) => {
                const validaUrl = `https://busca.inpi.gov.br/pePI/servlet/ImagemDocumentoPdfController?action=validaCaptcha&NumID=${encodeURIComponent(numId)}&captcha=${encodeURIComponent(captchaToken)}`;
                const resp = await fetch(validaUrl, {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'application/json, text/javascript, */*; q=0.01'
                    }
                });
                const text = await resp.text();
                const lowered = text.toLowerCase();
                let ok = false;
                try {
                    const parsed = JSON.parse(text);
                    const json = JSON.stringify(parsed).toLowerCase();
                    ok = json.includes('success') && !json.includes('error');
                } catch {
                    ok = lowered.includes('success') && !lowered.includes('error') && !lowered.includes('login:') && !lowered.includes('cadastre-se');
                }
                return {
                    status: resp.status,
                    ok,
                    textSample: text.slice(0, 220)
                };
            }, { numId: numeroID, captchaToken: solved.token });

            if (!validaCaptchaResult.ok) {
                console.log(`⚠️ validaCaptcha rejeitado (${mode}) RPI ${rpi}: status=${validaCaptchaResult.status} body=${validaCaptchaResult.textSample}`);
                lastFailureCode = 'DOC_INPI_CAPTCHA_VALIDATE_FAILED';
                lastFailureDetail = `stage=validaCaptcha mode=${mode} solved_tokens=${tokenSolvedCount} validated=${validaCaptchaOkCount} status=${validaCaptchaResult.status} sample=${normalizeFlat(validaCaptchaResult.textSample).slice(0, 120)}`;
                continue;
            }
            validaCaptchaOkCount += 1;

            const downloadUrl = `https://busca.inpi.gov.br/pePI/servlet/ImagemDocumentoPdfController?CodDiretoria=${encodeURIComponent(downloadMeta.codDiretoria || '200')}&NumeroID=${encodeURIComponent(numeroID)}&certificado=${encodeURIComponent(downloadMeta.certificado || '')}&numeroProcesso=${encodeURIComponent(downloadMeta.numeroProcesso || '')}&ipasDoc=${encodeURIComponent(downloadMeta.ipasDoc || '')}&codPedido=${encodeURIComponent(downloadMeta.codPedido || codPedido)}`;

            const downloadPayload = await page.evaluate(async (url) => {
                const response = await fetch(url, { method: 'GET', credentials: 'include' });
                const contentType = (response.headers.get('content-type') || '').toLowerCase();
                const arrayBuffer = await response.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                const base64 = btoa(binary);
                const header = String.fromCharCode(...bytes.slice(0, 5));
                return {
                    status: response.status,
                    contentType,
                    size: bytes.length,
                    header,
                    base64
                };
            }, downloadUrl);

            const buffer = Buffer.from(downloadPayload.base64 || '', 'base64');
            const contentType = String(downloadPayload.contentType || '').toLowerCase();
            const pdfHeader = buffer ? buffer.subarray(0, 5).toString('utf8') : '';
            if (downloadPayload.status >= 300) {
                console.log(`⚠️ Download não retornou PDF válido (${mode}) RPI ${rpi}: status=${downloadPayload.status} ct=${contentType} size=${buffer?.length || 0} header=${pdfHeader}`);
                lastFailureCode = 'DOC_INPI_DOWNLOAD_HTTP_FAILED';
                lastFailureDetail = `stage=download_http mode=${mode} solved_tokens=${tokenSolvedCount} validated=${validaCaptchaOkCount} status=${downloadPayload.status} ct=${contentType} size=${buffer?.length || 0}`;
                continue;
            }
            if (!contentType.includes('pdf') || !buffer || buffer.length < 100 || !pdfHeader.startsWith('%PDF-')) {
                console.log(`⚠️ Download não retornou PDF válido (${mode}) RPI ${rpi}: status=${downloadPayload.status} ct=${contentType} size=${buffer?.length || 0} header=${pdfHeader}`);
                lastFailureCode = 'DOC_INPI_DOWNLOAD_CONTENT_INVALID';
                lastFailureDetail = `stage=download_content mode=${mode} solved_tokens=${tokenSolvedCount} validated=${validaCaptchaOkCount} status=${downloadPayload.status} ct=${contentType} size=${buffer?.length || 0} header=${pdfHeader}`;
                continue;
            }

            const filename = `${codPedido}_despacho_${numero}_rpi_${rpi}_${Date.now()}.pdf`;
            const filePath = path.join(DOWNLOAD_DIR, filename);
            fs.writeFileSync(filePath, buffer);
            console.log(`✅ Documento baixado via captcha (${solved.mode}) RPI ${rpi}: ${filename}`);
            return { filePath };
        }

        return {
            filePath: null,
            failureCode: lastFailureCode || 'DOC_INPI_DOWNLOAD_FAILED',
            failureDetail: lastFailureDetail || `stage=unknown solved_tokens=${tokenSolvedCount} validated=${validaCaptchaOkCount}`
        };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`⚠️ Falha no download via captcha RPI ${rpi}: ${msg}`);
        return { filePath: null, failureCode: 'DOC_INPI_DOWNLOAD_FAILED', failureDetail: `stage=exception ${normalizeFlat(msg).slice(0, 180)}` };
    }
}

type ProcessInpiPatentOptions = {
    includeDocuments?: boolean;
};

async function extractPatentData(page: Page, codPedido: string, options: ProcessInpiPatentOptions = {}) {
    const includeDocuments = options.includeDocuments === true;
    await rateLimit();
    
    const html = await page.content();
    
    // Verificar se sessão expirou
    if (isSessionExpired(html, page.url())) {
        console.log('🔄 Sessão expirou durante extração, reconectando...');
        await ensureLoggedIn(page);
        await searchAndOpenPatentDetail(page, codPedido);
        return await extractPatentData(page, codPedido, options);
    }
    
    const $ = cheerio.load(html);
    
    // Extrair dados COMPLETOS da patente
    const extractTableData = (label: string) => {
        const cell = $(`td:contains("${label}"), th:contains("${label}")`);
        if (cell.length) {
            const next = cell.next('td');
            if (next.length) return normalizeFlat(next.text());
            
            // Tentar encontrar o valor na mesma linha
            const row = cell.closest('tr');
            const cells = row.find('td, th');
            const labelIndex = cells.toArray().findIndex(el => $(el).text().includes(label));
            if (labelIndex !== -1 && cells.length > labelIndex + 1) {
                return normalizeFlat($(cells[labelIndex + 1]).text());
            }
        }
        return '';
    };
    
    // Extrair procurador
    const extractProcurador = () => {
        const patterns = [
            'procurador', 'representante', 'advogado', 'procuradores', 
            'PROCURADOR', 'REPRESENTANTE', 'Advogado', 'Procuradores'
        ];
        
        for (const pattern of patterns) {
            const cell = $(`td:contains("${pattern}"), th:contains("${pattern}")`);
            if (cell.length) {
                const value = extractTableData(pattern) || cell.closest('tr').text();
                const cleaned = normalizeFlat(value)
                    .replace(new RegExp(pattern, 'gi'), '')
                    .replace(/[:\-\]]/g, '')
                    .trim();
                if (cleaned) return cleaned;
            }
        }
        
        return '';
    };
    
    // Extrair resumo detalhado
    const extractResumoDetalhado = () => {
        const cleanResumoText = (value?: string) => normalizeFlat(value)
            .replace(/^\(?57\)?\s*/i, '')
            .replace(/^resumo\s*[:\-]?\s*/i, '')
            .trim();
        const isUsefulResumo = (value: string) => value.length >= 120;

        const resumoElements = $('.resumo, .abstract, .summary, [id*="resumo"], [class*="resumo"], [data-label*="resumo"]');
        if (resumoElements.length) {
            const parsed = sanitizeInpiDetailedAbstract(cleanResumoText(resumoElements.first().text()));
            if (isUsefulResumo(parsed)) return parsed;
        }

        const labelCandidates = $('tr, td, th, div, p, span').filter((_, el) => {
            const text = normalizeFlat($(el).text());
            return /\bresumo\b/i.test(text) || /\(57\)/.test(text);
        });

        for (let i = 0; i < labelCandidates.length; i++) {
            const element = labelCandidates.eq(i);
            const current = sanitizeInpiDetailedAbstract(cleanResumoText(element.text()));
            if (isUsefulResumo(current)) return current;
            const row = element.closest('tr');
            const rowText = sanitizeInpiDetailedAbstract(cleanResumoText(row.text()));
            if (isUsefulResumo(rowText)) return rowText;
            const nextRowText = sanitizeInpiDetailedAbstract(cleanResumoText(row.next('tr').text()));
            if (isUsefulResumo(nextRowText)) return nextRowText;
            const siblingText = sanitizeInpiDetailedAbstract(cleanResumoText(element.next().text()));
            if (isUsefulResumo(siblingText)) return siblingText;
        }

        return sanitizeInpiDetailedAbstract(cleanResumoText($('p').filter((_, el) => {
            const text = $(el).text();
            return text.length > 100 && text.length < 2000;
        }).first().text()));
    };

    const extractAnuidades = () => {
        const rows = $('tr').toArray();
        const result: Array<{ title: string; start_date: string; end_date: string; payment_date: string; status: string }> = [];
        for (const row of rows) {
            const cols = $(row).find('td');
            if (cols.length < 2) continue;
            const joined = normalizeFlat($(row).text()).toLowerCase();
            if (!joined.includes('anuidade')) continue;
            const values = cols.toArray().map((col) => normalizeFlat($(col).text()));
            const title = values.find((value) => /anuidade/i.test(value)) || values[0] || '';
            if (!title) continue;
            result.push({
                title,
                start_date: values[1] || '',
                end_date: values[2] || '',
                payment_date: values[3] || '',
                status: values[4] || values[1] || ''
            });
        }
        return result;
    };

    const extractPeticoes = () => {
        const rows = $('tr').toArray();
        const result: Array<{ service_code: string; protocol: string; date: string; client: string; delivery: string; rule_text: string }> = [];
        for (const row of rows) {
            const cols = $(row).find('td');
            if (cols.length < 3) continue;
            const values = cols.toArray().map((col) => normalizeFlat($(col).text()));
            const joined = values.join(' ').toLowerCase();
            const hasProtocol = /\b\d{6,}\b/.test(joined) || joined.includes('protocolo');
            const hasService = /\b\d{2,4}\b/.test(values[0] || '') || joined.includes('serviço') || joined.includes('servico');
            if (!hasProtocol || !hasService) continue;
            const serviceCode = values[0] || '';
            const protocol = values.find((value) => /\d{6,}/.test(value)) || values[1] || '';
            const date = values.find((value) => /\d{2}\/\d{2}\/\d{4}/.test(value)) || '';
            const client = values.find((value) => /universidade|ltda|s\/a|sa|eireli|me|brasil|federal/i.test(value)) || '';
            const delivery = values.find((value) => /delivery|email|correio|digital|físico|fisico/i.test(value)) || '';
            const ruleCandidates = $(row).find('a, [title], [data-original-title]').toArray()
                .map((el) => normalizeFlat($(el).attr('title') || $(el).attr('data-original-title') || $(el).text()))
                .filter(Boolean);
            const rule_text = ruleCandidates.find((item) => item.length > 8) || '';
            result.push({
                service_code: serviceCode,
                protocol,
                date,
                client,
                delivery,
                rule_text
            });
        }
        return result;
    };
    
    // Extrair documentos disponíveis
    const extractDocumentos = async () => {
        const documentos: Array<{ 
            tipo: string; 
            url: string; 
            descricao: string;
            numero: string;
            baixado: boolean;
            caminho?: string;
            rpi?: string;
            erro?: InpiDocumentFailureCode;
            detalheErro?: string;
        }> = [];
        const publicationRows = $('tr').toArray().map((row) => normalizeFlat($(row).text()));
        const targetDespachosByNumero = publicationRows
            .map((text) => {
                const m = text.match(/(?:^|\s)(\d{4,6})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+\.\d+)\b/i);
                if (!m) return null;
                const numero = m[3];
                if (!TARGET_DOCUMENT_DISPATCHES.includes(numero as typeof TARGET_DOCUMENT_DISPATCHES[number])) return null;
                return { rpi: m[1], date: m[2], numero: m[3] };
            })
            .filter((item): item is { rpi: string; date: string; numero: string } => Boolean(item))
            .reduce((acc, item) => {
                const existing = acc.get(item.numero);
                if (!existing) {
                    acc.set(item.numero, item);
                    return acc;
                }
                const existingDate = parseBrDate(existing.date)?.getTime() || 0;
                const itemDate = parseBrDate(item.date)?.getTime() || 0;
                if (itemDate > existingDate) {
                    acc.set(item.numero, item);
                    return acc;
                }
                if (itemDate === existingDate && Number(item.rpi) > Number(existing.rpi)) {
                    acc.set(item.numero, item);
                }
                return acc;
            }, new Map<string, { rpi: string; date: string; numero: string }>());
        const targetDespachos = Array.from(targetDespachosByNumero.values())
            .sort((a, b) => (parseBrDate(b.date)?.getTime() || 0) - (parseBrDate(a.date)?.getTime() || 0));

        const docsPublicados = $('img.salvaDocumento').toArray().map((img) => {
            const $img = $(img);
            const numeroID = normalizeFlat($img.attr('id') || '');
            const label = normalizeFlat($img.closest('a').find('label').first().text()) || normalizeFlat($img.parent().text());
            const rpiMatch = label.match(/RPI\s*(\d{4,6})/i) || label.match(/\b(\d{4,6})\b/);
            const rpi = rpiMatch ? rpiMatch[1] : '';
            return { numeroID, rpi, label };
        }).filter((item) => item.numeroID && item.rpi)
            .filter((item, index, all) => all.findIndex((other) => other.numeroID === item.numeroID) === index);

        for (const target of targetDespachos) {
            const docFromRpi = docsPublicados.find((item) => item.rpi === target.rpi);
            const documento: {
                tipo: string;
                url: string;
                descricao: string;
                numero: string;
                baixado: boolean;
                caminho: string;
                rpi: string;
                erro?: InpiDocumentFailureCode;
                detalheErro?: string;
            } = {
                tipo: `Despacho ${target.numero}`,
                url: '',
                descricao: `RPI ${target.rpi} - despacho ${target.numero}`,
                numero: target.numero,
                baixado: false,
                caminho: '',
                rpi: target.rpi
            };

            if (!docFromRpi) {
                documento.erro = 'DOC_INPI_RPI_DOC_NOT_FOUND';
                documentos.push(documento);
                continue;
            }

            const downloaded = await downloadDocumentViaCaptcha(page, codPedido, docFromRpi.numeroID, target.rpi, target.numero);
            if (downloaded.filePath) {
                documento.baixado = true;
                documento.caminho = downloaded.filePath;
            } else {
                documento.erro = downloaded.failureCode || 'DOC_INPI_DOWNLOAD_FAILED';
                documento.detalheErro = downloaded.failureDetail || '';
            }
            documentos.push(documento);
        }

        return documentos;
    };
    
    const documentos = includeDocuments ? await extractDocumentos() : [];

    // Publicações (RPI) completas
    const publicationsTableAll = $('font:contains("Publicações")').closest('table').next('table');
    const publicacoes: Array<{ rpi: string; date: string; despacho_code: string; complement: string; despacho_rule?: string; rpi_url?: string }> = [];
    if (publicationsTableAll.length) {
        const rows = publicationsTableAll.find('tr').slice(1);
        for (let i = 0; i < rows.length; i++) {
            const cols = $(rows[i]).find('td');
            if (cols.length >= 5) {
                const rpi = normalizeFlat($(cols[0]).text());
                const date = normalizeFlat($(cols[1]).text());
                const despacho_code = normalizeFlat($(cols[2]).text());
                const pdfLink = $(cols[3]).find('a').attr('href');
                const complement = normalizeFlat($(cols[4]).text());
                const despacho_rule = normalizeFlat(
                    $(cols[2]).find('a').first().attr('title')
                    || $(cols[2]).find('a').first().attr('data-original-title')
                    || $(cols[2]).find('[title]').first().attr('title')
                    || ''
                );
                const rpi_url = pdfLink ? (pdfLink.startsWith('http') ? pdfLink : `https://busca.inpi.gov.br${pdfLink}`) : undefined;
                if (rpi) {
                    publicacoes.push({ rpi, date, despacho_code, complement, despacho_rule, rpi_url });
                }
            }
        }
    }
    
    // Dados completos da patente
    const tituloRaw = extractTableData('Título') || normalizeFlat($('h1, .titulo, .title').first().text());
    const titularRaw = extractTableData('Nome do Depositante') || extractTableData('Depositante') || extractTableData('Titular') || extractTableData('Inventor');
    const titularCompletoRaw = extractTableData('Nome do Depositante') || extractTableData('Depositante') || extractTableData('Titular');
    const inventorRaw = extractTableData('Nome do Inventor') || extractTableData('Inventor') || extractTableData('Inventores');
    const classificacaoRaw = extractTableData('Classificação CPC') || extractTableData('Classificação') || extractTableData('IPC');
    const classificacaoIpcRaw = extractTableData('Classificação Internacional') || extractTableData('IPC');
    const ultimoDespachoRaw = extractTableData('Despacho') || extractTableData('Último Despacho');
    const complementoDespachoRaw = extractTableData('Complemento') || extractTableData('Situação');
    const data = {
        numeroProcesso: codPedido,
        titulo: cleanBibliographicField(tituloRaw),
        resumo: extractResumoDetalhado(),
        resumoDetalhado: extractResumoDetalhado(),
        dataDeposito: extractTableData('Data do Depósito') || extractTableData('Depósito'),
        dataPublicacao: extractTableData('Data de Publicação') || extractTableData('Publicação'),
        titular: cleanBibliographicField(titularRaw),
        titularCompleto: cleanBibliographicField(titularCompletoRaw),
        inventor: cleanBibliographicField(inventorRaw),
        inventores: cleanBibliographicField(inventorRaw),
        procurador: extractProcurador(),
        classificacao: cleanBibliographicField(classificacaoRaw),
        classificacaoIPC: cleanBibliographicField(classificacaoIpcRaw),
        prioridade: extractTableData('Prioridade') || extractTableData('Reivindicação de Prioridade'),
        status: classifyPatentStatus(
            ultimoDespachoRaw,
            complementoDespachoRaw
        ),
        ultimoDespacho: cleanBibliographicField(ultimoDespachoRaw),
        complementoDespacho: cleanBibliographicField(complementoDespachoRaw),
        documentos: documentos,
        temDocumentos: documentos.length > 0,
        documentosBaixados: documentos.filter(d => d.baixado).length,
        publicacoes,
        anuidades: extractAnuidades(),
        peticoes: extractPeticoes(),
        url: page.url(),
        html: html,
        timestamp: new Date().toISOString()
    };
    
    return data;
}

export async function processInpiPatent(codPedido: string, options: ProcessInpiPatentOptions = {}) {
    return await withSessionLock(async () => {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const page = await ensureSessionPage();
                console.log(`🔍 Processando patente INPI: ${codPedido}`);
                
                const success = await searchAndOpenPatentDetail(page, codPedido);
                if (!success) {
                    throw new Error(`DOC_INPI_PROCESS_NOT_FOUND Não foi possível encontrar a patente ${codPedido}`);
                }
                
                const patentData = await extractPatentData(page, codPedido, options);
                console.log(`✅ Patente ${codPedido} processada com sucesso`);
                
                try {
                    const normalizedCod = normalizeFlat(codPedido).replace(/\s+/g, '');
                    const linkedPatent = await prisma.inpiPatent.findFirst({
                        where: {
                            OR: [
                                { cod_pedido: codPedido },
                                { cod_pedido: normalizedCod },
                                { numero_publicacao: codPedido },
                                { numero_publicacao: normalizedCod }
                            ]
                        },
                        select: {
                            cod_pedido: true,
                            numero_publicacao: true
                        }
                    }).catch(() => null);
                    const targetCodPedido = linkedPatent?.cod_pedido || codPedido;
                    const currentPublication = linkedPatent?.numero_publicacao || '';
                    const normalizedPublication = normalizeFlat(codPedido).replace(/\s+/g, '');
                    await prisma.inpiPatent.upsert({
                        where: { cod_pedido: targetCodPedido },
                        update: {
                            updated_at: new Date(),
                            numero_publicacao: currentPublication || normalizedPublication || undefined
                        },
                        create: {
                            cod_pedido: targetCodPedido,
                            numero_publicacao: currentPublication || normalizedPublication || '',
                            title: '',
                            abstract: '',
                            resumo_detalhado: '',
                            procurador: '',
                            applicant: '',
                            inventors: '',
                            filing_date: '',
                            ipc_codes: '',
                            status: '',
                            last_event: ''
                        }
                    });
                    if (Array.isArray(patentData.publicacoes) && patentData.publicacoes.length) {
                        for (const pub of patentData.publicacoes) {
                            try {
                                const existing = await prisma.inpiPublication.findFirst({
                                    where: { patent_id: targetCodPedido, rpi: pub.rpi, despacho_code: pub.despacho_code, date: pub.date, complement: pub.complement }
                                });
                                const despachoBase = classifyPatentStatus(pub.despacho_code, pub.complement);
                                const despacho_desc = [despachoBase, normalizeFlat((pub as any).despacho_rule || '')].filter(Boolean).join(' | ');
                                if (existing) {
                                    await prisma.inpiPublication.update({
                                        where: { id: existing.id },
                                        data: {
                                            despacho_desc,
                                            rpi_url: pub.rpi_url || existing.rpi_url || undefined,
                                            eligible_for_doc_download: Boolean(pub.rpi_url)
                                        }
                                    });
                                } else {
                                    await prisma.inpiPublication.create({
                                        data: {
                                            patent_id: targetCodPedido,
                                            patent_number: patentData.numeroProcesso || null,
                                            rpi: pub.rpi,
                                            date: pub.date,
                                            despacho_code: pub.despacho_code,
                                            despacho_desc,
                                            complement: pub.complement,
                                            eligible_for_doc_download: Boolean(pub.rpi_url),
                                            rpi_url: pub.rpi_url || null
                                        }
                                    });
                                }
                            } catch (e) {
                                const msg = (e as any)?.message ?? String(e);
                                console.warn(`Falha ao persistir publicação RPI ${pub.rpi}: ${msg}`);
                            }
                        }
                    }
                    if (Array.isArray(patentData.peticoes)) {
                        await prisma.inpiPetition.deleteMany({ where: { patent_id: targetCodPedido } }).catch(() => undefined);
                        const petitionsData = patentData.peticoes
                            .map((item) => ({
                                patent_id: targetCodPedido,
                                service_code: normalizeFlat(item.service_code) || null,
                                protocol: normalizeFlat(item.protocol) || null,
                                date: normalizeFlat(item.date) || null,
                                client: normalizeFlat(item.client) || null,
                                delivery: [normalizeFlat(item.delivery), normalizeFlat((item as any).rule_text || '')].filter(Boolean).join(' | ') || null
                            }))
                            .filter((item) => item.service_code || item.protocol || item.date || item.client || item.delivery);
                        if (petitionsData.length) {
                            await prisma.inpiPetition.createMany({ data: petitionsData });
                        }
                    }
                    if (Array.isArray(patentData.anuidades)) {
                        await prisma.inpiAnnuity.deleteMany({ where: { patent_id: targetCodPedido } }).catch(() => undefined);
                        const annuitiesData = patentData.anuidades
                            .map((item) => ({
                                patent_id: targetCodPedido,
                                title: normalizeFlat(item.title) || null,
                                start_date: normalizeFlat(item.start_date) || null,
                                end_date: normalizeFlat(item.end_date) || null,
                                payment_date: normalizeFlat(item.payment_date) || null,
                                status: normalizeFlat(item.status) || null
                            }))
                            .filter((item) => item.title || item.start_date || item.end_date || item.payment_date || item.status);
                        if (annuitiesData.length) {
                            await prisma.inpiAnnuity.createMany({ data: annuitiesData });
                        }
                    }
                    await prisma.inpiPatent.upsert({
                        where: { cod_pedido: targetCodPedido },
                        update: {
                            title: patentData.titulo || undefined,
                            abstract: patentData.resumoDetalhado || patentData.resumo || undefined,
                            resumo_detalhado: patentData.resumoDetalhado || patentData.resumo || undefined,
                            procurador: patentData.procurador || undefined,
                            numero_publicacao: currentPublication || normalizedPublication || undefined,
                            applicant: patentData.titular || undefined,
                            inventors: (patentData.inventores || patentData.inventor) || undefined,
                            filing_date: patentData.dataDeposito || undefined,
                            ipc_codes: [patentData.classificacao, patentData.classificacaoIPC].filter(Boolean).join(' | ') || undefined,
                            status: patentData.status || undefined,
                            last_event: [patentData.ultimoDespacho, patentData.complementoDespacho, patentData.temDocumentos ? 'DOC' : ''].filter(Boolean).join(' | ') || undefined,
                            updated_at: new Date()
                        },
                        create: {
                            cod_pedido: targetCodPedido,
                            numero_publicacao: currentPublication || normalizedPublication || '',
                            title: patentData.titulo || '',
                            abstract: patentData.resumoDetalhado || patentData.resumo || '',
                            resumo_detalhado: patentData.resumoDetalhado || patentData.resumo || '',
                            procurador: patentData.procurador || '',
                            applicant: patentData.titular || '',
                            inventors: (patentData.inventores || patentData.inventor) || '',
                            filing_date: patentData.dataDeposito || '',
                            ipc_codes: [patentData.classificacao, patentData.classificacaoIPC].filter(Boolean).join(' | ') || '',
                            status: patentData.status || '',
                            last_event: [patentData.ultimoDespacho, patentData.complementoDespacho, patentData.temDocumentos ? 'DOC' : ''].filter(Boolean).join(' | ') || ''
                        }
                    });
                    
                    console.log(`💾 Dados da patente ${codPedido} salvos no banco`);
                } catch (dbError) {
                    const msg = (dbError as any)?.message ?? String(dbError);
                    console.warn(`⚠️  Não foi possível salvar no banco: ${msg}`);
                }
                
                return patentData;
            } catch (error) {
                if (isDetachedFrameError(error) && attempt < 3) {
                    console.warn(`🔄 Sessão INPI inválida para ${codPedido}, reiniciando sessão (tentativa ${attempt}/3)`);
                    await resetSharedSession();
                    await humanPause(0.8);
                    continue;
                }
                console.error(`❌ Erro ao processar patente ${codPedido}:`, error);
                throw error;
            }
        }
        throw new Error(`Falha inesperada ao processar patente ${codPedido}`);
    });
}

// Função para testar o worker
export async function testInpiWorker(codPedido: string) {
    try {
        console.log('🚀 Iniciando teste do INPI Worker...');
        console.log('⏰ Aguarde, processo pode levar alguns minutos...');
        
        const result = await processInpiPatent(codPedido);
        
        console.log('🎉 PROCESSAMENTO CONCLUÍDO!');
        console.log('📊 RESULTADOS:');
        console.log(JSON.stringify({
            numeroProcesso: result.numeroProcesso,
            titulo: result.titulo,
            resumo: result.resumo?.substring(0, 150) + '...',
            dataDeposito: result.dataDeposito,
            titular: result.titular,
            inventor: result.inventor
        }, null, 2));
    } catch (error) {
        console.error('❌ Erro no teste:', error);
        throw error;
    }
}
