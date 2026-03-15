import axios from 'axios';
import * as cheerio from 'cheerio';
import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { prisma } from '../db';

const execAsync = promisify(exec);
const RPI_BASE_URL = 'https://revistas.inpi.gov.br/txt';
const RPI_LOOKBACK_ISSUES = Math.max(26, parseInt(process.env.RPI_LOOKBACK_ISSUES || '260', 10));
const RPI_SCAN_MAX = Math.max(2000, parseInt(process.env.RPI_SCAN_MAX || '4000', 10));
const RPI_SCAN_MIN = Math.max(1, parseInt(process.env.RPI_SCAN_MIN || '2000', 10));
const RPI_FORCE_LATEST = parseInt(process.env.RPI_FORCE_LATEST || '0', 10);
const MAX_RPI_ATTEMPTS = Math.max(2, parseInt(process.env.MAX_RPI_ATTEMPTS || '8', 10));
const MAX_DOC_ATTEMPTS = Math.max(2, parseInt(process.env.MAX_DOC_ATTEMPTS || '6', 10));
const STALE_JOB_MINUTES = Math.max(5, parseInt(process.env.STALE_JOB_MINUTES || '12', 10));
const OPS_CONSUMER_KEY = process.env.OPS_CONSUMER_KEY || '';
const OPS_CONSUMER_SECRET = process.env.OPS_CONSUMER_SECRET || '';
const S3_ENDPOINT = process.env.S3_ENDPOINT || '';
const S3_REGION = process.env.S3_REGION || 'garage';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || '';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || '';
const S3_BUCKET = process.env.S3_BUCKET || 'patents';

let loopsStarted = false;
let rpiRunning = false;
let docRunning = false;
let rpiPaused = false;
let docsPaused = false;
let latestRpiCache: { value: number; expiresAt: number } | null = null;
let opsAccessToken: string | null = null;
let opsTokenExpiration = 0;
let s3BucketReady = false;

function normalizeText(value?: string): string {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function extractDigits(value?: string): string {
    return (value || '').replace(/[^\d]/g, '');
}

function truncateError(message: string): string {
    return (message || '').slice(0, 1800);
}

function errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) return error.message || fallback;
    if (typeof error === 'string') return error;
    return fallback;
}

function isRetryableZipError(message: string): boolean {
    const normalized = (message || '').toLowerCase();
    return normalized.includes('short read')
        || normalized.includes('end-of-central-directory')
        || normalized.includes('not a zip archive')
        || normalized.includes('unexpected end of file')
        || normalized.includes('invalid zip')
        || normalized.includes('econnreset')
        || normalized.includes('socket hang up')
        || normalized.includes('timeout');
}

async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

function getStaleDate(): Date {
    return new Date(Date.now() - (STALE_JOB_MINUTES * 60 * 1000));
}

function isSigiloStatus(value?: string): boolean {
    const normalized = normalizeText(value).toLowerCase();
    return /sigil|restrit|proteg/.test(normalized);
}

function normalizeDispatchCode(value?: string): string {
    return normalizeText(value)
        .replace(',', '.')
        .replace(/\s+/g, '')
        .replace(/[^\d.]/g, '');
}

function shouldQueueDocumentByDispatchCode(dispatchCode?: string): boolean {
    const normalized = normalizeDispatchCode(dispatchCode);
    return normalized === '3.1' || normalized === '16.1';
}

function normalizePublicationNumber(value?: string): string {
    return normalizeText(value).replace(/\s+/g, '');
}

async function getOpsToken(): Promise<string> {
    if (opsAccessToken && Date.now() < opsTokenExpiration) return opsAccessToken;
    if (!OPS_CONSUMER_KEY || !OPS_CONSUMER_SECRET) {
        throw new Error('Credenciais OPS não configuradas');
    }
    const auth = Buffer.from(`${OPS_CONSUMER_KEY}:${OPS_CONSUMER_SECRET}`).toString('base64');
    const response = await axios.post(
        'https://ops.epo.org/3.2/auth/accesstoken',
        'grant_type=client_credentials',
        {
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 30000
        }
    );
    opsAccessToken = response.data.access_token;
    opsTokenExpiration = Date.now() + (parseInt(response.data.expires_in, 10) * 1000) - 60000;
    return opsAccessToken!;
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

async function ensureS3Bucket() {
    if (s3BucketReady) return;
    if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
        throw new Error('Credenciais S3 não configuradas');
    }
    const s3 = getS3Client();
    try {
        await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    } catch {
        await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
    }
    s3BucketReady = true;
}

