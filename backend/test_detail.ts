import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { exec } from 'child_process';

const execInpiCurlWithRetry = (cmd: string) => {
    return new Promise<{ stdout: string, stderr: string }>((resolve) => {
        exec(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
            console.log("EXEC DONE:", error ? error.message : "Success");
            if (stderr) console.log("STDERR snippet:", stderr.substring(0, 500));
            resolve({ stdout: stdout || '', stderr: stderr || '' });
        });
    });
};

async function test() {
    const cookieFile = `/tmp/inpi_test_detail_${Date.now()}.txt`;
    console.log("Cookie file:", cookieFile);

    console.log("Now executing detail...");
    const url = 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=1774911';

    console.log("With iconv:");
    const cmd = `curl -s -v -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -c ${cookieFile} '${url}' | iconv -f ISO-8859-1 -t UTF-8`;
    console.log("Running:", cmd);
    const resIconv = await execInpiCurlWithRetry(cmd);
    console.log("Iconv stdout len:", resIconv.stdout.length);
    console.log("Iconv stderr:", resIconv.stderr.substring(0, 500));

    if (resIconv.stdout.length > 0) {
        fs.writeFileSync('/tmp/test_detail_output.html', resIconv.stdout);
        console.log("Saved to /tmp/test_detail_output.html");
    }
}
test();
