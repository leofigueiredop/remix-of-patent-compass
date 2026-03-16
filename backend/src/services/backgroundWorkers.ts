import axios from 'axios';
import * as cheerio from 'cheerio';
import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createSign } from 'crypto';
import { CreateBucketCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
const BIBLIO_ENRICHMENT_MODE = (process.env.BIBLIO_ENRICHMENT_MODE || 'xml_first').toLowerCase();
const OPS_MIN_INTERVAL_MS = Math.max(300, parseInt(process.env.OPS_MIN_INTERVAL_MS || '1400', 10));
const OPS_RETRY_MAX = Math.max(1, parseInt(process.env.OPS_RETRY_MAX || '4', 10));
const OPS_BREAKER_THRESHOLD = Math.max(2, parseInt(process.env.OPS_BREAKER_THRESHOLD || '6', 10));
const OPS_BREAKER_COOLDOWN_MS = Math.max(30_000, parseInt(process.env.OPS_BREAKER_COOLDOWN_MS || '180000', 10));
const OPS_INDEXING_GRACE_YEARS = Math.max(1, parseInt(process.env.OPS_INDEXING_GRACE_YEARS || '3', 10));
const GOOGLE_PATENTS_FALLBACK_ENABLED = (process.env.GOOGLE_PATENTS_FALLBACK_ENABLED || 'true').toLowerCase() === 'true';
const ESPACENET_UI_FALLBACK_ENABLED = (process.env.ESPACENET_UI_FALLBACK_ENABLED || 'false').toLowerCase() === 'true';
const INPI_SCRAPE_FALLBACK_ENABLED = (process.env.INPI_SCRAPE_FALLBACK_ENABLED || 'false').toLowerCase() === 'true';
const BIGQUERY_PROJECT_ID = process.env.BIGQUERY_PROJECT_ID || '';
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
const GOOGLE_SERVICE_ACCOUNT_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '';
const BIGQUERY_BILLING_PROJECT = process.env.BIGQUERY_BILLING_PROJECT || BIGQUERY_PROJECT_ID;
const BIGQUERY_ENABLED = Boolean(BIGQUERY_BILLING_PROJECT && (GOOGLE_SERVICE_ACCOUNT_JSON || GOOGLE_SERVICE_ACCOUNT_FILE));
const BIGQUERY_MAX_BYTES_BILLED = Math.max(10_000_000, parseInt(process.env.BIGQUERY_MAX_BYTES_BILLED || '50000000', 10));
const BIGQUERY_CACHE_TTL_HOURS = Math.max(1, parseInt(process.env.BIGQUERY_CACHE_TTL_HOURS || '720', 10));
const S3_ENDPOINT = process.env.S3_ENDPOINT || '';
const S3_REGION = process.env.S3_REGION || 'garage';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || '';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || '';
const S3_BUCKET = process.env.S3_BUCKET || 'patents';

let loopsStarted = false;
let rpiRunning = false;
let docRunning = false;
let opsRunning = false;
let rpiPaused = false;
let docsPaused = false;
let opsPaused = false;
let latestRpiCache: { value: number; expiresAt: number } | null = null;
let opsAccessToken: string | null = null;
let opsTokenExpiration = 0;
let s3BucketReady = false;
let lastOpsRequestAt = 0;
let opsThrottleFailureCount = 0;
let opsCircuitOpenUntil = 0;
let bigQueryAccessToken: string | null = null;
let bigQueryAccessTokenExpiration = 0;

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

function serializeUnknownError(error: unknown): string {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = normalizeText(error.response?.statusText || '');
        const responseBody = typeof error.response?.data === 'string'
            ? error.response?.data
            : JSON.stringify(error.response?.data || {});
        return truncateError(`axios message=${error.message} status=${status || 'na'} statusText=${statusText} body=${responseBody}`);
    }
    return truncateError(errorMessage(error, 'erro-desconhecido'));
}

