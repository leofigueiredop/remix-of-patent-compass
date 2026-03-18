import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { prisma } from '../db';
import type { Browser, Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

const INPI_USER = process.env.INPI_USER || '';
const INPI_PASSWORD = process.env.INPI_PASSWORD || '';
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
        timeout: 45000 
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
        timeout: 60000 
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
                timeout: 30000 
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
                timeout: 45000 
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
                timeout: 30000 
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
        '--no-zygote',
        '--single-process',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1280,1024'
    ];
    const launchErrors: string[] = [];
    const launchAttempts: Array<{ executablePath?: string }> = [{}, ...CHROME_CANDIDATE_PATHS
        .filter((p) => fs.existsSync(p))
        .map((p) => ({ executablePath: p }))];
    for (const attempt of launchAttempts) {
        try {
            return await puppeteer.launch({
                headless: true,
                pipe: true,
                dumpio: true,
                args,
                ...(attempt.executablePath ? { executablePath: attempt.executablePath } : {})
            });
        } catch (error) {
            const msg = formatLaunchError(error);
            launchErrors.push(attempt.executablePath ? `${attempt.executablePath}: ${msg}` : `default: ${msg}`);
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
        timeout: 60000 
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
            timeout: 20000 
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
        timeout: 60000 
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
        timeout: 60000 
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
            timeout: 60000 
        }).catch(() => undefined);
        
        await humanPause(2.0);
        await humanScroll(page);
        return true;
    }
    
    // Se não encontrou resultado, tentar URL direta
    const detailUrl = `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${codPedido}`;
    await page.goto(detailUrl, { 
        waitUntil: 'networkidle2', 
        timeout: 60000 
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
            timeout: 30000,
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

async function extractPatentData(page: Page, codPedido: string) {
    await rateLimit();
    
    const html = await page.content();
    
    // Verificar se sessão expirou
    if (isSessionExpired(html, page.url())) {
        console.log('🔄 Sessão expirou durante extração, reconectando...');
        await ensureLoggedIn(page);
        await searchAndOpenPatentDetail(page, codPedido);
        return await extractPatentData(page, codPedido);
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
        const resumoElements = $('.resumo, .abstract, .summary, [id*="resumo"], [class*="resumo"]');
        if (resumoElements.length) {
            return normalizeFlat(resumoElements.first().text());
        }
        
        return normalizeFlat($('p').filter((i, el) => {
            const text = $(el).text();
            return text.length > 100 && text.length < 2000;
        }).first().text());
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
        }> = [];
        
        // Buscar links para documentos
        const docLinks = $('a[href*=".pdf"], a[href*="download"], a[href*="documento"], a:contains("PDF"), a:contains("Download")');
        
        for (let i = 0; i < docLinks.length; i++) {
            const el = docLinks[i];
            const link = $(el);
            const href = link.attr('href') || '';
            const text = normalizeFlat(link.text());
            
            if (href && (href.includes('.pdf') || href.includes('download') || text.match(/(pdf|download|documento)/i))) {
                const fullUrl = href.startsWith('http') ? href : `https://busca.inpi.gov.br${href}`;
                
                // Identificar tipo de documento
                let tipo = 'Documento';
                let numero = '';
                
                if (text.includes('3.1') || href.includes('3.1')) {
                    tipo = 'Formulário 3.1';
                    numero = '3.1';
                } else if (text.includes('3.2') || href.includes('3.2')) {
                    tipo = 'Formulário 3.2';
                    numero = '3.2';
                } else if (text.includes('16.1') || href.includes('16.1')) {
                    tipo = 'Formulário 16.1';
                    numero = '16.1';
                } else if (text.match(/\d+\.\d+/)) {
                    const match = text.match(/(\d+\.\d+)/);
                    if (match) {
                        tipo = `Formulário ${match[1]}`;
                        numero = match[1];
                    }
                }
                
                const documento = {
                    tipo: tipo,
                    url: fullUrl,
                    descricao: text || `Documento ${i + 1}`,
                    numero: numero,
                    baixado: false,
                    caminho: ''
                };
                
                // Tentar baixar documentos importantes
                if (numero === '3.1' || numero === '3.2' || numero === '16.1') {
                    try {
                        const filename = `${codPedido}_formulario_${numero}_${Date.now()}.pdf`;
                        const filePath = await downloadDocument(fullUrl, filename);
                        documento.baixado = true;
                        documento.caminho = filePath;
                        console.log(`✅ Baixado: ${tipo} - ${filename}`);
                    } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        console.log(`⚠️  Não foi possível baixar ${tipo}: ${msg}`);
                    }
                }
                
                documentos.push(documento);
            }
        }
        
        // Extrair despachos 3.1 da tabela de publicações (RPI)
        const publicationsTable = $('font:contains("Publicações")').closest('table').next('table');
        const publicacoes: Array<{ rpi: string; date: string; despacho_code: string; complement: string; pdfLink?: string }> = [];
        if (publicationsTable.length) {
            const rows = publicationsTable.find('tr').slice(1);
            for (let i = 0; i < rows.length; i++) {
                const cols = $(rows[i]).find('td');
                if (cols.length >= 5) {
                    const rpi = normalizeFlat($(cols[0]).text());
                    const despachoCode = normalizeFlat($(cols[2]).text());
                    const complement = normalizeFlat($(cols[4]).text());
                    const pdfLink = $(cols[3]).find('a').attr('href');
                    const date = normalizeFlat($(cols[1]).text());
                    
                    publicacoes.push({
                        rpi,
                        date,
                        despacho_code: despachoCode,
                        complement,
                        pdfLink: pdfLink ? (pdfLink.startsWith('http') ? pdfLink : `https://busca.inpi.gov.br${pdfLink}`) : undefined
                    });
                    
                    // Verificar se é despacho 3.1
                    if (despachoCode.includes('3.1') || complement.includes('3.1')) {
                        const fullPdfUrl = pdfLink ? (pdfLink.startsWith('http') ? pdfLink : `https://busca.inpi.gov.br${pdfLink}`) : '';
                        
                        const documento = {
                            tipo: 'Despacho 3.1',
                            url: fullPdfUrl,
                            descricao: `RPI ${rpi} - ${despachoCode} ${complement}`,
                            numero: '3.1',
                            baixado: false,
                            caminho: '',
                            rpi: rpi
                        };
                        
                        // Tentar baixar o documento do despacho 3.1
                        if (fullPdfUrl) {
                            try {
                                const filename = `${codPedido}_despacho_3.1_rpi_${rpi}_${Date.now()}.pdf`;
                                const filePath = await downloadDocument(fullPdfUrl, filename);
                                documento.baixado = true;
                                documento.caminho = filePath;
                                console.log(`✅ Baixado despacho 3.1: RPI ${rpi} - ${filename}`);
                            } catch (error) {
                                const msg = error instanceof Error ? error.message : String(error);
                                console.log(`⚠️  Não foi possível baixar despacho 3.1 (RPI ${rpi}): ${msg}`);
                            }
                        } else {
                            console.log(`ℹ️  Despacho 3.1 encontrado (RPI ${rpi}) mas sem link PDF`);
                        }
                        
                        documentos.push(documento);
                    }
                }
            }
        }

        // Documentos Publicados (mosaico com imagens) — mapear por RPI
        const docsPublicadosContainer = $('font:contains("Documentos Publicados")').closest('table');
        const publishedAnchors = docsPublicadosContainer.find('a[href*=".pdf"], a[href*="Download"], a[href*="download"]');
        const docsPorRpi = new Map<string, string>();
        if (publishedAnchors.length) {
            publishedAnchors.each((_, a) => {
                const $a = $(a);
                const href = $a.attr('href') || '';
                if (!href) return;
                const full = href.startsWith('http') ? href : `https://busca.inpi.gov.br${href}`;
                const labelCandidates = [
                    normalizeFlat($a.text()),
                    normalizeFlat($a.attr('title') || ''),
                    normalizeFlat($a.find('img').attr('alt') || ''),
                    normalizeFlat($a.parent().text())
                ].filter(Boolean);
                const joined = labelCandidates.join(' ');
                let rpiMatch = joined.match(/RPI\s*(\d{3,6})/i);
                if (!rpiMatch) {
                    rpiMatch = full.match(/RPI[\-_]?(\d{3,6})/i) || full.match(/rpi[\-_]?(\d{3,6})/i) || full.match(/\/(\d{4,5})[^\/]*\.pdf$/i);
                }
                if (rpiMatch && rpiMatch[1]) {
                    docsPorRpi.set(rpiMatch[1], full);
                }
            });
        }

        // Vincular PDF de Documentos Publicados aos despachos 3.1 sem link
        if (publicacoes.length && docsPorRpi.size) {
            const jaCadastrados = new Set(documentos.filter(d => d.rpi && d.numero === '3.1' && d.url).map(d => `${d.rpi}`));
            for (const pub of publicacoes) {
                const is31 = (pub.despacho_code || '').includes('3.1') || (pub.complement || '').includes('3.1');
                if (!is31) continue;
                if (jaCadastrados.has(pub.rpi)) continue;
                const candidateUrl = docsPorRpi.get(pub.rpi);
                if (!candidateUrl) continue;
                const doc = {
                    tipo: 'Despacho 3.1',
                    url: candidateUrl,
                    descricao: `RPI ${pub.rpi} - ${pub.despacho_code} ${pub.complement}`.trim(),
                    numero: '3.1',
                    baixado: false,
                    caminho: '',
                    rpi: pub.rpi
                };
                try {
                    const filename = `${codPedido}_despacho_3.1_rpi_${pub.rpi}_${Date.now()}.pdf`;
                    const filePath = await downloadDocument(candidateUrl, filename);
                    doc.baixado = true;
                    doc.caminho = filePath;
                    console.log(`✅ Baixado despacho 3.1 por Documentos Publicados: RPI ${pub.rpi}`);
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    console.log(`⚠️  Falhou download em Documentos Publicados (RPI ${pub.rpi}): ${msg}`);
                }
                documentos.push(doc);
            }
        }

        return documentos;
    };
    
    const documentos = await extractDocumentos();

    // Publicações (RPI) completas
    const publicationsTableAll = $('font:contains("Publicações")').closest('table').next('table');
    const publicacoes: Array<{ rpi: string; date: string; despacho_code: string; complement: string; rpi_url?: string }> = [];
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
                const rpi_url = pdfLink ? (pdfLink.startsWith('http') ? pdfLink : `https://busca.inpi.gov.br${pdfLink}`) : undefined;
                if (rpi) {
                    publicacoes.push({ rpi, date, despacho_code, complement, rpi_url });
                }
            }
        }
    }
    
    // Dados completos da patente
    const data = {
        numeroProcesso: codPedido,
        titulo: extractTableData('Título') || normalizeFlat($('h1, .titulo, .title').first().text()),
        resumo: extractResumoDetalhado(),
        resumoDetalhado: extractResumoDetalhado(),
        dataDeposito: extractTableData('Data do Depósito') || extractTableData('Depósito'),
        dataPublicacao: extractTableData('Data de Publicação') || extractTableData('Publicação'),
        titular: extractTableData('Titular') || extractTableData('Inventor'),
        titularCompleto: extractTableData('Titular'),
        inventor: extractTableData('Inventor') || extractTableData('Inventores'),
        inventores: extractTableData('Inventor') || extractTableData('Inventores'),
        procurador: extractProcurador(),
        classificacao: extractTableData('Classificação') || extractTableData('IPC'),
        classificacaoIPC: extractTableData('Classificação Internacional') || extractTableData('IPC'),
        prioridade: extractTableData('Prioridade') || extractTableData('Reivindicação de Prioridade'),
        status: classifyPatentStatus(
            extractTableData('Despacho') || extractTableData('Último Despacho'),
            extractTableData('Complemento') || extractTableData('Situação')
        ),
        ultimoDespacho: extractTableData('Despacho') || extractTableData('Último Despacho'),
        complementoDespacho: extractTableData('Complemento') || extractTableData('Situação'),
        documentos: documentos,
        temDocumentos: documentos.length > 0,
        documentosBaixados: documentos.filter(d => d.baixado).length,
        publicacoes,
        url: page.url(),
        html: html,
        timestamp: new Date().toISOString()
    };
    
    return data;
}

export async function processInpiPatent(codPedido: string) {
    return await withSessionLock(async () => {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const page = await ensureSessionPage();
                console.log(`🔍 Processando patente INPI: ${codPedido}`);
                
                const success = await searchAndOpenPatentDetail(page, codPedido);
                if (!success) {
                    throw new Error(`Não foi possível encontrar a patente ${codPedido}`);
                }
                
                const patentData = await extractPatentData(page, codPedido);
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
                    if (Array.isArray(patentData.publicacoes) && patentData.publicacoes.length) {
                        for (const pub of patentData.publicacoes) {
                            try {
                                const existing = await prisma.inpiPublication.findFirst({
                                    where: { patent_id: targetCodPedido, rpi: pub.rpi, despacho_code: pub.despacho_code, date: pub.date, complement: pub.complement }
                                });
                                const despacho_desc = classifyPatentStatus(pub.despacho_code, pub.complement);
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
