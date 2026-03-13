const { exec } = require('child_process');
const cheerio = require('cheerio');
const fs = require('fs');

const execInpiCurlWithRetry = (cmd) => {
    return new Promise((resolve) => {
        exec(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({ stdout: stdout || '', stderr: stderr || '' });
        });
    });
};

async function run() {
    const cookieFile = `/tmp/inpi_test_html_${Date.now()}.txt`;
    await execInpiCurlWithRetry(`curl -s -L -A 'Mozilla/5.0' -c ${cookieFile} 'https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login'`);
    fs.writeFileSync('/tmp/pay1.txt', 'submission=continuar', 'utf8');
    await execInpiCurlWithRetry(`curl -s -L -A 'Mozilla/5.0' -b ${cookieFile} -c ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/LoginController' --data-binary @/tmp/pay1.txt`);
    fs.writeFileSync('/tmp/pay2.txt', 'action=login&T_Login=&T_Senha=&Usuario=', 'utf8');
    await execInpiCurlWithRetry(`curl -s -L -A 'Mozilla/5.0' -b ${cookieFile} -c ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/LoginController' --data-binary @/tmp/pay2.txt`);

    // Fetch Advanced Search HTML
    const res = await execInpiCurlWithRetry(`curl -s -L -A 'Mozilla/5.0' -b ${cookieFile} -c ${cookieFile} 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=SearchAvancado' | iconv -f ISO-8859-1 -t UTF-8`);
    const $ = cheerio.load(res.stdout);

    const inputs = [];
    $('input, select').each((_, el) => {
        const name = $(el).attr('name');
        if (name && !inputs.includes(name)) inputs.push(name);
    });
    console.log("Found Input Fields:");
    console.log(inputs.filter(n => n.toLowerCase().includes('data') || n.toLowerCase().includes('publi') || n.toLowerCase().includes('revista')));
}
run();
