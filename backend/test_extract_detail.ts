import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { exec } from 'child_process';
import * as cheerio from 'cheerio';

const execInpiCurlWithRetry = (cmd: string) => {
    return new Promise<{ stdout: string, stderr: string }>((resolve) => {
        exec(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({ stdout: stdout || '', stderr: stderr || '' });
        });
    });
};

async function test() {
    const cookieFile = `/tmp/inpi_test_extracted_${Date.now()}.txt`;
    console.log("Cookie file:", cookieFile);

    console.log("Initializing session...");
    await execInpiCurlWithRetry(`curl -s -L -A 'Mozilla/5.0' -c ${cookieFile} 'https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login'`);
    fs.writeFileSync('/tmp/pay1.txt', 'submission=continuar', 'utf8');
    await execInpiCurlWithRetry(`curl -s -L -A 'Mozilla/5.0' -b ${cookieFile} -c ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/LoginController' --data-binary @/tmp/pay1.txt`);
    fs.writeFileSync('/tmp/pay2.txt', 'action=login&T_Login=&T_Senha=&Usuario=', 'utf8');
    await execInpiCurlWithRetry(`curl -s -L -A 'Mozilla/5.0' -b ${cookieFile} -c ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/LoginController' --data-binary @/tmp/pay2.txt`);

    console.log("Doing a search for CodPedido 1774911...");
    const payloadFile = `/tmp/pay3.txt`;
    const fields: Record<string, string> = { Action: 'SearchAvancado', NumPedido: '1774911', RegisterPerPage: '100', botao: ' pesquisar » ' };
    const postBody = Object.entries(fields).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    fs.writeFileSync(payloadFile, postBody, 'utf8');

    let resSearch = await execInpiCurlWithRetry(`curl -s -L -A 'Mozilla/5.0' -b ${cookieFile} -c ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController' --data-binary @${payloadFile} | iconv -f ISO-8859-1 -t UTF-8`);

    // Check for "Expresso de pesquisa"
    let html = resSearch.stdout;
    if (html.includes("url('http")) {
        // Redirection! INPI uses window.location.replace or meta refresh for POST-Redirect-GET
        const match = html.match(/url\(['"](http[^'"]+)['"]\)/i);
        if (match && match[1]) {
            console.log("FOLLOWING REDIRECT:", match[1]);
            resSearch = await execInpiCurlWithRetry(`curl -s -L -A 'Mozilla/5.0' -b ${cookieFile} -c ${cookieFile} '${match[1]}' | iconv -f ISO-8859-1 -t UTF-8`);
            html = resSearch.stdout;
        }
    }

    const $ = cheerio.load(html);
    let detailUrl = null;
    $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('Action=detail&CodPedido=1774911')) {
            detailUrl = "https://busca.inpi.gov.br/pePI/servlet/" + href;
        }
    });

    if (!detailUrl) {
        console.log("COULD NOT FIND detail URL in search results!");
        fs.writeFileSync('/tmp/search_results_dump.html', html);
        return;
    }

    console.log("FOUND URL:", detailUrl);

    console.log("Now fetching detail...");
    const resDetail = await execInpiCurlWithRetry(`curl -s -v -L -A 'Mozilla/5.0' -b ${cookieFile} -c ${cookieFile} '${detailUrl}' | iconv -f ISO-8859-1 -t UTF-8`);
    console.log("Detail stdout length:", resDetail.stdout.length);
    fs.writeFileSync('/tmp/test_detail_extracted.html', resDetail.stdout);
}
test();
