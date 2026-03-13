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
    const cookieFile = `/tmp/inpi_test_full_${Date.now()}.txt`;
    console.log("Cookie file:", cookieFile);

    console.log("Initializing session...");
    await execInpiCurlWithRetry(`curl -s -L -A 'Mozilla/5.0' -c ${cookieFile} 'https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login'`);
    fs.writeFileSync('/tmp/pay1.txt', 'submission=continuar', 'utf8');
    await execInpiCurlWithRetry(`curl -s -L -A 'Mozilla/5.0' -b ${cookieFile} -c ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/LoginController' --data-binary @/tmp/pay1.txt`);
    fs.writeFileSync('/tmp/pay2.txt', 'action=login&T_Login=&T_Senha=&Usuario=', 'utf8');
    await execInpiCurlWithRetry(`curl -s -L -A 'Mozilla/5.0' -b ${cookieFile} -c ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/LoginController' --data-binary @/tmp/pay2.txt`);

    console.log("Doing a search for CodPedido 1774911...");
    const payloadFile = `/tmp/pay3.txt`;
    const fields: Record<string, string> = {
        Action: 'SearchAvancado',
        NumPedido: '1774911', NumGru: '', NumProtocolo: '', NumPrioridade: '', CodigoPct: '',
        DataDeposito1: '', DataDeposito2: '', DataPrioridade1: '', DataPrioridade2: '',
        DataDepositoPCT1: '', DataDepositoPCT2: '', DataPublicacaoPCT1: '', DataPublicacaoPCT2: '',
        ClassificacaoIPC: '', CatchWordIPC: '', Titulo: '', Resumo: '', NomeDepositante: '',
        CpfCnpjDepositante: '', NomeInventor: '', RegisterPerPage: '100', botao: ' pesquisar » '
    };
    const postBody = Object.entries(fields).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    fs.writeFileSync(payloadFile, postBody, 'utf8');

    let resSearch = await execInpiCurlWithRetry(`curl -sS -L --http1.1 -A 'Mozilla/5.0' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -c ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController' --data-binary @${payloadFile} | iconv -f ISO-8859-1 -t UTF-8`);

    let html = resSearch.stdout;
    if (html.includes("url('http")) {
        const match = html.match(/url\(['"](http[^'"]+)['"]\)/i);
        if (match && match[1]) {
            console.log("FOLLOWING REDIRECT:", match[1]);
            resSearch = await execInpiCurlWithRetry(`curl -sS -L --http1.1 -A 'Mozilla/5.0' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -c ${cookieFile} '${match[1]}' | iconv -f ISO-8859-1 -t UTF-8`);
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
        return;
    }

    console.log("FOUND URL:", detailUrl);

    console.log("Fetching detail WITH --http1.1 ...");
    // Try With HTTP1.1
    let detailCmd1 = `curl -s -v -L --http1.1 -A 'Mozilla/5.0' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -c ${cookieFile} '${detailUrl.replace(/'/g, "%27")}'`;
    let resDetail1 = await execInpiCurlWithRetry(detailCmd1);
    console.log("Detail HTTP1.1 stdout length:", resDetail1.stdout.length);
    console.log("HTTP1.1 begins with:", resDetail1.stdout.substring(0, 100));

    // Try Without HTTP1.1
    console.log("Fetching detail WITHOUT --http1.1 ...");
    let detailCmd2 = `curl -s -v -L -A 'Mozilla/5.0' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -c ${cookieFile} '${detailUrl.replace(/'/g, "%27")}'`;
    let resDetail2 = await execInpiCurlWithRetry(detailCmd2);
    console.log("Detail Default stdout length:", resDetail2.stdout.length);
    console.log("Default begins with:", resDetail2.stdout.substring(0, 100));
}
test();
