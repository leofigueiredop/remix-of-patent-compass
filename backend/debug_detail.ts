
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { randomUUID } from 'crypto';
import * as cheerio from 'cheerio';

const execAsync = promisify(exec);

async function initializeInpiAnonymousSession(cookieFile: string): Promise<void> {
    const payloadFilePrimary = `/tmp/inpi_login_primary_${randomUUID()}.txt`;
    const payloadFileFallback = `/tmp/inpi_login_fallback_${randomUUID()}.txt`;
    const loginUrl = 'https://busca.inpi.gov.br/pePI/servlet/LoginController';
    try {
        console.log('Initializing session...');
        await execAsync(
            `curl -v -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -c ${cookieFile} '${loginUrl}?action=login' -o /dev/null`,
            { timeout: 15000 }
        );

        fs.writeFileSync(payloadFilePrimary, 'submission=continuar', 'utf8');
        await execAsync(
            `curl -v -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -c ${cookieFile} -X POST '${loginUrl}' --data-binary @${payloadFilePrimary} -o /dev/null`,
            { timeout: 20000 }
        );

        fs.writeFileSync(payloadFileFallback, 'action=login&T_Login=&T_Senha=&Usuario=', 'utf8');
        await execAsync(
            `curl -v -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -c ${cookieFile} -X POST '${loginUrl}' --data-binary @${payloadFileFallback} -o /dev/null`,
            { timeout: 20000 }
        );
    } finally {
        try { fs.unlinkSync(payloadFilePrimary); } catch { }
        try { fs.unlinkSync(payloadFileFallback); } catch { }
    }
}

async function fetchDetail() {
    const cookieFile = `/tmp/inpi_detail_${randomUUID()}.txt`;
    const payloadFile = `/tmp/inpi_payload_${randomUUID()}.txt`;
    
    try {
        await initializeInpiAnonymousSession(cookieFile);
        
        // 1. Perform Search
        const fields: Record<string, string> = {
            Action: 'SearchAvancado',
            NumPedido: '',
            NumGru: '',
            NumProtocolo: '',
            NumPrioridade: '',
            CodigoPct: '',
            DataDeposito1: '',
            DataDeposito2: '',
            DataPrioridade1: '',
            DataPrioridade2: '',
            DataDepositoPCT1: '',
            DataDepositoPCT2: '',
            DataPublicacaoPCT1: '',
            DataPublicacaoPCT2: '',
            ClassificacaoIPC: '',
            CatchWordIPC: '',
            Titulo: '',
            Resumo: '',
            NomeDepositante: 'petrobras',
            CpfCnpjDepositante: '',
            NomeInventor: '',
            RegisterPerPage: '100',
            botao: ' pesquisar » ',
        };

        const postBody = Object.entries(fields)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');
        fs.writeFileSync(payloadFile, postBody, 'utf8');
        
        console.log('Performing search...');
        const { stdout: searchHtml } = await execAsync(
            `curl -v -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController' --data-binary @${payloadFile} | iconv -f ISO-8859-1 -t UTF-8`,
            { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
        );

        fs.writeFileSync('search_debug.html', searchHtml);
        console.log('Saved search_debug.html');

        // 2. Parse first result with empty title
        const $ = cheerio.load(searchHtml);
        let targetUrl = '';
        
        $('table tr').each((_, row) => {
            if (targetUrl) return;
            const link = $(row).find('a[href*="PatenteServletController"]').first();
            if (!link.length) return;
            
            // Extract CodPedido
            const href = link.attr('href') || '';
            const codMatch = href.match(/[?&]CodPedido=(\d+)/i);
            if (codMatch) {
                targetUrl = `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${codMatch[1]}`;
                console.log(`Found target URL: ${targetUrl}`);
            }
        });

        if (!targetUrl) {
            console.log('No patent found in search results.');
            return;
        }

        // 3. Fetch Detail
        console.log(`Fetching detail: ${targetUrl}`);
        const { stdout: detailHtml } = await execAsync(
            `curl -v -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} '${targetUrl}' | iconv -f ISO-8859-1 -t UTF-8`,
            { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
        );

        fs.writeFileSync('detail_debug.html', detailHtml);
        console.log('Saved detail_debug.html');

    } catch (err: any) {
        console.error('Error:', err);
    } finally {
        try { fs.unlinkSync(cookieFile); } catch { }
        try { fs.unlinkSync(payloadFile); } catch { }
    }
}

fetchDetail();