async function uploadPdfToS3(key: string, content: Buffer) {
    const s3 = getS3Client();
    await ensureS3Bucket();
    await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: content,
        ContentType: 'application/pdf'
    }));
}

async function rpiZipExists(rpiNumber: number): Promise<boolean> {
    const url = `${RPI_BASE_URL}/P${rpiNumber}.zip`;
    let headStatus: number | undefined;
    try {
        const headResponse = await axios.head(url, {
            timeout: 10000,
            validateStatus: () => true
        });
        headStatus = headResponse.status;
    } catch {
        headStatus = undefined;
    }
    const isZipSignature = (value: Buffer): boolean => {
        if (!value || value.length < 4) return false;
        const signature = value.subarray(0, 4).toString('hex');
        return signature === '504b0304' || signature === '504b0506' || signature === '504b0708';
    };
    if (headStatus === 200) {
        try {
            const probe = await axios.get(url, {
                timeout: 15000,
                responseType: 'arraybuffer',
                headers: { Range: 'bytes=0-3', 'Cache-Control': 'no-cache' },
                validateStatus: () => true
            });
            const data = Buffer.from(probe.data || []);
            return isZipSignature(data);
        } catch {
            return false;
        }
    }
    if (typeof headStatus === 'number' && ![403, 405].includes(headStatus)) return false;
    try {
        const response = await axios.get(url, {
            timeout: 15000,
            responseType: 'arraybuffer',
            headers: { Range: 'bytes=0-3', 'Cache-Control': 'no-cache' },
            validateStatus: () => true
        });
        const data = Buffer.from(response.data || []);
        return (response.status === 200 || response.status === 206) && isZipSignature(data);
    } catch {
        return false;
    }
}

async function detectLatestRpiNumber(): Promise<number | null> {
    if (Number.isFinite(RPI_FORCE_LATEST) && RPI_FORCE_LATEST > 0) {
        return RPI_FORCE_LATEST;
    }
    if (latestRpiCache && Date.now() < latestRpiCache.expiresAt) return latestRpiCache.value;
    let foundBlockTop: number | null = null;
    for (let probe = RPI_SCAN_MAX; probe >= RPI_SCAN_MIN; probe -= 10) {
        if (await rpiZipExists(probe)) {
            foundBlockTop = probe;
            break;
        }
    }
    if (!foundBlockTop) return null;
    const refineStart = Math.min(RPI_SCAN_MAX, foundBlockTop + 9);
    for (let probe = refineStart; probe >= foundBlockTop - 10 && probe >= RPI_SCAN_MIN; probe--) {
        if (await rpiZipExists(probe)) {
            latestRpiCache = { value: probe, expiresAt: Date.now() + (6 * 60 * 60 * 1000) };
            return probe;
        }
    }
    latestRpiCache = { value: foundBlockTop, expiresAt: Date.now() + (6 * 60 * 60 * 1000) };
    return foundBlockTop;
}

export async function enqueueLastFiveYearsRpi() {
    const latest = await detectLatestRpiNumber();
    if (!latest) throw new Error('Não foi possível detectar a RPI mais recente');
    const from = Math.max(1, latest - RPI_LOOKBACK_ISSUES + 1);
    const rows = [];
    for (let rpi = from; rpi <= latest; rpi++) {
        rows.push({
            rpi_number: rpi,
            status: 'pending' as const,
            source_url: `${RPI_BASE_URL}/P${rpi}.zip`
        });
    }
    await prisma.rpiImportJob.createMany({
        data: rows,
        skipDuplicates: true
    });
    return { from, to: latest, count: rows.length };
}

async function getXmlFromZip(zipPath: string): Promise<{ xmlFileName: string; xmlContent: string }> {
    const { stdout: listOut } = await execAsync(`unzip -l "${zipPath}"`, { maxBuffer: 2 * 1024 * 1024 });
    const xmlCandidates = listOut
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            const parts = line.split(/\s+/);
            return parts.length >= 4 ? parts.slice(3).join(' ') : '';
        })
        .filter((entry) => entry.toLowerCase().endsWith('.xml'));
    const xmlFileName = xmlCandidates[0];
    if (!xmlFileName) throw new Error('Nenhum XML encontrado no ZIP da RPI');
    const { stdout: xmlContent } = await execAsync(`unzip -p "${zipPath}" "${xmlFileName}"`, { maxBuffer: 80 * 1024 * 1024 });
    return { xmlFileName, xmlContent };
}

