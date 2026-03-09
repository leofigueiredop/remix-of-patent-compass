
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
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
        console.log('Posting submission=continuar...');
        await execAsync(
            `curl -v -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -c ${cookieFile} -X POST '${loginUrl}' --data-binary @${payloadFilePrimary} -o /dev/null`,
            { timeout: 20000 }
        );

        fs.writeFileSync(payloadFileFallback, 'action=login&T_Login=&T_Senha=&Usuario=', 'utf8');
        console.log('Posting empty login...');
        await execAsync(
            `curl -v -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -c ${cookieFile} -X POST '${loginUrl}' --data-binary @${payloadFileFallback} -o /dev/null`,
            { timeout: 20000 }
        );
    } finally {
        try { fs.unlinkSync(payloadFilePrimary); } catch { }
        try { fs.unlinkSync(payloadFileFallback); } catch { }
    }
}

function parseInpiResults(html: string): any[] {
    const $ = cheerio.load(html);
    const results: any[] = [];
    const baseUrl = 'https://busca.inpi.gov.br';

    $('table tr').each((_, row) => {
        const link = $(row).find('a[href*="PatenteServletController"]').first();
        if (!link.length) return;

        const cells = $(row).find('td');
        if (cells.length < 2) return;

        const number = link.text().trim();
        if (!number) return;
        
        console.log('Found patent:', number);
        results.push({ publicationNumber: number });
    });

    const totalMatch = html.match(/Foram encontrados\s*<b>(\d+)<\/b>/);
    const total = totalMatch ? parseInt(totalMatch[1]) : results.length;
    console.log(`INPI: found ${results.length} results (total: ${total})`);

    return results;
}

async function searchInpiViaCurl(params: {
    number?: string;
    titular?: string;
    inventor?: string;
    keywords?: string;
    resumo?: string;
}): Promise<any[]> {
    const cookieFile = `/tmp/inpi_${randomUUID()}.txt`;
    const payloadFile = `/tmp/inpi_payload_${randomUUID()}.txt`;

    try {
        await initializeInpiAnonymousSession(cookieFile);

        const fields: Record<string, string> = {
            Action: 'SearchAvancado',
            NumPedido: params.number?.trim() || '',
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
            Titulo: params.keywords?.trim() || '',
            Resumo: params.resumo?.trim() || '',
            NomeDepositante: params.titular?.trim() || '',
            CpfCnpjDepositante: '',
            NomeInventor: params.inventor?.trim() || '',
            RegisterPerPage: '100',
            botao: ' pesquisar » ',
        };

        const postBody = Object.entries(fields)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');
        fs.writeFileSync(payloadFile, postBody, 'utf8');
        console.log(`INPI curl search: Titular="${params.titular}"`);

        const { stdout } = await execAsync(
            `curl -v -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController' --data-binary @${payloadFile} | iconv -f ISO-8859-1 -t UTF-8`,
            { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
        );

        // Save stdout to file for inspection
        fs.writeFileSync('inpi_debug_response.html', stdout);
        console.log('Response saved to inpi_debug_response.html');

        try { fs.unlinkSync(cookieFile); } catch { }
        try { fs.unlinkSync(payloadFile); } catch { }

        return parseInpiResults(stdout);
    } catch (error: any) {
        try { fs.unlinkSync(cookieFile); } catch { }
        try { fs.unlinkSync(payloadFile); } catch { }
        console.error(`INPI curl search failed: ${error.message}`);
        return [];
    }
}

// Run the search
searchInpiViaCurl({ titular: 'petrobras' }).then(results => {
    console.log('Search finished.');
});