function documentJobLog(entry: Record<string, unknown>) {
    const payload = JSON.stringify({
        ts: new Date().toISOString(),
        worker: 'document',
        ...entry
    });
    console.log(payload);
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

function parseRetryAfterMs(value?: string): number | null {
    if (!value) return null;
    const asNumber = Number.parseInt(value, 10);
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber * 1000;
    const asDate = new Date(value).getTime();
    if (Number.isFinite(asDate)) {
        const delta = asDate - Date.now();
        return delta > 0 ? delta : null;
    }
    return null;
}

async function waitOpsThrottle() {
    const elapsed = Date.now() - lastOpsRequestAt;
    const waitMs = OPS_MIN_INTERVAL_MS - elapsed;
    if (waitMs > 0) {
        await sleep(waitMs);
    }
}

async function waitOpsCircuitIfOpen() {
    const now = Date.now();
    if (opsCircuitOpenUntil > now) {
        await sleep(opsCircuitOpenUntil - now);
    }
}

function registerOpsThrottleFailure(status?: number) {
    if (status !== 429 && status !== 502 && status !== 503 && status !== 504) return;
    opsThrottleFailureCount += 1;
    if (opsThrottleFailureCount >= OPS_BREAKER_THRESHOLD) {
        opsCircuitOpenUntil = Date.now() + OPS_BREAKER_COOLDOWN_MS;
        opsThrottleFailureCount = 0;
        console.warn(JSON.stringify({
            ts: new Date().toISOString(),
            worker: 'ops',
            code: 'OPS_CIRCUIT_OPEN',
            cooldownMs: OPS_BREAKER_COOLDOWN_MS,
            until: new Date(opsCircuitOpenUntil).toISOString(),
            status
        }));
    }
}

function registerOpsSuccess() {
    opsThrottleFailureCount = 0;
}

async function opsGetWithThrottle<T = any>(url: string, config: any): Promise<T> {
    let attempt = 0;
    while (attempt < OPS_RETRY_MAX) {
        attempt += 1;
        await waitOpsCircuitIfOpen();
        await waitOpsThrottle();
        try {
            const response = await axios.get(url, config);
            lastOpsRequestAt = Date.now();
            registerOpsSuccess();
            return response as T;
        } catch (error: unknown) {
            lastOpsRequestAt = Date.now();
            if (!axios.isAxiosError(error)) throw error;
            const status = error.response?.status;
            registerOpsThrottleFailure(status);
            const retryAfterHeader = error.response?.headers?.['retry-after'];
            const retryAfterMs = parseRetryAfterMs(Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader);
            const shouldRetry = status === 429 || status === 503 || status === 502 || status === 504;
            if (!shouldRetry || attempt >= OPS_RETRY_MAX) throw error;
            const backoff = retryAfterMs || (OPS_MIN_INTERVAL_MS * (attempt + 1));
            await sleep(backoff);
        }
    }
    throw new Error('Falha OPS após retries');
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

function buildPatentNumberKey(value?: string): string {
    return normalizePublicationNumber(value).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function isDocumentEligibleDispatch(dispatchCode?: string): boolean {
    return shouldQueueDocumentByDispatchCode(dispatchCode);
}

function hasBasicBibliographicData(data: {
    title?: string;
    applicant?: string;
    inventor?: string;
    ipc?: string;
    filingDate?: string;
}) {
    return Boolean(
        normalizeText(data.title)
        || normalizeText(data.applicant)
        || normalizeText(data.inventor)
        || normalizeText(data.ipc)
        || normalizeText(data.filingDate)
    );
}

function extractBrazilPatentYear(value?: string): number | null {
    const compact = normalizePublicationNumber(value).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const match = compact.match(/^BR(10|11)(\d{4})/);
    if (!match) return null;
    const year = Number.parseInt(match[2], 10);
    return Number.isFinite(year) ? year : null;
}

function isRecentPatentForIndexing(value?: string): boolean {
    const year = extractBrazilPatentYear(value);
    if (!year) return false;
    const current = new Date().getUTCFullYear();
    return year >= (current - OPS_INDEXING_GRACE_YEARS + 1);
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

function base64UrlEncode(value: string): string {
    return Buffer.from(value)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function normalizePublicationForBigQuery(value?: string): string {
    return normalizeText(value).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function trimKindSuffix(value: string): string {
    return value.replace(/[A-Z]\d?$/, '');
}

function parsePublicationNumber(value?: string): ParsedPublicationNumber | null {
    const normalized = normalizePublicationForBigQuery(value);
    const match = normalized.match(/^([A-Z]{2})([0-9A-Z]+?)([A-Z]\d?)?$/);
    if (!match) return null;
    return {
        country: match[1],
        docNumber: match[2] || '',
        kindCode: match[3] || ''
    };
}

async function getGoogleServiceAccount(): Promise<{ client_email: string; private_key: string } | null> {
    const rawJson = GOOGLE_SERVICE_ACCOUNT_JSON
        ? GOOGLE_SERVICE_ACCOUNT_JSON
        : (GOOGLE_SERVICE_ACCOUNT_FILE
            ? await fs.readFile(GOOGLE_SERVICE_ACCOUNT_FILE, 'utf-8').catch(() => '')
            : '');
    if (!rawJson) return null;
    try {
        const parsed = JSON.parse(rawJson);
        const clientEmail = normalizeText(parsed?.client_email || '');
        const privateKey = String(parsed?.private_key || '').replace(/\\n/g, '\n');
        if (!clientEmail || !privateKey) return null;
        return { client_email: clientEmail, private_key: privateKey };
    } catch {
        return null;
    }
}

async function getBigQueryToken(): Promise<string | null> {
    if (!BIGQUERY_ENABLED) return null;
    if (bigQueryAccessToken && Date.now() < bigQueryAccessTokenExpiration) return bigQueryAccessToken;
    const serviceAccount = await getGoogleServiceAccount();
    if (!serviceAccount) return null;
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64UrlEncode(JSON.stringify({
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/bigquery',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    signer.end();
    const signature = signer.sign(serviceAccount.private_key, 'base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    const assertion = `${header}.${payload}.${signature}`;
    try {
        const tokenResponse = await axios.post(
            'https://oauth2.googleapis.com/token',
            new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion
            }).toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 20000
            }
        );
        const token = normalizeText(tokenResponse.data?.access_token || '');
        if (!token) return null;
        const expiresIn = Number.parseInt(String(tokenResponse.data?.expires_in || '3600'), 10);
        bigQueryAccessToken = token;
        bigQueryAccessTokenExpiration = Date.now() + (Math.max(300, expiresIn) * 1000) - 60000;
        return bigQueryAccessToken;
    } catch {
        return null;
    }
}

type BigQueryBibliographicData = {
    title?: string;
    abstract?: string;
    applicant?: string;
    inventors?: string;
    ipc?: string;
    filingDate?: string;
    publicationDate?: string;
    attorney?: string;
    googlePatentsUrl?: string;
};

type ParsedPublicationNumber = {
    country: string;
    docNumber: string;
    kindCode: string;
};

function pickFirstLocalizedText(value: any): string {
    if (Array.isArray(value)) {
        for (const item of value) {
            const text = normalizeText(item?.text || item?.value || item?.name || '');
            if (text) return text;
        }
    }
    return normalizeText(value?.text || value?.value || value?.name || '');
}

function joinEntityNames(value: any): string {
    if (!Array.isArray(value)) return '';
    return value
        .map((item) => normalizeText(item?.name || item?.value || item?.text || ''))
        .filter(Boolean)
        .join('; ');
}

function joinIpcCodes(value: any): string {
    if (!Array.isArray(value)) return '';
    return value
        .map((item) => normalizeText(item?.code || item?.value || item?.text || item || ''))
        .filter(Boolean)
        .join(', ');
}

function extractAttorneyFromBigQueryRow(row: any): string {
    const candidates = [
        row?.attorney_harmonized,
        row?.agent_harmonized,
        row?.representative_harmonized,
        row?.attorney,
        row?.agent,
        row?.representative
    ];
    for (const candidate of candidates) {
        const value = joinEntityNames(candidate) || normalizeText(candidate);
        if (value) return value;
    }
    return '';
}

async function fetchBigQueryBibliographicData(publicationNumber: string): Promise<BigQueryBibliographicData | null> {
    const token = await getBigQueryToken();
    if (!token || !BIGQUERY_BILLING_PROJECT) return null;
    const normalized = normalizePublicationForBigQuery(publicationNumber);
    if (!normalized) return null;
    const parsed = parsePublicationNumber(normalized);
    if (!parsed?.country || !parsed?.docNumber) return null;
    const cacheKey = normalized;
    const cached = await prisma.searchResultCache.findUnique({
        where: {
            source_publication_number: {
                source: 'google_bigquery',
                publication_number: cacheKey
            }
        }
    }).catch(() => null);
    if (cached && cached.updated_at) {
        const ageMs = Date.now() - new Date(cached.updated_at).getTime();
        if (ageMs <= BIGQUERY_CACHE_TTL_HOURS * 60 * 60 * 1000) {
            return {
                title: cached.title || undefined,
                abstract: cached.abstract || undefined,
                applicant: cached.applicant || undefined,
                inventors: cached.inventor || undefined,
                ipc: cached.classification || undefined,
                filingDate: cached.patent_date || undefined,
                publicationDate: cached.patent_date || undefined,
                googlePatentsUrl: cached.url || `https://patents.google.com/patent/${cacheKey}/en`
            };
        }
    }
    const noKind = trimKindSuffix(normalized);
    const docNoLeadingZeros = parsed.docNumber.replace(/^0+/, '') || parsed.docNumber;
    const query = `
      SELECT
        title_localized,
        abstract_localized,
        assignee_harmonized,
        inventor_harmonized,
        ipc,
        filing_date,
        publication_date,
        country_code,
        publication_number,
        kind_code
      FROM \`patents-public-data.patents.publications\` t
      WHERE UPPER(IFNULL(t.country_code, '')) = @country
        AND (
          REGEXP_REPLACE(UPPER(IFNULL(t.publication_number, '')), r'[^0-9A-Z]', '') = @docNumber
          OR REGEXP_REPLACE(UPPER(IFNULL(t.publication_number, '')), r'[^0-9A-Z]', '') = @docNumberNoLeadingZeros
        )
        AND (
          @kindCode = ''
          OR UPPER(IFNULL(t.kind_code, '')) = @kindCode
        )
      LIMIT 1
    `;
    try {
        const response = await axios.post(
            `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(BIGQUERY_BILLING_PROJECT)}/queries`,
            {
                query,
                useLegacySql: false,
                parameterMode: 'NAMED',
                maximumBytesBilled: String(BIGQUERY_MAX_BYTES_BILLED),
                useQueryCache: true,
                queryParameters: [
                    { name: 'country', parameterType: { type: 'STRING' }, parameterValue: { value: parsed.country } },
                    { name: 'docNumber', parameterType: { type: 'STRING' }, parameterValue: { value: parsed.docNumber } },
                    { name: 'docNumberNoLeadingZeros', parameterType: { type: 'STRING' }, parameterValue: { value: docNoLeadingZeros } },
                    { name: 'kindCode', parameterType: { type: 'STRING' }, parameterValue: { value: parsed.kindCode } }
                ]
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );
        const schemaFields = response.data?.schema?.fields || [];
        const rowFields = response.data?.rows?.[0]?.f || [];
        if (!schemaFields.length || !rowFields.length) return null;
        const rowJson: Record<string, any> = {};
        for (let i = 0; i < schemaFields.length; i++) {
            rowJson[schemaFields[i]?.name] = rowFields[i]?.v;
        }
        const title = pickFirstLocalizedText(rowJson.title_localized);
        const abstract = pickFirstLocalizedText(rowJson.abstract_localized);
        const applicant = joinEntityNames(rowJson.assignee_harmonized);
        const inventors = joinEntityNames(rowJson.inventor_harmonized);
        const ipc = joinIpcCodes(rowJson.ipc);
        const filingDate = normalizeText(rowJson.filing_date || '');
        const publicationDate = normalizeText(rowJson.publication_date || '');
        const attorney = extractAttorneyFromBigQueryRow(rowJson);
        const result = {
            title: title || undefined,
            abstract: abstract || undefined,
            applicant: applicant || undefined,
            inventors: inventors || undefined,
            ipc: ipc || undefined,
            filingDate: filingDate || undefined,
            publicationDate: publicationDate || undefined,
            attorney: attorney || undefined,
            googlePatentsUrl: normalized ? `https://patents.google.com/patent/${normalized}/en` : undefined
        };
        await prisma.searchResultCache.upsert({
            where: {
                source_publication_number: {
                    source: 'google_bigquery',
                    publication_number: cacheKey
                }
            },
            update: {
                title: result.title || null,
                abstract: result.abstract || null,
                applicant: result.applicant || null,
                inventor: result.inventors || null,
                patent_date: result.publicationDate || result.filingDate || null,
                classification: result.ipc || null,
                url: result.googlePatentsUrl || null,
                status: 'completed'
            },
            create: {
                source: 'google_bigquery',
                publication_number: cacheKey,
                title: result.title || null,
                abstract: result.abstract || null,
                applicant: result.applicant || null,
                inventor: result.inventors || null,
                patent_date: result.publicationDate || result.filingDate || null,
                classification: result.ipc || null,
                url: result.googlePatentsUrl || null,
                status: 'completed'
            }
        }).catch(() => undefined);
        return result;
    } catch {
        return null;
    }
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

async function objectExistsInS3(key: string): Promise<boolean> {
    const s3 = getS3Client();
    await ensureS3Bucket();
    try {
        await s3.send(new HeadObjectCommand({
            Bucket: S3_BUCKET,
            Key: key
        }));
        return true;
    } catch {
        return false;
    }
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

async function queueOpsBibliographicJob(params: {
    patentNumber: string;
    rpiNumber: number;
}) {
    if (!params.patentNumber) return;
    await prisma.opsBibliographicJob.upsert({
        where: { patent_number: params.patentNumber },
        update: {
            status: 'pending',
            error: null,
            finished_at: null,
            rpi_number: params.rpiNumber
        },
        create: {
            patent_number: params.patentNumber,
            rpi_number: params.rpiNumber,
            status: 'pending'
        }
    });
}

async function processRpiXmlContent(rpiNumber: number, xmlContent: string): Promise<number> {
    const $ = cheerio.load(xmlContent, { xmlMode: true });
    const revista = $('revista').first();
    const dataPublicacao = revista.attr('dataPublicacao') || revista.attr('data-publicacao') || '';
    const despachoNodes = revista.find('despacho').toArray();
    const bqCache = new Map<string, BigQueryBibliographicData | null>();
    let imported = 0;

    for (const node of despachoNodes) {
        const despacho = $(node);
        const processo = despacho.find('processo-patente').first();
        if (!processo.length) continue;
        const numeroRaw = nodeText(processo, 'numero');
        const numeroPublicacao = normalizePublicationNumber(numeroRaw);
        const codPedidoFromNumero = extractDigits(numeroRaw);
        if (!numeroPublicacao && !codPedidoFromNumero) continue;
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

        const patentNumber = buildPatentNumberKey(numeroPublicacao || numeroRaw || codPedidoFromNumero);
        if (!patentNumber) continue;
        const bqData = bqCache.has(patentNumber)
            ? bqCache.get(patentNumber) || null
            : await fetchBigQueryBibliographicData(numeroPublicacao || patentNumber);
        if (!bqCache.has(patentNumber)) bqCache.set(patentNumber, bqData);
        const isDocumentEligible = isDocumentEligibleDispatch(dispatchCode);
        const hasXmlBiblio = hasBasicBibliographicData({
            title: inventionTitle || dispatchTitle,
            applicant: applicants,
            inventor: inventors,
            ipc: ipcs,
            filingDate
        });
        const hasBigQueryBiblio = hasBasicBibliographicData({
            title: bqData?.title,
            applicant: bqData?.applicant,
            inventor: bqData?.inventors,
            ipc: bqData?.ipc,
            filingDate: bqData?.filingDate
        });
        const shouldQueueOpsBiblio = !isDocumentEligible
            && !hasXmlBiblio
            && !hasBigQueryBiblio
            && BIBLIO_ENRICHMENT_MODE !== 'xml_only';
        const existingPatent = await prisma.inpiPatent.findFirst({
            where: {
                OR: [
                    { cod_pedido: patentNumber },
                    codPedidoFromNumero ? { cod_pedido: codPedidoFromNumero } : undefined,
                    numeroPublicacao ? { numero_publicacao: numeroPublicacao } : undefined,
                    numeroRaw ? { numero_publicacao: numeroRaw } : undefined
                ].filter(Boolean) as any[]
            },
            select: { cod_pedido: true }
        });

        let patentId: string | null = existingPatent?.cod_pedido || null;
        if (isDocumentEligible) {
            patentId = patentId || patentNumber || codPedidoFromNumero;
            if (!patentId) continue;
            await prisma.inpiPatent.upsert({
                where: { cod_pedido: patentId },
                update: {
                    numero_publicacao: numeroPublicacao || numeroRaw || patentNumber,
                    title: bqData?.title || inventionTitle || dispatchTitle || undefined,
                    abstract: bqData?.abstract || undefined,
                    applicant: bqData?.applicant || applicants || undefined,
                    inventors: bqData?.inventors || inventors || undefined,
                    ipc_codes: bqData?.ipc || ipcs || undefined,
                    filing_date: bqData?.filingDate || filingDate || undefined,
                    last_rpi: String(rpiNumber),
                    last_event: dispatchCode || undefined,
                    status: dispatchTitle || undefined
                },
                create: {
                    cod_pedido: patentId,
                    numero_publicacao: numeroPublicacao || numeroRaw || patentNumber,
                    title: bqData?.title || inventionTitle || dispatchTitle || null,
                    abstract: bqData?.abstract || null,
                    applicant: bqData?.applicant || applicants || null,
                    inventors: bqData?.inventors || inventors || null,
                    ipc_codes: bqData?.ipc || ipcs || null,
                    filing_date: bqData?.filingDate || filingDate || null,
                    last_rpi: String(rpiNumber),
                    last_event: dispatchCode || null,
                    status: dispatchTitle || null
                }
            });
            await prisma.inpiPublication.updateMany({
                where: {
                    patent_number: patentNumber,
                    patent_id: null
                },
                data: {
                    patent_id: patentId
                }
            });
        } else if (patentId) {
            await prisma.inpiPatent.update({
                where: { cod_pedido: patentId },
                data: {
                    title: bqData?.title || undefined,
                    abstract: bqData?.abstract || undefined,
                    applicant: bqData?.applicant || applicants || undefined,
                    inventors: bqData?.inventors || inventors || undefined,
                    ipc_codes: bqData?.ipc || ipcs || undefined,
                    filing_date: bqData?.filingDate || filingDate || undefined,
                    last_rpi: String(rpiNumber),
                    last_event: dispatchCode || undefined,
                    status: dispatchTitle || undefined
                }
            }).catch(() => undefined);
        }

        const publicationExists = await prisma.inpiPublication.findFirst({
            where: {
                patent_number: patentNumber,
                rpi: String(rpiNumber),
                despacho_code: dispatchCode || null,
                despacho_desc: dispatchTitle || null,
                complement: complement || null
            },
            select: { id: true, patent_id: true }
        });

        if (!publicationExists) {
            await prisma.inpiPublication.create({
                data: {
                    patent_id: patentId,
                    patent_number: patentNumber,
                    rpi: String(rpiNumber),
                    date: dataPublicacao || null,
                    despacho_code: dispatchCode || null,
                    despacho_desc: dispatchTitle || null,
                    complement: complement || null,
                    eligible_for_doc_download: isDocumentEligible,
                    bibliographic_status: isDocumentEligible ? 'queued_document' : ((hasXmlBiblio || hasBigQueryBiblio) ? 'completed' : 'pending'),
                    ops_title: bqData?.title || inventionTitle || dispatchTitle || null,
                    ops_applicant: bqData?.applicant || applicants || null,
                    ops_inventor: bqData?.inventors || inventors || null,
                    ops_ipc: bqData?.ipc || ipcs || null,
                    ops_publication_date: bqData?.publicationDate || bqData?.filingDate || filingDate || null,
                    ops_error: bqData ? `source=bigquery${bqData.attorney ? ` attorney=${bqData.attorney}` : ''}` : null,
                    ops_last_sync_at: (hasXmlBiblio || hasBigQueryBiblio) ? new Date() : null
                }
            });
        } else if (patentId && !publicationExists.patent_id) {
            await prisma.inpiPublication.update({
                where: { id: publicationExists.id },
                data: { patent_id: patentId }
            });
        } else if (hasXmlBiblio || hasBigQueryBiblio) {
            await prisma.inpiPublication.update({
                where: { id: publicationExists.id },
                data: {
                    bibliographic_status: 'completed',
                    ops_title: bqData?.title || inventionTitle || dispatchTitle || undefined,
                    ops_applicant: bqData?.applicant || applicants || undefined,
                    ops_inventor: bqData?.inventors || inventors || undefined,
                    ops_ipc: bqData?.ipc || ipcs || undefined,
                    ops_publication_date: bqData?.publicationDate || bqData?.filingDate || filingDate || undefined,
                    ops_error: bqData ? `source=bigquery${bqData.attorney ? ` attorney=${bqData.attorney}` : ''}` : undefined,
                    ops_last_sync_at: new Date()
                }
            }).catch(() => undefined);
        }

        if (isDocumentEligible && patentId) {
            await queueDocumentJobForPatent({
                patentId,
                rpiNumber,
                publicationNumber: numeroPublicacao || numeroRaw || patentNumber,
                status: dispatchTitle,
                dispatchCode: dispatchCode
            });
        } else if (shouldQueueOpsBiblio) {
            await queueOpsBibliographicJob({
                patentNumber,
                rpiNumber
            });
        }

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
    await prisma.opsBibliographicJob.updateMany({
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
        pnCandidates.add(base);
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
        const response = await opsGetWithThrottle(url, {
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

async function resolveExistingStorageKey(candidates: Array<string | undefined | null>): Promise<string | null> {
    const seen = new Set<string>();
    for (const raw of candidates) {
        const normalized = normalizeText(raw || '');
        if (!normalized) continue;
        const safeBase = normalized.replace(/[^\w.-]/g, '_');
        if (!safeBase || seen.has(safeBase)) continue;
        seen.add(safeBase);
        const key = `patent-docs/${safeBase}/full_document.pdf`;
        if (await objectExistsInS3(key)) {
            return key;
        }
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
    const response = await opsGetWithThrottle(
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
    const response = await opsGetWithThrottle(
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

type OpsBibliographicData = {
    docdbId: string;
    title?: string;
    applicant?: string;
    inventor?: string;
    ipc?: string;
    publicationDate?: string;
    source?: string;
};

function extractGooglePatentNumberCandidate(patentNumber: string): string {
    return normalizePublicationNumber(patentNumber).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

async function fetchGooglePatentsBibliographicData(patentNumber: string): Promise<OpsBibliographicData | null> {
    if (!GOOGLE_PATENTS_FALLBACK_ENABLED) return null;
    const candidate = extractGooglePatentNumberCandidate(patentNumber);
    if (!candidate) return null;
    const url = `https://patents.google.com/patent/${candidate}/en`;
    const response = await axios.get(url, {
        timeout: 30000,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
        }
    });
    if (response.status < 200 || response.status >= 300) return null;
    const html = typeof response.data === 'string' ? response.data : '';
    if (!html || /security verification|just a moment/i.test(html)) return null;
    const $ = cheerio.load(html);
    const title = normalizeText($('meta[name="DC.title"]').attr('content') || $('title').text());
    const applicant = normalizeText($('meta[scheme="assignee"]').attr('content') || $('dd[itemprop="assigneeOriginal"] span[itemprop="name"]').first().text());
    const inventor = normalizeText($('meta[scheme="inventor"]').attr('content') || $('dd[itemprop="inventor"] span[itemprop="name"]').first().text());
    const publicationDate = normalizeText($('meta[scheme="publication-date"]').attr('content') || $('time[itemprop="publicationDate"]').attr('datetime') || '');
    const ipc = $('span[itemprop="Code"], td[itemprop="Code"]')
        .toArray()
        .map((el) => normalizeText($(el).text()))
        .filter(Boolean)
        .slice(0, 20)
        .join(', ');
    if (!title && !applicant && !inventor && !ipc) return null;
    return {
        docdbId: candidate,
        title: title || undefined,
        applicant: applicant || undefined,
        inventor: inventor || undefined,
        ipc: ipc || undefined,
        publicationDate: publicationDate || undefined,
        source: 'google_patents'
    };
}

async function fetchEspacenetUiBibliographicData(patentNumber: string): Promise<OpsBibliographicData | null> {
    if (!ESPACENET_UI_FALLBACK_ENABLED) return null;
    const candidate = extractGooglePatentNumberCandidate(patentNumber);
    if (!candidate) return null;
    const url = `https://worldwide.espacenet.com/patent/search/publication/${candidate}`;
    const response = await axios.get(url, { timeout: 30000, validateStatus: () => true });
    if (response.status < 200 || response.status >= 300) return null;
    const html = typeof response.data === 'string' ? response.data : '';
    if (!html || /security verification|just a moment|performing security verification/i.test(html)) return null;
    const $ = cheerio.load(html);
    const title = normalizeText($('meta[property="og:title"]').attr('content') || $('title').text());
    if (!title) return null;
    return {
        docdbId: candidate,
        title,
        source: 'espacenet_ui'
    };
}

async function fetchInpiScrapeBibliographicData(patentNumber: string): Promise<OpsBibliographicData | null> {
    if (!INPI_SCRAPE_FALLBACK_ENABLED) return null;
    const digits = extractDigits(patentNumber);
    if (!digits) return null;
    const codPedido = digits.length > 12 ? digits.slice(0, 12) : digits;
    try {
        const module = await import('./inpiScraper');
        if (!module?.scrapeInpiPatent) return null;
        await module.scrapeInpiPatent(codPedido);
        const scraped = await prisma.inpiPatent.findUnique({
            where: { cod_pedido: codPedido },
            select: {
                title: true,
                applicant: true,
                inventors: true,
                ipc_codes: true,
                filing_date: true
            }
        });
        if (!scraped) return null;
        if (!scraped.title && !scraped.applicant && !scraped.inventors && !scraped.ipc_codes) return null;
        return {
            docdbId: codPedido,
            title: scraped.title || undefined,
            applicant: scraped.applicant || undefined,
            inventor: scraped.inventors || undefined,
            ipc: scraped.ipc_codes || undefined,
            publicationDate: scraped.filing_date || undefined,
            source: 'inpi_scrape'
        };
    } catch {
        return null;
    }
}

async function fetchOpsBibliographicData(patentNumber: string): Promise<OpsBibliographicData | null> {
    const docdbId = await resolveDocdbId(patentNumber);
    if (!docdbId) return null;
    const token = await getOpsToken();
    const response = await opsGetWithThrottle(
        `https://ops.epo.org/3.2/rest-services/published-data/publication/docdb/${docdbId}/biblio`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/xml'
            },
            timeout: 40000
        }
    );
    const $ = cheerio.load(response.data, { xmlMode: true });
    const exchange = $('exchange-document').first();
    const title = normalizeText($('invention-title').first().text());
    const applicants = $('applicants applicant app-name name')
        .toArray()
        .map((el) => normalizeText($(el).text()))
        .filter(Boolean)
        .join('; ');
    const inventors = $('inventors inventor inventor-name name')
        .toArray()
        .map((el) => normalizeText($(el).text()))
        .filter(Boolean)
        .join('; ');
    const ipcs = $('classification-ipcr text')
        .toArray()
        .map((el) => normalizeText($(el).text()))
        .filter(Boolean)
        .join(', ');
    const publicationDate = normalizeText(exchange.attr('date-publ') || '');
    return {
        docdbId,
        title: title || undefined,
        applicant: applicants || undefined,
        inventor: inventors || undefined,
        ipc: ipcs || undefined,
        publicationDate: publicationDate || undefined,
        source: 'ops_api'
    };
}

async function fetchBibliographicDataWithFallbacks(patentNumber: string): Promise<OpsBibliographicData | null> {
    const fromOps = await fetchOpsBibliographicData(patentNumber);
    if (fromOps) return fromOps;
    const fromGoogle = await fetchGooglePatentsBibliographicData(patentNumber);
    if (fromGoogle) return fromGoogle;
    const fromEspacenetUi = await fetchEspacenetUiBibliographicData(patentNumber);
    if (fromEspacenetUi) return fromEspacenetUi;
    const fromInpiScrape = await fetchInpiScrapeBibliographicData(patentNumber);
    if (fromInpiScrape) return fromInpiScrape;
    return null;
}

async function processNextOpsBibliographicJob() {
    if (opsRunning || opsPaused) return;
    opsRunning = true;
    try {
        let job = await prisma.opsBibliographicJob.findFirst({
            where: { status: 'pending' },
            orderBy: [{ created_at: 'asc' }]
        });
        if (!job) {
            job = await prisma.opsBibliographicJob.findFirst({
                where: {
                    status: 'failed',
                    attempts: { lt: MAX_DOC_ATTEMPTS }
                },
                orderBy: [{ attempts: 'asc' }, { updated_at: 'asc' }, { created_at: 'asc' }]
            });
        }
        if (!job) return;
        const nextAttempt = job.attempts + 1;
        await prisma.opsBibliographicJob.update({
            where: { id: job.id },
            data: {
                status: 'running',
                started_at: new Date(),
                attempts: { increment: 1 },
                error: null
            }
        });

        try {
            const biblio = await fetchBibliographicDataWithFallbacks(job.patent_number);
            if (!biblio) {
                const recentIndexing = isRecentPatentForIndexing(job.patent_number);
                const status = recentIndexing ? 'waiting_indexing' : 'not_found';
                const biblioStatus = recentIndexing ? 'pending' : 'not_found';
                const errorText = recentIndexing
                    ? `Dados bibliográficos ainda não indexados nas fontes para ${job.patent_number}`
                    : `Dados bibliográficos não encontrados nas fontes para ${job.patent_number}`;
                await prisma.opsBibliographicJob.update({
                    where: { id: job.id },
                    data: {
                        status,
                        error: errorText,
                        finished_at: new Date()
                    }
                });
                await prisma.inpiPublication.updateMany({
                    where: { patent_number: job.patent_number },
                    data: {
                        bibliographic_status: biblioStatus,
                        ops_error: errorText,
                        ops_last_sync_at: new Date()
                    }
                });
                return;
            }

            await prisma.inpiPublication.updateMany({
                where: { patent_number: job.patent_number },
                data: {
                    bibliographic_status: 'completed',
                    ops_docdb_id: biblio.docdbId,
                    ops_title: biblio.title || null,
                    ops_applicant: biblio.applicant || null,
                    ops_inventor: biblio.inventor || null,
                    ops_ipc: biblio.ipc || null,
                    ops_publication_date: biblio.publicationDate || null,
                    ops_error: biblio.source ? `source=${biblio.source}` : null,
                    ops_last_sync_at: new Date()
                }
            });

            const linkedPatent = await prisma.inpiPatent.findFirst({
                where: {
                    OR: [
                        { numero_publicacao: { contains: job.patent_number, mode: 'insensitive' } },
                        { cod_pedido: job.patent_number }
                    ]
                }
            });
            if (linkedPatent) {
                await prisma.inpiPatent.update({
                    where: { cod_pedido: linkedPatent.cod_pedido },
                    data: {
                        title: linkedPatent.title || biblio.title || undefined,
                        applicant: linkedPatent.applicant || biblio.applicant || undefined,
                        inventors: linkedPatent.inventors || biblio.inventor || undefined,
                        ipc_codes: linkedPatent.ipc_codes || biblio.ipc || undefined
                    }
                });
            }

            await prisma.opsBibliographicJob.update({
                where: { id: job.id },
                data: {
                    status: 'completed',
                    docdb_id: biblio.docdbId,
                    finished_at: new Date()
                }
            });
        } catch (error: unknown) {
            const message = truncateError(errorMessage(error, 'Erro ao consultar bibliografia no OPS'));
            await prisma.opsBibliographicJob.update({
                where: { id: job.id },
                data: {
                    status: nextAttempt >= MAX_DOC_ATTEMPTS ? 'failed_permanent' : 'failed',
                    error: message,
                    finished_at: new Date()
                }
            });
            await prisma.inpiPublication.updateMany({
                where: { patent_number: job.patent_number },
                data: {
                    bibliographic_status: 'failed',
                    ops_error: message,
                    ops_last_sync_at: new Date()
                }
            });
        }
    } finally {
        opsRunning = false;
    }
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
                const errorText = 'DOC_PATENT_NOT_FOUND';
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: { status: 'not_found', error: errorText, finished_at: new Date() }
                });
                documentJobLog({ jobId: job.id, patentId: job.patent_id, status: 'not_found', code: errorText });
                return;
            }
            if (isSigiloStatus(patent.status || job.error || undefined)) {
                const errorText = 'DOC_SKIPPED_SIGILO';
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: { status: 'skipped_sigilo', error: errorText, finished_at: new Date() }
                });
                documentJobLog({ jobId: job.id, patentId: job.patent_id, publicationNumber: patent.numero_publicacao, status: 'skipped_sigilo', code: errorText });
                return;
            }
            const publicationNumber = normalizeText(job.publication_number || patent.numero_publicacao || '');
            if (!publicationNumber) {
                const errorText = 'DOC_PUBLICATION_NUMBER_MISSING';
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: { status: 'not_found', error: errorText, finished_at: new Date() }
                });
                documentJobLog({ jobId: job.id, patentId: job.patent_id, status: 'not_found', code: errorText });
                return;
            }
            const existingStorageKey = await resolveExistingStorageKey([
                job.publication_number,
                patent.numero_publicacao,
                patent.cod_pedido,
                publicationNumber
            ]);
            if (existingStorageKey) {
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: {
                        status: 'completed',
                        storage_key: existingStorageKey,
                        finished_at: new Date(),
                        publication_number: publicationNumber
                    }
                });
                documentJobLog({
                    jobId: job.id,
                    patentId: job.patent_id,
                    publicationNumber,
                    status: 'completed',
                    code: 'DOC_BUCKET_RECOVERED',
                    storageKey: existingStorageKey
                });
                return;
            }
            const docdbId = await resolveDocdbId(publicationNumber);
            if (!docdbId) {
                const recentIndexing = isRecentPatentForIndexing(publicationNumber);
                const status = recentIndexing ? 'waiting_indexing' : 'not_found';
                const code = recentIndexing ? 'DOC_DOCDB_PENDING_INDEX' : 'DOC_DOCDB_NOT_FOUND';
                const errorText = `${code} publication=${publicationNumber}`;
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: { status, error: truncateError(errorText), finished_at: new Date() }
                });
                documentJobLog({ jobId: job.id, patentId: job.patent_id, publicationNumber, status, code });
                return;
            }
            const instances = await fetchDocumentInstances(docdbId);
            const fullDoc = instances.find((item) => item['@desc'] === 'FullDocument' && typeof item['@link'] === 'string');
            if (!fullDoc?.['@link']) {
                const errorText = `DOC_FULLDOCUMENT_NOT_AVAILABLE docdb=${docdbId}`;
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: { status: 'not_found', error: truncateError(errorText), finished_at: new Date() }
                });
                documentJobLog({ jobId: job.id, patentId: job.patent_id, publicationNumber, docdbId, status: 'not_found', code: 'DOC_FULLDOCUMENT_NOT_AVAILABLE' });
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
            documentJobLog({ jobId: job.id, patentId: job.patent_id, publicationNumber, docdbId, status: 'completed', code: 'DOC_DOWNLOADED' });
        } catch (error: unknown) {
            const raw = serializeUnknownError(error);
            const message = truncateError(`DOC_RUNTIME_ERROR ${raw}`);
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
            documentJobLog({
                jobId: job.id,
                patentId: job.patent_id,
                status: notFound ? 'not_found' : (nextAttempt >= MAX_DOC_ATTEMPTS ? 'failed_permanent' : 'failed'),
                code: notFound ? 'DOC_RUNTIME_NOT_FOUND' : 'DOC_RUNTIME_FAILURE',
                detail: raw
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
        opsPaused,
        rpiRunning,
        docRunning,
        opsRunning,
        opsCircuitOpen: opsCircuitOpenUntil > Date.now(),
        opsCircuitOpenUntil: opsCircuitOpenUntil > Date.now() ? new Date(opsCircuitOpenUntil).toISOString() : null
    };
}

export function setBackgroundWorkerPause(queue: 'rpi' | 'docs' | 'ops' | 'all', paused: boolean) {
    if (queue === 'all' || queue === 'rpi') rpiPaused = paused;
    if (queue === 'all' || queue === 'docs') docsPaused = paused;
    if (queue === 'all' || queue === 'ops') opsPaused = paused;
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

export async function retryOpsBibliographicJob(jobId: string) {
    const updated = await prisma.opsBibliographicJob.update({
        where: { id: jobId },
        data: {
            status: 'pending',
            attempts: 0,
            error: null,
            started_at: null,
            finished_at: null
        }
    });
    processNextOpsBibliographicJob().catch(() => undefined);
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
    processNextOpsBibliographicJob().catch(() => undefined);
    setInterval(() => {
        processNextRpiImportJob().catch(() => undefined);
    }, 4000);
    setInterval(() => {
        processNextDocumentJob().catch(() => undefined);
    }, 3000);
    setInterval(() => {
        processNextOpsBibliographicJob().catch(() => undefined);
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