async function validateZipFile(zipPath: string) {
    const handle = await fs.open(zipPath, 'r');
    try {
        const header = Buffer.alloc(4);
        await handle.read(header, 0, 4, 0);
        const signature = header.toString('hex');
        if (signature !== '504b0304' && signature !== '504b0506' && signature !== '504b0708') {
            throw new Error(`Arquivo baixado não parece ZIP válido (assinatura=${signature})`);
        }
    } finally {
        await handle.close();
    }
    await execAsync(`unzip -t "${zipPath}"`, { maxBuffer: 4 * 1024 * 1024 });
}

async function downloadRpiZipWithRetry(zipUrl: string, zipPath: string, maxAttempts = 5) {
    const hasZipSignature = (value: Buffer): boolean => {
        if (!value || value.length < 4) return false;
        const signature = value.subarray(0, 4).toString('hex');
        return signature === '504b0304' || signature === '504b0506' || signature === '504b0708';
    };
    let lastError = 'Falha desconhecida no download do ZIP';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await axios.get(zipUrl, {
                responseType: 'arraybuffer',
                timeout: 120000,
                headers: { 'Cache-Control': 'no-cache' },
                validateStatus: () => true
            });
            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status} ao baixar ${zipUrl}`);
            }
            const payload = Buffer.from(response.data || []);
            if (!hasZipSignature(payload)) {
                throw new Error('Arquivo remoto não é ZIP válido (RPI inexistente neste endpoint)');
            }
            await fs.writeFile(zipPath, response.data);
            await validateZipFile(zipPath);
            return;
        } catch (error: unknown) {
            const message = errorMessage(error, 'Falha no download/validação do ZIP');
            lastError = message;
            const shouldRetry = attempt < maxAttempts && isRetryableZipError(message);
            if (!shouldRetry) break;
            await fs.rm(zipPath, { force: true }).catch(() => undefined);
            await sleep(Math.min(4000, 500 * attempt));
        }
    }
    throw new Error(`Não foi possível baixar ZIP íntegro da RPI após ${maxAttempts} tentativas: ${lastError}`);
}

function nodeText(node: cheerio.Cheerio, selector: string): string {
    return normalizeText(node.find(selector).first().text());
}

async function queueDocumentJobForPatent(params: {
    patentId: string;
    rpiNumber: number;
    publicationNumber?: string;
    status?: string;
    dispatchCode?: string;
}) {
    const existing = await prisma.documentDownloadJob.findUnique({
        where: { patent_id: params.patentId }
    });
    if (isSigiloStatus(params.status)) {
        if (!existing || existing.status !== 'completed') {
            await prisma.documentDownloadJob.upsert({
                where: { patent_id: params.patentId },
                update: {
                    status: 'skipped_sigilo',
                    publication_number: params.publicationNumber || existing?.publication_number || null,
                    rpi_number: params.rpiNumber,
                    error: 'Patente marcada como sigilo na RPI',
                    finished_at: new Date()
                },
                create: {
                    patent_id: params.patentId,
                    rpi_number: params.rpiNumber,
                    publication_number: params.publicationNumber || null,
                    status: 'skipped_sigilo',
                    error: 'Patente marcada como sigilo na RPI',
                    finished_at: new Date()
                }
            });
        }
        return;
    }
    if (!shouldQueueDocumentByDispatchCode(params.dispatchCode)) {
        return;
    }
    if (existing && ['pending', 'running', 'completed'].includes(existing.status)) return;
    await prisma.documentDownloadJob.upsert({
        where: { patent_id: params.patentId },
        update: {
            status: 'pending',
            error: null,
            storage_key: null,
            publication_number: params.publicationNumber || existing?.publication_number || null,
            rpi_number: params.rpiNumber,
            finished_at: null
        },
        create: {
            patent_id: params.patentId,
            rpi_number: params.rpiNumber,
            publication_number: params.publicationNumber || null,
            status: 'pending'
        }
    });
}

async function processRpiXmlContent(rpiNumber: number, xmlContent: string): Promise<number> {
    const $ = cheerio.load(xmlContent, { xmlMode: true });
    const revista = $('revista').first();
    const dataPublicacao = revista.attr('dataPublicacao') || revista.attr('data-publicacao') || '';
    const despachoNodes = revista.find('despacho').toArray();
    let imported = 0;

    for (const node of despachoNodes) {
        const despacho = $(node);
        const processo = despacho.find('processo-patente').first();
        if (!processo.length) continue;
        const numeroRaw = nodeText(processo, 'numero');
        const codPedido = extractDigits(numeroRaw);
        if (!codPedido) continue;
        const dispatchCode = nodeText(despacho, 'codigo') || normalizeText(despacho.attr('codigo') || '');
        const dispatchTitle = nodeText(despacho, 'titulo') || normalizeText(despacho.attr('titulo') || '');
        const complement = nodeText(despacho, 'comentario');
        const inventionTitle = nodeText(processo, 'titulo');
        const filingDate = nodeText(processo, 'data-deposito');
        const applicants = processo
            .find('titular-lista > titular > nome-completo')
            .toArray()
            .map((el) => normalizeText($(el).text()))
            .filter(Boolean)
            .join('; ');
        const inventors = processo
            .find('inventor-lista > inventor > nome-completo')
            .toArray()
            .map((el) => normalizeText($(el).text()))
            .filter(Boolean)
            .join('; ');
        const ipcs = processo
            .find('classificacao-internacional-lista > classificacao-internacional')
            .toArray()
            .map((el) => normalizeText($(el).text()))
            .filter(Boolean)
            .join(', ');

        await prisma.inpiPatent.upsert({
            where: { cod_pedido: codPedido },
            update: {
                numero_publicacao: numeroRaw || undefined,
                title: inventionTitle || undefined,
                applicant: applicants || undefined,
                inventors: inventors || undefined,
                ipc_codes: ipcs || undefined,
                filing_date: filingDate || undefined,
                last_rpi: String(rpiNumber),
                last_event: dispatchCode || undefined,
                status: dispatchTitle || undefined
            },
            create: {
                cod_pedido: codPedido,
                numero_publicacao: numeroRaw || null,
                title: inventionTitle || null,
                applicant: applicants || null,
                inventors: inventors || null,
                ipc_codes: ipcs || null,
                filing_date: filingDate || null,
                last_rpi: String(rpiNumber),
                last_event: dispatchCode || null,
                status: dispatchTitle || null
            }
        });

        const publicationExists = await prisma.inpiPublication.findFirst({
            where: {
                patent_id: codPedido,
                rpi: String(rpiNumber),
                despacho_code: dispatchCode || null,
                despacho_desc: dispatchTitle || null,
                complement: complement || null
            },
            select: { id: true }
        });

        if (!publicationExists) {
            await prisma.inpiPublication.create({
                data: {
                    patent_id: codPedido,
                    rpi: String(rpiNumber),
                    date: dataPublicacao || null,
                    despacho_code: dispatchCode || null,
                    despacho_desc: dispatchTitle || null,
                    complement: complement || null
                }
            });
        }

        await queueDocumentJobForPatent({
            patentId: codPedido,
            rpiNumber,
            publicationNumber: numeroRaw,
            status: dispatchTitle,
            dispatchCode: dispatchCode
        });

        imported++;
    }
    return imported;
}

async function processNextRpiImportJob() {
    if (rpiRunning || rpiPaused) return;
    rpiRunning = true;
    try {
        let job = await prisma.rpiImportJob.findFirst({
            where: { status: 'pending' },
            orderBy: [{ rpi_number: 'desc' }, { created_at: 'asc' }]
        });
        if (!job) {
            job = await prisma.rpiImportJob.findFirst({
                where: {
                    status: 'failed',
                    attempts: { lt: MAX_RPI_ATTEMPTS }
                },
                orderBy: [{ attempts: 'asc' }, { updated_at: 'asc' }, { rpi_number: 'desc' }]
            });
        }
        if (!job) return;
        const rpiNumber = job.rpi_number;
        const nextAttempt = job.attempts + 1;
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `rpi-${rpiNumber}-`));
        const zipPath = path.join(tempDir, `P${rpiNumber}.zip`);
        try {
            await prisma.rpiImportJob.update({
                where: { id: job.id },
                data: {
                    status: 'running',
                    started_at: new Date(),
                    error: null,
                    attempts: { increment: 1 }
                }
            });
            const zipUrl = `${RPI_BASE_URL}/P${rpiNumber}.zip`;
            await downloadRpiZipWithRetry(zipUrl, zipPath, 5);
            const { xmlFileName, xmlContent } = await getXmlFromZip(zipPath);
            const imported = await processRpiXmlContent(rpiNumber, xmlContent);
            await prisma.rpiImportJob.update({
                where: { id: job.id },
                data: {
                    status: 'completed',
                    imported_count: imported,
                    source_url: zipUrl,
                    xml_file_name: xmlFileName,
                    finished_at: new Date()
                }
            });
        } catch (error: unknown) {
            const message = errorMessage(error, 'Erro ao processar RPI');
            const permanentByContent = message.toLowerCase().includes('não é zip válido');
            await prisma.rpiImportJob.update({
                where: { id: job.id },
                data: {
                    status: permanentByContent || nextAttempt >= MAX_RPI_ATTEMPTS ? 'failed_permanent' : 'failed',
                    error: truncateError(message),
                    finished_at: new Date()
                }
            });
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
    } finally {
        rpiRunning = false;
    }
}

async function recoverStaleRunningJobs() {
    const staleDate = getStaleDate();
    await prisma.rpiImportJob.updateMany({
        where: {
            status: 'running',
            OR: [
                { started_at: { lt: staleDate } },
                { started_at: null, updated_at: { lt: staleDate } }
            ]
        },
        data: {
            status: 'failed',
            finished_at: new Date(),
            error: `Job reiniciado automaticamente: execução travada por mais de ${STALE_JOB_MINUTES} minutos`
        }
    });
    await prisma.documentDownloadJob.updateMany({
        where: {
            status: 'running',
            OR: [
                { started_at: { lt: staleDate } },
                { started_at: null, updated_at: { lt: staleDate } }
            ]
        },
        data: {
            status: 'failed',
            finished_at: new Date(),
            error: `Job reiniciado automaticamente: execução travada por mais de ${STALE_JOB_MINUTES} minutos`
        }
    });
}

async function quarantineInvalidFutureRpiJobs() {
    const latest = await detectLatestRpiNumber();
    if (!latest) return;
    await prisma.rpiImportJob.updateMany({
        where: {
            rpi_number: { gt: latest + 2 },
            status: { in: ['pending', 'failed', 'running'] }
        },
        data: {
            status: 'failed_permanent',
            finished_at: new Date(),
            error: `RPI fora da janela atual detectada (${latest}). Job bloqueado automaticamente`
        }
    });
}

async function resolveDocdbId(publicationNumber: string): Promise<string | null> {
    const normalized = normalizePublicationNumber(publicationNumber);
    if (!normalized) return null;
    const compact = normalized.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const alphaPrefix = (compact.match(/^[A-Z]+/)?.[0] || '');
    const digitsOnly = compact.replace(/[^\d]/g, '');
    if (!digitsOnly) return null;
    const pnCandidates = new Set<string>();
    const apCandidates = new Set<string>();
    const addKinds = (base: string) => {
        if (!base) return;
        pnCandidates.add(`${base}A2`);
        pnCandidates.add(`${base}A8`);
        pnCandidates.add(`${base}B1`);
        pnCandidates.add(`${base}U2`);
        pnCandidates.add(`${base}A`);
    };

    if (alphaPrefix === 'BR') {
        const noCheckDigit = digitsOnly.length > 10 ? digitsOnly.slice(0, -1) : digitsOnly;
        const variants = Array.from(new Set([noCheckDigit, digitsOnly]));
        for (const variant of variants) {
            if (!variant) continue;
            addKinds(`BR${variant}`);
            apCandidates.add(variant);
            apCandidates.add(`BR${variant}`);
        }
    } else {
        const base7 = digitsOnly.length > 7 ? digitsOnly.slice(0, 7) : digitsOnly;
        const typePrefix = ['PI', 'MU', 'PP', 'DI'].includes(alphaPrefix) ? alphaPrefix : 'PI';
        addKinds(`BR${typePrefix}${base7}`);
        addKinds(`${typePrefix}${base7}`);
        apCandidates.add(`BR${typePrefix}${base7}`);
        apCandidates.add(`${typePrefix}${base7}`);
    }

    const queryCandidates = [
        ...Array.from(pnCandidates).map((pn) => `pn=${pn}`),
        ...Array.from(apCandidates).map((ap) => `ap=${ap}`)
    ];
    const token = await getOpsToken();
    for (const query of queryCandidates) {
        const url = `https://ops.epo.org/3.2/rest-services/published-data/search/biblio?q=${encodeURIComponent(query)}`;
        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/xml'
            },
            timeout: 40000,
            validateStatus: () => true
        });
        if (response.status === 404 || response.status === 400) continue;
        if (response.status < 200 || response.status >= 300) continue;
        const $ = cheerio.load(response.data, { xmlMode: true });
        const exchange = $('exchange-document').first();
        const country = normalizeText(exchange.attr('country') || '');
        const docNumber = normalizeText(exchange.attr('doc-number') || '');
        const kind = normalizeText(exchange.attr('kind') || '');
        if (!country || !docNumber || !kind) continue;
        return `${country}.${docNumber}.${kind}`;
    }
    return null;
}

