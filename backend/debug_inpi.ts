import * as fs from 'fs';
import { randomUUID } from 'crypto';
import * as cheerio from 'cheerio';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

async function execInpiCurlWithRetry(cmd: string, retries = 3, timeout = 30000, maxBuffer = 10 * 1024 * 1024): Promise<{ stdout: string; stderr: string }> {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await execAsync(cmd, { timeout, maxBuffer });
        } catch (err: any) {
            lastError = err;
            await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        }
    }
    throw lastError;
}

const INPI_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const INPI_SEC_HEADERS = `-H 'sec-ch-ua: "Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"' -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Mac OS X"'`;

async function initializeInpiSession(cookieFile: string): Promise<void> {
    const payloadFilePrimary = `/tmp/inpi_login_primary_${randomUUID()}.txt`;
    const loginUrl = 'https://busca.inpi.gov.br/pePI/servlet/LoginController';

    try {
        console.log('Step 1: Get initial cookies...');
        await execInpiCurlWithRetry(
            `curl -v --http1.1 -L -A '${INPI_USER_AGENT}' ${INPI_SEC_HEADERS} -c ${cookieFile} 'https://busca.inpi.gov.br/pePI/' -o /dev/null`,
            3,
            20000
        );

        const inpiUser = process.env.INPI_USER || '';
        const inpiPass = (process.env.INPI_PASSWORD || '').replace(/!/g, '%21');
        const loginPayload = `T_Login=${encodeURIComponent(inpiUser)}&T_Senha=${inpiPass}&action=login&Usuario=`;

        fs.writeFileSync(payloadFilePrimary, loginPayload, 'utf8');
        console.log(`Step 2: Authenticating as ${inpiUser || 'anonymous'}...`);

        await execInpiCurlWithRetry(
            `curl -v --http1.1 -L -A '${INPI_USER_AGENT}' ${INPI_SEC_HEADERS} ` +
            `-H 'Content-Type: application/x-www-form-urlencoded' ` +
            `-H 'Origin: https://busca.inpi.gov.br' ` +
            `-b ${cookieFile} -c ${cookieFile} ` +
            `-X POST '${loginUrl}' --data-binary @${payloadFilePrimary} -o /dev/null`,
            3,
            30000
        );

        console.log('Step 3: Access PatenteSearchBasico.jsp...');
        await execInpiCurlWithRetry(
            `curl -s --http1.1 -L -A '${INPI_USER_AGENT}' ${INPI_SEC_HEADERS} ` +
            `-b ${cookieFile} -c ${cookieFile} 'https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchBasico.jsp' -o /dev/null`,
            3,
            20000
        );

        console.log('Step 4: Access SearchAvancado...');
        await execInpiCurlWithRetry(
            `curl -s --http1.1 -L -A '${INPI_USER_AGENT}' ${INPI_SEC_HEADERS} ` +
            `-b ${cookieFile} -c ${cookieFile} 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=SearchAvancado' -o /dev/null`,
            3,
            20000
        );

        console.log('Session initialized.');
    } finally {
        try { fs.unlinkSync(payloadFilePrimary); } catch { }
    }
}

function parseInpiResults(html: string) {
    const $ = cheerio.load(html);
    const results: any[] = [];
    const baseUrl = 'https://busca.inpi.gov.br';

    $('table tr').each((i: number, row: any) => {
        const link = $(row).find('a[href*="PatenteServletController"]').first();
        if (!link.length) return;

        // Only accept detail view links (skips pagination, header/footer)
        const href = link.attr('href') || '';
        const onclick = link.attr('onclick') || '';
        if (!href.includes('Action=detail') && !onclick.includes('Action=detail')) return;
        
        // Skip links that just look like page numbers or control text
        const linkText = link.text().trim();
        if (/^\d+$/.test(linkText) && linkText.length < 5) return;
        if (/pr[óo]xima|anterior|in[íi]cio|fim/i.test(linkText)) return;

        results.push({ number: linkText });
    });

    const pageText = $.root().text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
    
    // Improved regex to capture totals even with dots/commas and varied bold tags
    const totalMatch = html.match(/Foram\s+encontrados.*?<b>\s*([\d.,]+)\s*<\/b>\s*processos/i)
        || html.match(/Foram\s+encontrados.*?([\d.,]+)\s*processos/i)
        || html.match(/Foram\s+encontrados.*?<b>\s*([\d.,]+)\s*<\/b>/i)
        || pageText.match(/Foram\s+encontrados\s*([\d.,]+)/i);

    const totalRaw = totalMatch?.[1]?.replace(/[^\d]/g, '');
    const total = totalRaw ? parseInt(totalRaw, 10) : results.length;

    return { resultsCount: results.length, total, firstResult: results[0]?.number, lastResult: results[results.length-1]?.number };
}

async function debugSearch() {
    const cookieFile = `/tmp/debug_inpi_${randomUUID()}.txt`;
    try {
        await initializeInpiSession(cookieFile);

        const payloadFile = `/tmp/inpi_payload_${randomUUID()}.txt`;
        const postBody = `Action=SearchAvancado&Titulo=modular&RegisterPerPage=100&botao= pesquisar » `;
        fs.writeFileSync(payloadFile, postBody, 'utf8');

        console.log('Executing search for "modular"...');
        const { stdout } = await execInpiCurlWithRetry(
            `curl -sS -L --http1.1 -A '${INPI_USER_AGENT}' ${INPI_SEC_HEADERS} -b ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController' --data-binary @${payloadFile} | iconv -f ISO-8859-1 -t UTF-8`,
            3,
            35000
        );

        const debugHtmlFile = '/tmp/inpi_debug_result.html';
        fs.writeFileSync(debugHtmlFile, stdout);
        console.log(`Raw HTML saved to ${debugHtmlFile}`);

        const result = parseInpiResults(stdout);
        console.log('PARSING RESULT:', result);

        if (result.resultsCount === 101) {
            console.log('Found 101 results! Investigating the 101st row...');
            const $ = cheerio.load(stdout);
            const links: string[] = [];
            $('table tr').each((_: number, row: any) => {
                const link = $(row).find('a[href*="PatenteServletController"]').first();
                if (link.length) links.push(link.text().trim());
            });
            console.log('Recent links:', links.slice(-5));
        }

    } catch (err: any) {
        console.error('Debug failed:', err.message);
    } finally {
        try { fs.unlinkSync(cookieFile); } catch { }
    }
}

debugSearch();
