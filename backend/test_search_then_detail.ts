import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { exec } from 'child_process';

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
    const fields: Record<string, string> = { Action: 'SearchAvancado', NumPedido: '1774911', RegisterPerPage: '100', botao: ' pesquisar » ' };
    const postBody = Object.entries(fields).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    fs.writeFileSync(payloadFile, postBody, 'utf8');

    const resSearch = await execInpiCurlWithRetry(`curl -s -L -A 'Mozilla/5.0' -b ${cookieFile} -c ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController' --data-binary @${payloadFile}`);
    console.log("Search stdout length:", resSearch.stdout.length);
    if (resSearch.stdout.includes('1774911')) console.log("Search found 1774911 in HTML");

    console.log("Now fetching detail...");
    const url = 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=1774911';
    const resDetail = await execInpiCurlWithRetry(`curl -s -v -L --http1.1 -A 'Mozilla/5.0' -b ${cookieFile} -c ${cookieFile} '${url}'`);
    console.log("Detail stdout length:", resDetail.stdout.length);
    console.log("Detail stderr snippet:", resDetail.stderr.substring(0, 1500));
    fs.writeFileSync('/tmp/test_detail_after_search.html', resDetail.stdout);
    if (!resDetail.stdout.includes('pepi - pesquisa em') && resDetail.stdout.length > 0) {
        console.log("SUCCESS! WE GOT THE DETAILS.");
    } else {
        console.log("FAIL: Still login page or empty.");
    }
}
test();