type OpsDocumentInstance = {
    '@desc'?: string;
    '@link'?: string;
    '@number-of-pages'?: string;
};

async function fetchDocumentInstances(docdbId: string): Promise<OpsDocumentInstance[]> {
    const token = await getOpsToken();
    const response = await axios.get(
        `https://ops.epo.org/3.2/rest-services/published-data/publication/docdb/${docdbId}/images`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json'
            },
            timeout: 40000
        }
    );
    const instances = response.data?.['ops:world-patent-data']
        ?.['ops:document-inquiry']
        ?.['ops:inquiry-result']
        ?.['ops:document-instance'];
    if (!instances) return [];
    return (Array.isArray(instances) ? instances : [instances]) as OpsDocumentInstance[];
}

async function downloadOpsPdfByLink(link: string, pages: string): Promise<Buffer> {
    const token = await getOpsToken();
    const response = await axios.get(
        `https://ops.epo.org/3.2/rest-services/${link}?Range=${encodeURIComponent(pages)}`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/pdf'
            },
            responseType: 'arraybuffer',
            timeout: 60000
        }
    );
    return Buffer.from(response.data);
}

async function processNextDocumentJob() {
    if (docRunning || docsPaused) return;
    docRunning = true;
    try {
        let job = await prisma.documentDownloadJob.findFirst({
            where: { status: 'pending' },
            orderBy: [{ created_at: 'asc' }]
        });
        if (!job) {
            job = await prisma.documentDownloadJob.findFirst({
                where: {
                    status: 'failed',
                    attempts: { lt: MAX_DOC_ATTEMPTS }
                },
                orderBy: [{ attempts: 'asc' }, { updated_at: 'asc' }, { created_at: 'asc' }]
            });
        }
        if (!job) return;
        const nextAttempt = job.attempts + 1;
        await prisma.documentDownloadJob.update({
            where: { id: job.id },
            data: {
                status: 'running',
                started_at: new Date(),
                attempts: { increment: 1 },
                error: null
            }
        });
        try {
            const patent = await prisma.inpiPatent.findUnique({
                where: { cod_pedido: job.patent_id }
            });
            if (!patent) {
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: { status: 'not_found', error: 'Patente não encontrada na base', finished_at: new Date() }
                });
                return;
            }
            if (isSigiloStatus(patent.status || job.error || undefined)) {
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: { status: 'skipped_sigilo', error: 'Patente em sigilo', finished_at: new Date() }
                });
                return;
            }
            const publicationNumber = normalizeText(job.publication_number || patent.numero_publicacao || '');
            if (!publicationNumber) {
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: { status: 'not_found', error: 'Número de publicação ausente', finished_at: new Date() }
                });
                return;
            }
            const docdbId = await resolveDocdbId(publicationNumber);
            if (!docdbId) {
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: { status: 'not_found', error: `Sem documento no Espacenet para ${publicationNumber}`, finished_at: new Date() }
                });
                return;
            }
            const instances = await fetchDocumentInstances(docdbId);
            const fullDoc = instances.find((item) => item['@desc'] === 'FullDocument' && typeof item['@link'] === 'string');
            if (!fullDoc?.['@link']) {
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: { status: 'not_found', error: 'FullDocument não disponível no Espacenet', finished_at: new Date() }
                });
                return;
            }
            const fullPages = Math.max(1, Number(fullDoc['@number-of-pages'] || '1'));
            const fullPdf = await downloadOpsPdfByLink(fullDoc['@link'], `1-${fullPages}`);
            const safeBase = publicationNumber.replace(/[^\w.-]/g, '_');
            const baseKey = `patent-docs/${safeBase}`;
            const fullKey = `${baseKey}/full_document.pdf`;
            await uploadPdfToS3(fullKey, fullPdf);

            const drawing = instances.find((item) => item['@desc'] === 'Drawing' && typeof item['@link'] === 'string');
            if (drawing?.['@link']) {
                const pages = Math.max(1, Number(drawing['@number-of-pages'] || '1'));
                const pdf = await downloadOpsPdfByLink(drawing['@link'], `1-${pages}`);
                await uploadPdfToS3(`${baseKey}/drawings.pdf`, pdf);
            }
            const firstPage = instances.find((item) => item['@desc'] === 'FirstPageClipping' && typeof item['@link'] === 'string');
            if (firstPage?.['@link']) {
                const pdf = await downloadOpsPdfByLink(firstPage['@link'], '1');
                await uploadPdfToS3(`${baseKey}/first_page.pdf`, pdf);
            }

            await prisma.documentDownloadJob.update({
                where: { id: job.id },
                data: {
                    status: 'completed',
                    storage_key: fullKey,
                    finished_at: new Date(),
                    publication_number: publicationNumber
                }
            });
        } catch (error: unknown) {
            const message = truncateError(errorMessage(error, 'Erro ao baixar documento'));
            const lower = message.toLowerCase();
            const notFound = lower.includes('not found') || lower.includes('404') || lower.includes('não encontrado');
            await prisma.documentDownloadJob.update({
                where: { id: job.id },
                data: {
                    status: notFound ? 'not_found' : (nextAttempt >= MAX_DOC_ATTEMPTS ? 'failed_permanent' : 'failed'),
                    error: message,
                    finished_at: new Date()
                }
            });
        }
    } finally {
        docRunning = false;
    }
}

