import axios from 'axios';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ESPACENET_PPTR_HEADLESS = (process.env.ESPACENET_PPTR_HEADLESS || 'true').toLowerCase() !== 'false';
const ESPACENET_PPTR_WS_ENDPOINT = process.env.ESPACENET_PPTR_WS_ENDPOINT || '';
const HUMAN_DELAY_MIN_MS = Math.max(200, parseInt(process.env.ESPACENET_HUMAN_DELAY_MIN_MS || '450', 10));
const HUMAN_DELAY_MAX_MS = Math.max(HUMAN_DELAY_MIN_MS + 50, parseInt(process.env.ESPACENET_HUMAN_DELAY_MAX_MS || '1300', 10));

function normalizeText(value?: string) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function randomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanPause(multiplier = 1) {
    const wait = Math.round(randomInt(HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS) * multiplier);
    await sleep(wait);
}

function hasSecurityChallenge(html?: string, title?: string) {
    const text = normalizeText(`${title || ''} ${html || ''}`).toLowerCase();
    return text.includes('security verification') || text.includes('just a moment') || text.includes('verify you are not a bot');
}

async function waitForPatentContent(page: any, timeoutMs = 25000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const state = await page.evaluate(() => {
            const body = (document.body?.innerText || '').toLowerCase();
            const title = (document.title || '').toLowerCase();
            const hasPatentTabs = body.includes('bibliographic data')
                || body.includes('original document')
                || body.includes('drawings')
                || body.includes('legal events');
            const hasChallenge = body.includes('security verification')
                || body.includes('just a moment')
                || body.includes('verify you are not a bot')
                || title.includes('security verification')
                || title.includes('just a moment');
            return { hasPatentTabs, hasChallenge };
        }).catch(() => ({ hasPatentTabs: false, hasChallenge: true }));
        if (state.hasPatentTabs) return true;
        if (!state.hasChallenge) {
            await sleep(700);
            continue;
        }
        await sleep(1200);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => undefined);
    }
    return false;
}

async function refreshLikeHuman(page: any, url: string) {
    await page.mouse.move(randomInt(120, 420), randomInt(70, 150)).catch(() => undefined);
    await humanPause(0.35);
    await page.keyboard.down('Meta').catch(() => undefined);
    await page.keyboard.press('KeyR').catch(() => undefined);
    await page.keyboard.up('Meta').catch(() => undefined);
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => undefined);
    const html = await page.content().catch(() => '');
    const title = await page.title().catch(() => '');
    if (!hasSecurityChallenge(html, title)) return true;
    await humanPause(0.8);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => undefined);
    const html2 = await page.content().catch(() => '');
    const title2 = await page.title().catch(() => '');
    if (!hasSecurityChallenge(html2, title2)) return true;
    await humanPause(0.9);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => undefined);
    const html3 = await page.content().catch(() => '');
    const title3 = await page.title().catch(() => '');
    return !hasSecurityChallenge(html3, title3);
}

async function clickByText(page: any, terms: string[]) {
    return page.evaluate((needles: string[]) => {
        const list = Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"], li, span, div')) as HTMLElement[];
        const normalized = needles.map((item) => item.toLowerCase());
        for (const el of list) {
            const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (!text) continue;
            if (!normalized.some((n) => text.includes(n))) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 2 || rect.height < 2) continue;
            el.click();
            return true;
        }
        return false;
    }, terms);
}

async function typeHuman(page: any, selector: string, value: string) {
    await page.click(selector, { clickCount: 3 }).catch(() => undefined);
    await page.keyboard.press('Backspace').catch(() => undefined);
    for (const ch of value.split('')) {
        await page.type(selector, ch, { delay: randomInt(25, 95) }).catch(() => undefined);
    }
}

async function clickMenuButton(page: any) {
    const selectors = [
        'button[aria-label*="More"]',
        'button[aria-label*="more"]',
        'button[aria-label*="Menu"]',
        'button[aria-label*="menu"]',
        'button[title*="More"]',
        'button[title*="Menu"]',
        '[data-testid*="menu"]',
        '[data-test*="menu"]'
    ];
    for (const selector of selectors) {
        const found = await page.$(selector);
        if (found) {
            await found.click().catch(() => undefined);
            return true;
        }
    }
    return false;
}

async function extractPdfLinkFromDom(page: any): Promise<string | null> {
    return page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href], iframe[src], embed[src]')) as Array<HTMLAnchorElement | HTMLIFrameElement | HTMLEmbedElement>;
        const links = anchors
            .map((item: any) => item.href || item.src || '')
            .filter((link: string) => typeof link === 'string' && link.length > 10);
        const candidate = links.find((link: string) => /\.pdf(\?|$)/i.test(link) || /pdf|original-document|publication-server/i.test(link));
        return candidate || null;
    });
}

