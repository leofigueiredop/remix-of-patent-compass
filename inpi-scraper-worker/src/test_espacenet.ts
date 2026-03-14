import axios, { AxiosRequestConfig } from 'axios';
import * as dotenv from 'dotenv';
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

dotenv.config();

const OPS_KEY = process.env.OPS_CONSUMER_KEY || '';
const OPS_SECRET = process.env.OPS_CONSUMER_SECRET || '';
const S3_ENDPOINT = process.env.S3_ENDPOINT || '';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || '';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || '';
const S3_BUCKET = process.env.S3_BUCKET || 'patents';
const S3_REGION = process.env.S3_REGION || 'garage';
const SKIP_S3_UPLOAD = process.env.SKIP_S3_UPLOAD === 'true';
const TEST_DOCDB_ID = process.env.TEST_DOCDB_ID || 'BR.202022014179.U2';
const MAX_RETRIES = 4;

type OpsDocumentInstance = {
    '@desc'?: string;
    '@link'?: string;
    '@number-of-pages'?: string;
};

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestWithRetry<T = any>(config: AxiosRequestConfig, attempt = 1): Promise<T> {
    try {
        const response = await axios.request<T>(config);
        return response.data;
    } catch (err: any) {
        const status = err?.response?.status;
        const shouldRetry = (status === 429 || (status >= 500 && status <= 599)) && attempt < MAX_RETRIES;
        if (!shouldRetry) {
            throw err;
        }
        const retryAfter = Number(err?.response?.headers?.['retry-after']);
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(30000, 1000 * (2 ** (attempt - 1)));
        await sleep(backoff);
        return requestWithRetry<T>(config, attempt + 1);
    }
}

function requireEnv() {
    const missing: string[] = [];
    if (!OPS_KEY) missing.push('OPS_CONSUMER_KEY');
    if (!OPS_SECRET) missing.push('OPS_CONSUMER_SECRET');
    if (!SKIP_S3_UPLOAD) {
        if (!S3_ENDPOINT) missing.push('S3_ENDPOINT');
        if (!S3_ACCESS_KEY) missing.push('S3_ACCESS_KEY');
        if (!S3_SECRET_KEY) missing.push('S3_SECRET_KEY');
    }
    if (missing.length > 0) {
        throw new Error(`Variáveis ausentes: ${missing.join(', ')}`);
    }
}

async function getAccessToken() {
    const auth = Buffer.from(`${OPS_KEY}:${OPS_SECRET}`).toString('base64');
    const data = await requestWithRetry<{ access_token: string }>({
        method: 'POST',
        url: 'https://ops.epo.org/3.2/auth/accesstoken',
        data: 'grant_type=client_credentials',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 30000
    });
    return data.access_token;
}

function getS3Client() {
    return new S3Client({
        endpoint: S3_ENDPOINT,
        region: S3_REGION,
        credentials: {
            accessKeyId: S3_ACCESS_KEY,
            secretAccessKey: S3_SECRET_KEY
        },
        forcePathStyle: true
    });
}

async function ensureBucketExists(s3: S3Client) {
    try {
        await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    } catch {
        await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
    }
}

async function uploadToS3(s3: S3Client, key: string, content: Buffer, contentType: string) {
    await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: content,
        ContentType: contentType
    }));
}

async function fetchImageMetadata(token: string, docdbId: string) {
    const data = await requestWithRetry<any>({
        method: 'GET',
        url: `https://ops.epo.org/3.2/rest-services/published-data/publication/docdb/${docdbId}/images`,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
        },
        timeout: 45000
    });
    const instancesRaw = data?.['ops:world-patent-data']
        ?.['ops:document-inquiry']
        ?.['ops:inquiry-result']
        ?.['ops:document-instance'];
    if (!instancesRaw) {
        throw new Error('OPS não retornou document-instance para o DocDB informado');
    }
    const instances = Array.isArray(instancesRaw) ? instancesRaw : [instancesRaw];
    return instances as OpsDocumentInstance[];
}

async function downloadPdfByLink(token: string, link: string, pageRange: string) {
    const data = await requestWithRetry<ArrayBuffer>({
        method: 'GET',
        url: `https://ops.epo.org/3.2/rest-services/${link}?Range=${encodeURIComponent(pageRange)}`,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/pdf'
        },
        responseType: 'arraybuffer',
        timeout: 60000
    });
    return Buffer.from(data);
}

async function runTest() {
    requireEnv();
    const token = await getAccessToken();
    const metadata = await fetchImageMetadata(token, TEST_DOCDB_ID);
    const fullDocument = metadata.find((item) => item['@desc'] === 'FullDocument' && typeof item['@link'] === 'string');
    const drawing = metadata.find((item) => item['@desc'] === 'Drawing' && typeof item['@link'] === 'string');
    const firstPage = metadata.find((item) => item['@desc'] === 'FirstPageClipping' && typeof item['@link'] === 'string');

    if (!fullDocument?.['@link']) {
        throw new Error('FullDocument não encontrado para este DocDB');
    }

    const fullPages = Math.max(1, Number(fullDocument['@number-of-pages'] || '1'));
    const fullRange = `1-${fullPages}`;
    const fullPdf = await downloadPdfByLink(token, fullDocument['@link'], fullRange);
    const safeDocdb = TEST_DOCDB_ID.replace(/[^\w.-]/g, '_');
    const fullPdfKey = `ops-tests/${safeDocdb}/full_document.pdf`;
    const filesToUpload = new Map<string, Buffer>();
    filesToUpload.set(fullPdfKey, fullPdf);
    const uploads: Array<{ key: string; bytes: number }> = [{ key: fullPdfKey, bytes: fullPdf.length }];
    if (drawing?.['@link']) {
        const drawingPages = Math.max(1, Number(drawing['@number-of-pages'] || '1'));
        const drawingPdf = await downloadPdfByLink(token, drawing['@link'], `1-${drawingPages}`);
        const drawingKey = `ops-tests/${safeDocdb}/drawings.pdf`;
        filesToUpload.set(drawingKey, drawingPdf);
        uploads.push({ key: drawingKey, bytes: drawingPdf.length });
    }
    if (firstPage?.['@link']) {
        const firstPagePdf = await downloadPdfByLink(token, firstPage['@link'], '1');
        const firstPageKey = `ops-tests/${safeDocdb}/first_page.pdf`;
        filesToUpload.set(firstPageKey, firstPagePdf);
        uploads.push({ key: firstPageKey, bytes: firstPagePdf.length });
    }

    if (!SKIP_S3_UPLOAD) {
        const s3 = getS3Client();
        await ensureBucketExists(s3);
        await Promise.all(uploads.map(async (item) => {
            const content = filesToUpload.get(item.key);
            if (!content) return;
            await uploadToS3(s3, item.key, content, 'application/pdf');
        }));
    }

    console.log(JSON.stringify({
        success: true,
        docdbId: TEST_DOCDB_ID,
        skipS3Upload: SKIP_S3_UPLOAD,
        outputs: uploads
    }, null, 2));
}

runTest().catch((err: any) => {
    const status = err?.response?.status;
    const body = typeof err?.response?.data === 'string'
        ? err.response.data
        : err?.response?.data
            ? JSON.stringify(err.response.data)
            : '';
    console.error(JSON.stringify({
        success: false,
        status,
        message: err?.message || 'Erro desconhecido',
        body: body.slice(0, 1200)
    }, null, 2));
    process.exit(1);
});