export function getBackgroundWorkerState() {
    return {
        rpiPaused,
        docsPaused,
        rpiRunning,
        docRunning
    };
}

export function setBackgroundWorkerPause(queue: 'rpi' | 'docs' | 'all', paused: boolean) {
    if (queue === 'all' || queue === 'rpi') rpiPaused = paused;
    if (queue === 'all' || queue === 'docs') docsPaused = paused;
    return getBackgroundWorkerState();
}

export async function retryRpiJob(jobId: string) {
    const updated = await prisma.rpiImportJob.update({
        where: { id: jobId },
        data: {
            status: 'pending',
            attempts: 0,
            error: null,
            started_at: null,
            finished_at: null
        }
    });
    processNextRpiImportJob().catch(() => undefined);
    return updated;
}

export async function retryDocumentJob(jobId: string) {
    const updated = await prisma.documentDownloadJob.update({
        where: { id: jobId },
        data: {
            status: 'pending',
            attempts: 0,
            error: null,
            started_at: null,
            finished_at: null
        }
    });
    processNextDocumentJob().catch(() => undefined);
    return updated;
}

export async function startBackgroundWorkers() {
    if (loopsStarted) return;
    loopsStarted = true;
    recoverStaleRunningJobs().catch(() => undefined);
    quarantineInvalidFutureRpiJobs().catch(() => undefined);
    enqueueLastFiveYearsRpi().catch(() => undefined);
    processNextRpiImportJob().catch(() => undefined);
    processNextDocumentJob().catch(() => undefined);
    setInterval(() => {
        processNextRpiImportJob().catch(() => undefined);
    }, 4000);
    setInterval(() => {
        processNextDocumentJob().catch(() => undefined);
    }, 3000);
    setInterval(() => {
        recoverStaleRunningJobs().catch(() => undefined);
    }, 60 * 1000);
    setInterval(() => {
        quarantineInvalidFutureRpiJobs().catch(() => undefined);
    }, 30 * 60 * 1000);
    setInterval(() => {
        enqueueLastFiveYearsRpi().catch(() => undefined);
    }, 6 * 60 * 60 * 1000);
}