async function openPublicationByInterface(page: any, candidate: string): Promise<boolean> {
    const homeUrl = 'https://worldwide.espacenet.com/';
    await page.goto(homeUrl, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => undefined);
    await humanPause(0.9);
    await clickByText(page, ['accept', 'aceitar', 'allow all', 'consent']).catch(() => undefined);
    await humanPause(0.7);
    const selectors = [
        'input[type="search"]',
        'input[name*="query"]',
        'input[id*="query"]',
        'input[placeholder*="Search"]',
        'input[aria-label*="Search"]'
    ];
    let chosen = '';
    for (const selector of selectors) {
        const found = await page.$(selector);
        if (found) {
            chosen = selector;
            break;
        }
    }
    if (!chosen) return false;
    await typeHuman(page, chosen, candidate);
    await humanPause(0.6);
    await page.keyboard.press('Enter').catch(() => undefined);
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => undefined);
    await humanPause(0.8);

    const clickedResult = await page.evaluate((normalizedCandidate: string) => {
        const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        const normalized = normalizedCandidate.toLowerCase();
        const target = links.find((link) => {
            const href = (link.href || '').toLowerCase();
            const text = (link.textContent || '').replace(/\s+/g, '').toLowerCase();
            return href.includes('/publication/') && (href.includes(normalized) || text.includes(normalized));
        });
        if (!target) return false;
        target.click();
        return true;
    }, candidate.toLowerCase());
    if (clickedResult) {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => undefined);
        await humanPause(0.8);
        return true;
    }
    return false;
}

export async function downloadEspacenetOriginalDocument(publicationNumber: string): Promise<Buffer | null> {
    const candidate = String(publicationNumber || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!candidate) return null;
    const url = `https://worldwide.espacenet.com/patent/search/publication/${candidate}`;
    const browser = ESPACENET_PPTR_WS_ENDPOINT
        ? await puppeteer.connect({ browserWSEndpoint: ESPACENET_PPTR_WS_ENDPOINT })
        : await puppeteer.launch({
            headless: ESPACENET_PPTR_HEADLESS,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1366,900',
                '--lang=en-US,en'
            ]
        });
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 900 });
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
            'Upgrade-Insecure-Requests': '1'
        });
        await page.emulateTimezone('America/Sao_Paulo').catch(() => undefined);
        const viaInterface = await openPublicationByInterface(page, candidate).catch(() => false);
        if (!viaInterface) {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
        }
        await page.mouse.move(220, 180);
        await humanPause(0.45);
        await page.mouse.move(640, 320);
        const firstHtml = await page.content();
        const firstTitle = await page.title();
        if (hasSecurityChallenge(firstHtml, firstTitle)) {
            let recovered = false;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                recovered = await waitForPatentContent(page, 10000);
                if (recovered) break;
                const refreshed = await refreshLikeHuman(page, url);
                if (refreshed) {
                    recovered = await waitForPatentContent(page, 12000);
                    if (recovered) break;
                }
            }
            if (!recovered) throw new Error('ESPACENET_BOT_CHALLENGE');
        } else {
            await waitForPatentContent(page, 12000).catch(() => undefined);
        }

        await humanPause(1.1);
        await clickByText(page, ['original document', 'documento original']).catch(() => undefined);
        await humanPause(0.9);

        const pdfResponsePromise = page.waitForResponse((resp: any) => {
            const headers = resp.headers();
            const contentType = String(headers['content-type'] || '').toLowerCase();
            const responseUrl = String(resp.url() || '').toLowerCase();
            return resp.status() >= 200
                && resp.status() < 400
                && (contentType.includes('application/pdf') || /\.pdf(\?|$)/i.test(responseUrl) || responseUrl.includes('pdf'));
        }, { timeout: 25000 }).catch(() => null);

        const menuOpened = await clickMenuButton(page);
        if (menuOpened) {
            await humanPause(0.5);
            await clickByText(page, ['download', 'baixar']).catch(() => undefined);
            await humanPause(0.5);
            await clickByText(page, ['original document', 'documento original']).catch(() => undefined);
        } else {
            await clickByText(page, ['download', 'baixar']).catch(() => undefined);
            await humanPause(0.45);
            await clickByText(page, ['original document', 'documento original']).catch(() => undefined);
        }

        const pdfResponse = await pdfResponsePromise;
        if (pdfResponse) {
            const buffer = await pdfResponse.buffer();
            if (buffer.length > 1024) return buffer;
        }

        const domPdfLink = await extractPdfLinkFromDom(page);
        if (domPdfLink) {
            const cookies = await page.cookies();
            const cookieHeader = cookies.map((item: any) => `${item.name}=${item.value}`).join('; ');
            const response = await axios.get(domPdfLink, {
                responseType: 'arraybuffer',
                timeout: 45000,
                headers: {
                    Cookie: cookieHeader,
                    Referer: url,
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                },
                validateStatus: () => true
            });
            if (response.status >= 200 && response.status < 300) {
                const buffer = Buffer.from(response.data);
                if (buffer.length > 1024) return buffer;
            }
        }
        return null;
    } finally {
        await browser.close().catch(() => undefined);
    }
}
