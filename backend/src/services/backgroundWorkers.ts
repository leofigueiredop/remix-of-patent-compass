import axios from 'axios';
import * as cheerio from 'cheerio';
import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createSign, randomUUID } from 'crypto';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { prisma } from '../db';

if (typeof (process as any).loadEnvFile === 'function') {
    try {
        (process as any).loadEnvFile(path.resolve(process.cwd(), '.env'));
    } catch (_) {
    }
}

const prismaAny = prisma as any;

const execAsync = promisify(exec);
const RPI_BASE_URL = 'https://revistas.inpi.gov.br/txt';
const RPI_LOOKBACK_ISSUES = Math.max(26, parseInt(process.env.RPI_LOOKBACK_ISSUES || '260', 10));
const RPI_SCAN_MAX = Math.max(2000, parseInt(process.env.RPI_SCAN_MAX || '4000', 10));
const RPI_SCAN_MIN = Math.max(1, parseInt(process.env.RPI_SCAN_MIN || '2000', 10));
const RPI_FORCE_LATEST = parseInt(process.env.RPI_FORCE_LATEST || '0', 10);
const RPI_PROCESS_ORDER: 'asc' | 'desc' = (process.env.RPI_PROCESS_ORDER || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
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
const INPI_CREDENTIALS_PRESENT = Boolean((process.env.INPI_USER || '').trim() && (process.env.INPI_PASSWORD || '').trim());
const INPI_SCRAPE_FALLBACK_ENABLED = (process.env.INPI_SCRAPE_FALLBACK_ENABLED || (INPI_CREDENTIALS_PRESENT ? 'true' : 'false')).toLowerCase() === 'true';
const INPI_SCRAPE_FIRST_ENABLED = (process.env.INPI_SCRAPE_FIRST_ENABLED || 'true').toLowerCase() === 'true';
const BIGQUERY_PROJECT_ID = process.env.BIGQUERY_PROJECT_ID || '';
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
const GOOGLE_SERVICE_ACCOUNT_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '';
const BIGQUERY_BILLING_PROJECT = process.env.BIGQUERY_BILLING_PROJECT || BIGQUERY_PROJECT_ID;
const BIGQUERY_ENABLED = Boolean(BIGQUERY_BILLING_PROJECT && (GOOGLE_SERVICE_ACCOUNT_JSON || GOOGLE_SERVICE_ACCOUNT_FILE));
const BIGQUERY_FIRST_ENABLED = (process.env.BIGQUERY_FIRST_ENABLED || 'false').toLowerCase() === 'true';
const GOOGLE_PATENTS_ONLY_ENABLED = true;
const BIGQUERY_MAX_BYTES_BILLED = Math.max(10_000_000, parseInt(process.env.BIGQUERY_MAX_BYTES_BILLED || '500000000', 10));
const BIGQUERY_CACHE_TTL_HOURS = Math.max(1, parseInt(process.env.BIGQUERY_CACHE_TTL_HOURS || '720', 10));
const GOOGLE_PATENTS_MIN_INTERVAL_MS = Math.max(350, parseInt(process.env.GOOGLE_PATENTS_MIN_INTERVAL_MS || '1200', 10));
const GOOGLE_PATENTS_JITTER_MS = Math.max(50, parseInt(process.env.GOOGLE_PATENTS_JITTER_MS || '450', 10));
const GOOGLE_PATENTS_RETRY_MAX = Math.max(1, parseInt(process.env.GOOGLE_PATENTS_RETRY_MAX || '3', 10));
const GOOGLE_PATENTS_BREAKER_THRESHOLD = Math.max(2, parseInt(process.env.GOOGLE_PATENTS_BREAKER_THRESHOLD || '8', 10));
const GOOGLE_PATENTS_BREAKER_COOLDOWN_MS = Math.max(30_000, parseInt(process.env.GOOGLE_PATENTS_BREAKER_COOLDOWN_MS || '120000', 10));
const MIN_FULL_DOCUMENT_PAGES = Math.max(2, parseInt(process.env.MIN_FULL_DOCUMENT_PAGES || '2', 10));
const INPI_JOB_MIN_INTERVAL_MS = Math.max(5_000, parseInt(process.env.INPI_JOB_MIN_INTERVAL_MS || '12000', 10));
const INPI_JOB_DELAY_JITTER_MS = Math.max(500, parseInt(process.env.INPI_JOB_DELAY_JITTER_MS || '4000', 10));
const INPI_STALE_RUNNING_MS = Math.max(10 * 60_000, parseInt(process.env.INPI_STALE_RUNNING_MS || '3600000', 10));
const INPI_WORKER_LOCK_KEY = Number.parseInt(process.env.INPI_WORKER_LOCK_KEY || '920105', 10);
const S3_ENDPOINT = process.env.S3_ENDPOINT || '';
const S3_REGION = process.env.S3_REGION || 'garage';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || '';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || '';
const S3_BUCKET = process.env.S3_BUCKET || 'patents';

let loopsStarted = false;
let rpiRunning = false;
let docRunning = false;
let opsRunning = false;
let inpiTextRunning = false;
let inpiDocRunning = false;
let bqRunning = false;
let rpiPaused = false;
let docsPaused = false;
let opsPaused = false;
let inpiPaused = false;
let bqPaused = false;
let latestRpiCache: { value: number; expiresAt: number } | null = null;
let opsAccessToken: string | null = null;
let opsTokenExpiration = 0;
let s3BucketReady = false;
let lastOpsRequestAt = 0;
let opsThrottleFailureCount = 0;
let opsCircuitOpenUntil = 0;
let lastGooglePatentsRequestAt = 0;
let googlePatentsFailureCount = 0;
let googlePatentsCircuitOpenUntil = 0;
let lastInpiJobCompletedAt = 0;
let inpiDbLockHeld = false;
let bigQueryAccessToken: string | null = null;
let bigQueryAccessTokenExpiration = 0;
const googlePatentsMetrics = {
    requests: 0,
    success: 0,
    failures: 0,
    retries: 0,
    circuitOpens: 0,
    shortPdfRejected: 0,
    invalidBucketDeleted: 0
};

function normalizeText(value?: string): string {
    return (value || '').replace(/\s+/g, ' ').trim();
}

function parseInpiJobMode(value?: string): 'text' | 'document' {
    const normalized = normalizeText(value).toLowerCase();
    return normalized.includes('mode=document') ? 'document' : 'text';
}

function extractDigits(value?: string): string {
    return (value || '').replace(/[^\d]/g, '');
}

function normalizeInpiCodPedido(value?: string): string {
    const text = normalizeText(value).toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (text.startsWith('BR') && text.length >= 8) return text;
    const digits = extractDigits(text);
    if (digits.length >= 12) return `BR${digits}`;
    return text;
}

function normalizeMonitoringPatentKey(value?: string): string {
    return String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function parseBrDateToIso(value?: string): Date | null {
    const text = normalizeText(value);
    const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const dt = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12, 0, 0));
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function classifyMonitoringSeverity(dispatchCode?: string, title?: string, complement?: string): 'critical' | 'high' | 'medium' | 'low' {
    const code = normalizeDispatchCode(dispatchCode);
    if (code === '6.1' || code === '7.1') return 'critical';
    const merged = `${normalizeText(title)} ${normalizeText(complement)}`.toLowerCase();
    if (merged.includes('indefer') || merged.includes('arquivad') || merged.includes('caduc')) return 'high';
    if (merged.includes('exig') || merged.includes('cumprimento')) return 'medium';
    return 'low';
}

function buildMonitoringAlertKey(parts: Array<string | null | undefined>): string {
    return parts.map((part) => normalizeText(part || '').toLowerCase().slice(0, 180)).join('|');
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

function opsJobLog(entry: Record<string, unknown>) {
    const payload = JSON.stringify({
        ts: new Date().toISOString(),
        worker: 'ops',
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

async function waitGooglePatentsThrottle() {
    const elapsed = Date.now() - lastGooglePatentsRequestAt;
    const baseWait = GOOGLE_PATENTS_MIN_INTERVAL_MS - elapsed;
    if (baseWait > 0) await sleep(baseWait);
    const jitter = Math.floor(Math.random() * GOOGLE_PATENTS_JITTER_MS);
    if (jitter > 0) await sleep(jitter);
}

async function waitGooglePatentsCircuitIfOpen() {
    const now = Date.now();
    if (googlePatentsCircuitOpenUntil > now) {
        await sleep(googlePatentsCircuitOpenUntil - now);
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

function registerGooglePatentsFailure(status?: number) {
    googlePatentsMetrics.failures += 1;
    if (status !== 429 && status !== 408 && status !== 502 && status !== 503 && status !== 504) return;
    googlePatentsFailureCount += 1;
    if (googlePatentsFailureCount >= GOOGLE_PATENTS_BREAKER_THRESHOLD) {
        googlePatentsCircuitOpenUntil = Date.now() + GOOGLE_PATENTS_BREAKER_COOLDOWN_MS;
        googlePatentsFailureCount = 0;
        googlePatentsMetrics.circuitOpens += 1;
        console.warn(JSON.stringify({
            ts: new Date().toISOString(),
            worker: 'google_patents',
            code: 'GOOGLE_PATENTS_CIRCUIT_OPEN',
            cooldownMs: GOOGLE_PATENTS_BREAKER_COOLDOWN_MS,
            until: new Date(googlePatentsCircuitOpenUntil).toISOString(),
            status
        }));
    }
}

function registerGooglePatentsSuccess() {
    googlePatentsFailureCount = 0;
    googlePatentsMetrics.success += 1;
}

function isRetryableGooglePatentsStatus(status?: number): boolean {
    return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

async function googlePatentsGetWithRetry(url: string, config: any): Promise<any> {
    let attempt = 0;
    while (attempt < GOOGLE_PATENTS_RETRY_MAX) {
        attempt += 1;
        await waitGooglePatentsCircuitIfOpen();
        await waitGooglePatentsThrottle();
        googlePatentsMetrics.requests += 1;
        try {
            const response = await axios.get(url, config);
            lastGooglePatentsRequestAt = Date.now();
            const status = Number(response?.status || 0);
            if (isRetryableGooglePatentsStatus(status) && attempt < GOOGLE_PATENTS_RETRY_MAX) {
                registerGooglePatentsFailure(status);
                googlePatentsMetrics.retries += 1;
                await sleep(GOOGLE_PATENTS_MIN_INTERVAL_MS * (attempt + 1));
                continue;
            }
            if (status >= 400) registerGooglePatentsFailure(status);
            else registerGooglePatentsSuccess();
            return response;
        } catch (error: unknown) {
            lastGooglePatentsRequestAt = Date.now();
            const status = axios.isAxiosError(error) ? error.response?.status : undefined;
            registerGooglePatentsFailure(status);
            if (attempt >= GOOGLE_PATENTS_RETRY_MAX) throw error;
            googlePatentsMetrics.retries += 1;
            await sleep(GOOGLE_PATENTS_MIN_INTERVAL_MS * (attempt + 1));
        }
    }
    throw new Error('Falha Google Patents após retries');
}

async function googlePatentsPageGoto(page: any, targetUrl: string): Promise<boolean> {
    await waitGooglePatentsCircuitIfOpen();
    await waitGooglePatentsThrottle();
    googlePatentsMetrics.requests += 1;
    try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        lastGooglePatentsRequestAt = Date.now();
        registerGooglePatentsSuccess();
        return true;
    } catch (error: unknown) {
        lastGooglePatentsRequestAt = Date.now();
        registerGooglePatentsFailure(undefined);
        return false;
    }
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
    return normalized === '3.1' || normalized === '16.1' || normalized === '1.3';
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

function buildBigQueryPublicationCandidates(parsed: ParsedPublicationNumber): string[] {
    const docNoZero = parsed.docNumber.replace(/^0+/, '') || parsed.docNumber;
    const values = new Set<string>([
        parsed.docNumber,
        docNoZero,
        `${parsed.docNumber}${parsed.kindCode}`,
        `${docNoZero}${parsed.kindCode}`,
        `${parsed.docNumber}-${parsed.kindCode}`,
        `${docNoZero}-${parsed.kindCode}`
    ].map((item) => normalizeText(item).toUpperCase()).filter(Boolean));
    return Array.from(values);
}

function buildLooseNumberNeedles(value: string): string[] {
    const normalized = normalizePublicationForBigQuery(value);
    if (!normalized) return [];
    const noBr = normalized.replace(/^BR/i, '');
    const removeTrailingZero = (text: string) => text.endsWith('0') ? text.slice(0, -1) : text;
    const values = new Set<string>([
        normalized,
        noBr,
        removeTrailingZero(normalized),
        removeTrailingZero(noBr)
    ].filter((item) => item.length >= 6));
    return Array.from(values);
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

async function runBigQueryQuery(payload: any): Promise<any> {
    const token = await getBigQueryToken();
    if (!token || !BIGQUERY_BILLING_PROJECT) {
        throw new Error('BIGQUERY_DISABLED_OR_MISSING_CREDENTIALS');
    }
    const response = await axios.post(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(BIGQUERY_BILLING_PROJECT)}/queries`,
        payload,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        }
    );
    return response.data;
}

type BigQueryBibliographicData = {
    title?: string;
    abstract?: string;
    detailedAbstract?: string;
    applicant?: string;
    inventors?: string;
    ipc?: string;
    filingDate?: string;
    publicationDate?: string;
    attorney?: string;
    googlePatentsUrl?: string;
    pdfUrl?: string;
    source?: 'google_bigquery' | 'google_patents';
};

function mapBigQueryToBiblio(patentNumber: string, row: BigQueryBibliographicData): OpsBibliographicData {
    return {
        docdbId: normalizePublicationForBigQuery(patentNumber),
        title: row.title,
        abstract: row.abstract,
        detailedAbstract: row.detailedAbstract || row.abstract,
        applicant: row.applicant,
        inventor: row.inventors,
        ipc: row.ipc,
        publicationDate: row.publicationDate || row.filingDate,
        googlePatentsUrl: row.googlePatentsUrl,
        pdfUrl: row.pdfUrl,
        source: row.source || 'google_bigquery'
    };
}

function mapGoogleBiblioToSearchData(row: OpsBibliographicData): BigQueryBibliographicData {
    return {
        title: row.title,
        abstract: row.abstract,
        detailedAbstract: row.detailedAbstract || row.abstract,
        applicant: row.applicant,
        inventors: row.inventor,
        ipc: row.ipc,
        publicationDate: row.publicationDate,
        googlePatentsUrl: row.googlePatentsUrl,
        pdfUrl: row.pdfUrl,
        source: 'google_patents'
    };
}

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
    if (GOOGLE_PATENTS_ONLY_ENABLED) return null;
    if (!BIGQUERY_BILLING_PROJECT) return null;
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
                detailedAbstract: cached.abstract || undefined,
                applicant: cached.applicant || undefined,
                inventors: cached.inventor || undefined,
                ipc: cached.classification || undefined,
                filingDate: cached.patent_date || undefined,
                publicationDate: cached.patent_date || undefined,
                googlePatentsUrl: cached.url || `https://patents.google.com/patent/${cacheKey}/en`,
                source: 'google_bigquery'
            };
        }
    }
    const docNoLeadingZeros = parsed.docNumber.replace(/^0+/, '') || parsed.docNumber;
    const looseNeedles = buildLooseNumberNeedles(normalized);
    const publicationCandidates = buildBigQueryPublicationCandidates(parsed);
    const exactQuery = `
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
      AND UPPER(IFNULL(t.publication_number, '')) IN UNNEST(@publicationCandidates)
      AND (
          @kindCode = ''
          OR UPPER(IFNULL(t.kind_code, '')) = @kindCode
      )
      LIMIT 1
    `;
    const fallbackQuery = `
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
          REPLACE(REPLACE(REPLACE(UPPER(IFNULL(t.publication_number, '')), '-', ''), ' ', ''), '/', '') = @docNumber
          OR REPLACE(REPLACE(REPLACE(UPPER(IFNULL(t.publication_number, '')), '-', ''), ' ', ''), '/', '') = @docNumberNoLeadingZeros
          OR ${looseNeedles.length > 0 ? `(${looseNeedles.map((_, index) => `REPLACE(REPLACE(REPLACE(UPPER(IFNULL(t.publication_number, '')), '-', ''), ' ', ''), '/', '') LIKE @needle${index}`).join(' OR ')})` : 'FALSE'}
        )
        AND (
          @kindCode = ''
          OR UPPER(IFNULL(t.kind_code, '')) = @kindCode
        )
      LIMIT 1
    `;
    try {
        let response = await runBigQueryQuery({
            query: exactQuery,
            useLegacySql: false,
            parameterMode: 'NAMED',
            maximumBytesBilled: String(BIGQUERY_MAX_BYTES_BILLED),
            useQueryCache: true,
            queryParameters: [
                { name: 'country', parameterType: { type: 'STRING' }, parameterValue: { value: parsed.country } },
                { name: 'publicationCandidates', parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } }, parameterValue: { arrayValues: publicationCandidates.map((value) => ({ value })) } },
                { name: 'kindCode', parameterType: { type: 'STRING' }, parameterValue: { value: parsed.kindCode } }
            ]
        });
        let schemaFields = response?.schema?.fields || [];
        let rowFields = response?.rows?.[0]?.f || [];
        if (!schemaFields.length || !rowFields.length) {
            response = await runBigQueryQuery({
                query: fallbackQuery,
                useLegacySql: false,
                parameterMode: 'NAMED',
                maximumBytesBilled: String(BIGQUERY_MAX_BYTES_BILLED),
                useQueryCache: true,
                queryParameters: [
                    { name: 'country', parameterType: { type: 'STRING' }, parameterValue: { value: parsed.country } },
                    { name: 'docNumber', parameterType: { type: 'STRING' }, parameterValue: { value: parsed.docNumber } },
                    { name: 'docNumberNoLeadingZeros', parameterType: { type: 'STRING' }, parameterValue: { value: docNoLeadingZeros } },
                    { name: 'kindCode', parameterType: { type: 'STRING' }, parameterValue: { value: parsed.kindCode } },
                    ...looseNeedles.map((needle, index) => ({
                        name: `needle${index}`,
                        parameterType: { type: 'STRING' },
                        parameterValue: { value: `%${needle}%` }
                    }))
                ]
            });
            schemaFields = response?.schema?.fields || [];
            rowFields = response?.rows?.[0]?.f || [];
        }
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
            detailedAbstract: abstract || undefined,
            applicant: applicant || undefined,
            inventors: inventors || undefined,
            ipc: ipc || undefined,
            filingDate: filingDate || undefined,
            publicationDate: publicationDate || undefined,
            attorney: attorney || undefined,
            googlePatentsUrl: normalized ? `https://patents.google.com/patent/${normalized}/en` : undefined,
            source: 'google_bigquery' as const
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
    } catch (error) {
        opsJobLog({ status: 'bigquery_lookup_error', publicationNumber, error: serializeUnknownError(error) });
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
        throw new Error(`Credenciais S3 não configuradas endpoint=${Boolean(S3_ENDPOINT)} accessKey=${Boolean(S3_ACCESS_KEY)} secretKey=${Boolean(S3_SECRET_KEY)} bucket=${normalizeText(S3_BUCKET || '') ? 'ok' : 'missing'}`);
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

async function readObjectBufferFromS3(key: string): Promise<Buffer | null> {
    const s3 = getS3Client();
    await ensureS3Bucket();
    try {
        const response = await s3.send(new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: key
        }));
        const body: any = response.Body as any;
        if (!body) return null;
        if (Buffer.isBuffer(body)) return body;
        if (typeof body.transformToByteArray === 'function') {
            const bytes = await body.transformToByteArray();
            return Buffer.from(bytes);
        }
        const chunks: Buffer[] = [];
        for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
            if (typeof chunk === 'string') {
                chunks.push(Buffer.from(chunk));
            } else {
                chunks.push(Buffer.from(chunk));
            }
        }
        return Buffer.concat(chunks);
    } catch {
        return null;
    }
}

async function ensureDerivedStorageAssets(publicationNumber: string, fullPdf: Buffer) {
    const safeBase = publicationNumber.replace(/[^\w.-]/g, '_');
    const baseKey = `patent-docs/${safeBase}`;
    const firstKey = `${baseKey}/first_page.pdf`;
    const drawingsKey = `${baseKey}/drawings.pdf`;
    const [hasFirst, hasDrawings] = await Promise.all([
        objectExistsInS3(firstKey),
        objectExistsInS3(drawingsKey)
    ]);
    if (!hasFirst) await uploadPdfToS3(firstKey, fullPdf);
    if (!hasDrawings) await uploadPdfToS3(drawingsKey, fullPdf);
}

async function ensureDerivedStorageAssetsFromExistingKey(publicationNumber: string, fullStorageKey: string) {
    if (!fullStorageKey) return;
    const fullPdf = await readObjectBufferFromS3(fullStorageKey);
    if (!fullPdf || fullPdf.length < 1024) return;
    await ensureDerivedStorageAssets(publicationNumber, fullPdf);
}

async function deleteStorageKeys(keys: string[]) {
    const unique = Array.from(new Set(keys.map((item) => normalizeText(item)).filter(Boolean)));
    if (unique.length === 0) return;
    const s3 = getS3Client();
    await ensureS3Bucket();
    for (const key of unique) {
        await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key })).catch(() => undefined);
    }
}

async function cleanupInvalidDocumentAssets(existingStorageKey: string, publicationNumber?: string) {
    const normalizedStorageKey = normalizeText(existingStorageKey);
    if (!normalizedStorageKey) return;
    const keys = new Set<string>([normalizedStorageKey]);
    const prefixMatch = normalizedStorageKey.match(/^(.*)\/full_document\.pdf$/i);
    if (prefixMatch?.[1]) {
        keys.add(`${prefixMatch[1]}/drawings.pdf`);
        keys.add(`${prefixMatch[1]}/first_page.pdf`);
    }
    const safeBase = normalizeText(publicationNumber || '').replace(/[^\w.-]/g, '_');
    if (safeBase) {
        keys.add(`patent-docs/${safeBase}/full_document.pdf`);
        keys.add(`patent-docs/${safeBase}/drawings.pdf`);
        keys.add(`patent-docs/${safeBase}/first_page.pdf`);
    }
    await deleteStorageKeys(Array.from(keys));
    googlePatentsMetrics.invalidBucketDeleted += 1;
}

function estimatePdfPageCount(content: Buffer): number {
    if (!content || content.length < 5) return 0;
    const header = content.subarray(0, 5).toString('latin1');
    if (!header.startsWith('%PDF')) return 0;
    const raw = content.toString('latin1');
    const pageMatches = raw.match(/\/Type\s*\/Page\b/g)?.length || 0;
    const pagesMatches = raw.match(/\/Type\s*\/Pages\b/g)?.length || 0;
    const estimated = Math.max(0, pageMatches - pagesMatches);
    if (estimated > 0) return estimated;
    return 1;
}

function isLikelyCompletePatentPdf(content: Buffer): { ok: boolean; pages: number; reason: string } {
    const pages = estimatePdfPageCount(content);
    if (!content || content.length < 1024) {
        return { ok: false, pages, reason: 'invalid_or_too_small' };
    }
    if (pages < MIN_FULL_DOCUMENT_PAGES) {
        return { ok: false, pages, reason: `insufficient_pages_${pages}` };
    }
    return { ok: true, pages, reason: 'ok' };
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
    const rows: Array<{ rpi_number: number; status: 'pending'; source_url: string }> = [];
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
    waitForInpiText?: boolean;
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
    const existingStorageKey = await resolveExistingStorageKey([
        params.publicationNumber,
        existing?.publication_number,
        params.patentId
    ]);
    if (existingStorageKey) {
        const existingPdf = await readObjectBufferFromS3(existingStorageKey);
        const existingQuality = existingPdf ? isLikelyCompletePatentPdf(existingPdf) : { ok: false, pages: 0, reason: 'storage_read_failed' };
        if (existingQuality.ok) {
            await prisma.documentDownloadJob.upsert({
                where: { patent_id: params.patentId },
                update: {
                    status: 'completed',
                    error: null,
                    storage_key: existingStorageKey,
                    publication_number: params.publicationNumber || existing?.publication_number || null,
                    rpi_number: params.rpiNumber,
                    finished_at: new Date()
                },
                create: {
                    patent_id: params.patentId,
                    rpi_number: params.rpiNumber,
                    publication_number: params.publicationNumber || null,
                    status: 'completed',
                    storage_key: existingStorageKey,
                    finished_at: new Date()
                }
            });
            return;
        }
        await cleanupInvalidDocumentAssets(existingStorageKey, params.publicationNumber || existing?.publication_number || params.patentId).catch(() => undefined);
    }
    if (existing && ['pending', 'running', 'completed', 'waiting_inpi_text'].includes(existing.status)) return;
    const pendingStatus = params.waitForInpiText ? 'waiting_inpi_text' : 'pending_google_patents';
    await prisma.documentDownloadJob.upsert({
        where: { patent_id: params.patentId },
        update: {
            status: pendingStatus,
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
            status: pendingStatus
        }
    });
}

async function queueOpsBibliographicJob(params: {
    patentNumber: string;
    rpiNumber: number;
}) {
    if (!params.patentNumber) return;
    await prismaAny.opsBibliographicJob.upsert({
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

async function queueInpiProcessingJob(params: {
    patentNumber: string;
    priority: number;
    mode: 'text' | 'document';
}) {
    const patentNumber = normalizeInpiCodPedido(params.patentNumber);
    if (!patentNumber) return;
    const modeTag = `mode=${params.mode}`;
    await prisma.inpiProcessingJob.upsert({
        where: { patent_number: patentNumber },
        update: {
            priority: params.priority,
            status: 'pending',
            attempts: 0,
            error: modeTag,
            started_at: null,
            finished_at: null
        },
        create: {
            patent_number: patentNumber,
            priority: params.priority,
            status: 'pending',
            attempts: 0,
            error: modeTag
        }
    });
}

async function processRpiXmlContent(rpiNumber: number, xmlContent: string): Promise<number> {
    const $ = cheerio.load(xmlContent, { xmlMode: true });
    const revista = $('revista').first();
    const dataPublicacao = revista.attr('dataPublicacao') || revista.attr('data-publicacao') || '';
    const despachoNodes = revista.find('despacho').toArray();
    const bqCache = new Map<string, BigQueryBibliographicData | null>();
    const monitoredAttorneyRows = await prisma.$queryRawUnsafe(
        `select name from monitoring_attorneys where active=true`
    ).catch(() => []) as any[];
    const monitoredAttorneys = (monitoredAttorneyRows || [])
        .map((row: any) => normalizeText(row?.name).toLowerCase())
        .filter(Boolean);
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
        const inferredPatentId = codPedidoFromNumero || patentNumber || null;
        if (monitoredAttorneys.length > 0) {
            const mergedAttorneyText = `${dispatchTitle || ''} ${complement || ''}`.toLowerCase();
            const matchedAttorney = monitoredAttorneys.find((name: string) => mergedAttorneyText.includes(name));
            if (matchedAttorney) {
                const monitoringNumber = patentNumber || numeroPublicacao || codPedidoFromNumero || numeroRaw;
                const monitoringId = normalizeMonitoringPatentKey(monitoringNumber);
                if (monitoringId) {
                    const currentRows = await prisma.$queryRawUnsafe(
                        `select id, blocked_by_user from monitored_inpi_patents where patent_number=$1 limit 1`,
                        monitoringId
                    ).catch(() => []) as any[];
                    const existing = currentRows?.[0];
                    if (existing?.id) {
                        if (!existing.blocked_by_user) {
                            await prisma.$executeRawUnsafe(
                                `update monitored_inpi_patents
                                 set active=true,
                                     source='attorney_auto',
                                     matched_attorney=$2,
                                     patent_id=coalesce($3, patent_id),
                                     updated_at=now(),
                                     last_seen_at=now()
                                 where id=$1`,
                                existing.id,
                                matchedAttorney,
                                inferredPatentId
                            ).catch(() => undefined);
                        }
                    } else {
                        await prisma.$executeRawUnsafe(
                            `insert into monitored_inpi_patents
                             (id, patent_number, patent_id, source, matched_attorney, active, blocked_by_user, created_at, updated_at, last_seen_at)
                             values ($1,$2,$3,'attorney_auto',$4,true,false,now(),now(),now())
                             on conflict (patent_number) do nothing`,
                            monitoringId,
                            monitoringId,
                            inferredPatentId,
                            matchedAttorney
                        ).catch(() => undefined);
                    }
                }
            }
        }
        const isDocumentEligible = isDocumentEligibleDispatch(dispatchCode);
        const hasXmlBiblio = hasBasicBibliographicData({
            title: inventionTitle || dispatchTitle,
            applicant: applicants,
            inventor: inventors,
            ipc: ipcs,
            filingDate
        });
        const existingBiblio = await prismaAny.inpiPublication.findFirst({
            where: { patent_number: patentNumber, bibliographic_status: 'completed' },
            orderBy: { created_at: 'desc' },
            select: {
                ops_title: true,
                ops_applicant: true,
                ops_inventor: true,
                ops_ipc: true,
                ops_publication_date: true
            }
        }).catch(() => null);
        const hasStoredBiblio = hasBasicBibliographicData({
            title: existingBiblio?.ops_title,
            applicant: existingBiblio?.ops_applicant,
            inventor: existingBiblio?.ops_inventor,
            ipc: existingBiblio?.ops_ipc,
            filingDate: existingBiblio?.ops_publication_date
        });
        const shouldTryBigQuery = !hasXmlBiblio && !hasStoredBiblio;
        let resolvedExternalData: BigQueryBibliographicData | null = shouldTryBigQuery
            ? (bqCache.has(patentNumber) ? (bqCache.get(patentNumber) || null) : null)
            : null;
        if (shouldTryBigQuery && !resolvedExternalData) {
            const normalizedPublication = numeroPublicacao || patentNumber;
            const googleData = await fetchGooglePatentsBibliographicData(normalizedPublication);
            resolvedExternalData = googleData ? mapGoogleBiblioToSearchData(googleData) : null;
            if (!resolvedExternalData) {
                resolvedExternalData = await fetchBigQueryBibliographicData(normalizedPublication);
            }
        }
        if (shouldTryBigQuery && !bqCache.has(patentNumber)) bqCache.set(patentNumber, resolvedExternalData);
        const hasBigQueryBiblio = hasBasicBibliographicData({
            title: resolvedExternalData?.title,
            applicant: resolvedExternalData?.applicant,
            inventor: resolvedExternalData?.inventors,
            ipc: resolvedExternalData?.ipc,
            filingDate: resolvedExternalData?.filingDate
        });
        const shouldQueueOpsBiblio = !isDocumentEligible
            && !hasXmlBiblio
            && !hasStoredBiblio
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
                    title: resolvedExternalData?.title || inventionTitle || dispatchTitle || undefined,
                    abstract: resolvedExternalData?.abstract || undefined,
                    resumo_detalhado: resolvedExternalData?.detailedAbstract || resolvedExternalData?.abstract || undefined,
                    applicant: resolvedExternalData?.applicant || applicants || undefined,
                    inventors: resolvedExternalData?.inventors || inventors || undefined,
                    ipc_codes: resolvedExternalData?.ipc || ipcs || undefined,
                    filing_date: resolvedExternalData?.filingDate || filingDate || undefined,
                    last_rpi: String(rpiNumber),
                    last_event: dispatchCode || undefined,
                    status: dispatchTitle || undefined
                },
                create: {
                    cod_pedido: patentId,
                    numero_publicacao: numeroPublicacao || numeroRaw || patentNumber,
                    title: resolvedExternalData?.title || inventionTitle || dispatchTitle || null,
                    abstract: resolvedExternalData?.abstract || null,
                    resumo_detalhado: resolvedExternalData?.detailedAbstract || resolvedExternalData?.abstract || null,
                    applicant: resolvedExternalData?.applicant || applicants || null,
                    inventors: resolvedExternalData?.inventors || inventors || null,
                    ipc_codes: resolvedExternalData?.ipc || ipcs || null,
                    filing_date: resolvedExternalData?.filingDate || filingDate || null,
                    last_rpi: String(rpiNumber),
                    last_event: dispatchCode || null,
                    status: dispatchTitle || null
                }
            });
            await prismaAny.inpiPublication.updateMany({
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
                    title: resolvedExternalData?.title || undefined,
                    abstract: resolvedExternalData?.abstract || undefined,
                    resumo_detalhado: resolvedExternalData?.detailedAbstract || resolvedExternalData?.abstract || undefined,
                    applicant: resolvedExternalData?.applicant || applicants || undefined,
                    inventors: resolvedExternalData?.inventors || inventors || undefined,
                    ipc_codes: resolvedExternalData?.ipc || ipcs || undefined,
                    filing_date: resolvedExternalData?.filingDate || filingDate || undefined,
                    last_rpi: String(rpiNumber),
                    last_event: dispatchCode || undefined,
                    status: dispatchTitle || undefined
                }
            }).catch(() => undefined);
        }

        const publicationExists = await prismaAny.inpiPublication.findFirst({
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
            await prismaAny.inpiPublication.create({
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
                    ops_title: resolvedExternalData?.title || inventionTitle || dispatchTitle || null,
                    ops_applicant: resolvedExternalData?.applicant || applicants || null,
                    ops_inventor: resolvedExternalData?.inventors || inventors || null,
                    ops_ipc: resolvedExternalData?.ipc || ipcs || null,
                    ops_publication_date: resolvedExternalData?.publicationDate || resolvedExternalData?.filingDate || filingDate || null,
                    ops_error: resolvedExternalData ? `source=${resolvedExternalData.source || 'google_bigquery'}${resolvedExternalData.attorney ? ` attorney=${resolvedExternalData.attorney}` : ''}` : null,
                    ops_last_sync_at: (hasXmlBiblio || hasBigQueryBiblio) ? new Date() : null
                }
            });
        } else if (patentId && !publicationExists.patent_id) {
            await prismaAny.inpiPublication.update({
                where: { id: publicationExists.id },
                data: { patent_id: patentId }
            });
        } else if (hasXmlBiblio || hasBigQueryBiblio) {
            await prismaAny.inpiPublication.update({
                where: { id: publicationExists.id },
                data: {
                    bibliographic_status: 'completed',
                    ops_title: resolvedExternalData?.title || inventionTitle || dispatchTitle || undefined,
                    ops_applicant: resolvedExternalData?.applicant || applicants || undefined,
                    ops_inventor: resolvedExternalData?.inventors || inventors || undefined,
                    ops_ipc: resolvedExternalData?.ipc || ipcs || undefined,
                    ops_publication_date: resolvedExternalData?.publicationDate || resolvedExternalData?.filingDate || filingDate || undefined,
                    ops_error: resolvedExternalData ? `source=${resolvedExternalData.source || 'google_bigquery'}${resolvedExternalData.attorney ? ` attorney=${resolvedExternalData.attorney}` : ''}` : undefined,
                    ops_last_sync_at: new Date()
                }
            }).catch(() => undefined);
        }

        const monitoringRows = await prisma.$queryRawUnsafe(
            `select id, active
             from monitored_inpi_patents
             where patent_number=$1
             limit 1`,
            normalizeMonitoringPatentKey(patentNumber)
        ).catch(() => []) as any[];
        const monitored = monitoringRows?.[0];
        if (monitored?.id && monitored?.active) {
            const severity = classifyMonitoringSeverity(dispatchCode, dispatchTitle, complement);
            const rpiDate = parseBrDateToIso(dataPublicacao) || new Date();
            const deadline = severity === 'critical'
                ? new Date(rpiDate.getTime() + (60 * 24 * 60 * 60 * 1000))
                : null;
            const alertKey = buildMonitoringAlertKey([
                monitored.id,
                String(rpiNumber),
                dispatchCode,
                dataPublicacao,
                complement
            ]);
            await prisma.$executeRawUnsafe(
                `insert into monitoring_alerts
                 (id, monitored_patent_id, alert_key, patent_number, rpi_number, rpi_date, despacho_code, title, complement, severity, deadline, is_read, created_at, updated_at)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,now(),now())
                 on conflict (alert_key) do update
                 set severity=excluded.severity,
                     deadline=excluded.deadline,
                     title=excluded.title,
                     complement=excluded.complement,
                     updated_at=now()`,
                randomUUID(),
                monitored.id,
                alertKey,
                normalizeMonitoringPatentKey(patentNumber),
                String(rpiNumber),
                rpiDate,
                dispatchCode || null,
                dispatchTitle || null,
                complement || null,
                severity,
                deadline
            ).catch(() => undefined);
        }

        if (patentId && INPI_SCRAPE_FIRST_ENABLED) {
            await queueInpiProcessingJob({
                patentNumber: patentId,
                priority: 10,
                mode: 'text'
            }).catch(() => undefined);
        }
        if (isDocumentEligible && patentId) {
            await queueDocumentJobForPatent({
                patentId,
                rpiNumber,
                publicationNumber: numeroPublicacao || numeroRaw || patentNumber,
                status: dispatchTitle,
                dispatchCode: dispatchCode,
                waitForInpiText: Boolean(INPI_SCRAPE_FIRST_ENABLED)
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
            orderBy: [{ rpi_number: RPI_PROCESS_ORDER }, { created_at: 'asc' }]
        });
        if (!job) {
            job = await prisma.rpiImportJob.findFirst({
                where: {
                    status: 'failed',
                    attempts: { lt: MAX_RPI_ATTEMPTS }
                },
                orderBy: [{ attempts: 'asc' }, { updated_at: 'asc' }, { rpi_number: RPI_PROCESS_ORDER }]
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
    await prismaAny.opsBibliographicJob.updateMany({
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
    const testKey = async (base: string): Promise<string | null> => {
        if (!base || seen.has(base)) return null;
        seen.add(base);
        const key = `patent-docs/${base}/full_document.pdf`;
        if (await objectExistsInS3(key)) return key;
        return null;
    };
    for (const raw of candidates) {
        const normalized = normalizeText(raw || '');
        if (!normalized) continue;
        const safeBase = normalized.replace(/[^\w.-]/g, '_');
        const compactBase = normalized.replace(/[^\w]/g, '').toUpperCase();
        const patentKeyBase = buildPatentNumberKey(normalized);
        const candidatesBase = [
            safeBase,
            safeBase.toUpperCase(),
            compactBase,
            patentKeyBase
        ].filter(Boolean);
        for (const base of candidatesBase) {
            const key = await testKey(base);
            if (key) return key;
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

function parseOpsPagesHint(value?: string): number {
    const parsed = Number.parseInt(normalizeText(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return parsed;
}

async function downloadOpsPatentPdf(publicationNumber: string): Promise<{ pdf: Buffer; docdbId: string } | null> {
    const docdbId = await resolveDocdbId(publicationNumber);
    if (!docdbId) return null;
    const instances = await fetchDocumentInstances(docdbId);
    if (!instances.length) return null;
    const sortedInstances = [...instances].sort((a, b) => {
        const leftDesc = normalizeText(a['@desc'] || '').toLowerCase();
        const rightDesc = normalizeText(b['@desc'] || '').toLowerCase();
        const score = (text: string) => {
            if (text.includes('full')) return 5;
            if (text.includes('description')) return 4;
            if (text.includes('specification')) return 3;
            if (text.includes('document')) return 2;
            if (text.includes('claims')) return 1;
            return 0;
        };
        return score(rightDesc) - score(leftDesc);
    });
    for (const instance of sortedInstances) {
        const link = normalizeText(instance['@link'] || '');
        if (!link) continue;
        const pagesHint = parseOpsPagesHint(instance['@number-of-pages']);
        const range = pagesHint > 0 ? `1-${pagesHint}` : '1-200';
        try {
            const pdf = await downloadOpsPdfByLink(link, range);
            if (!pdf || pdf.length < 1024) continue;
            const quality = isLikelyCompletePatentPdf(pdf);
            if (!quality.ok) continue;
            return { pdf, docdbId };
        } catch {
            continue;
        }
    }
    return null;
}

type OpsBibliographicData = {
    docdbId: string;
    title?: string;
    abstract?: string;
    detailedAbstract?: string;
    applicant?: string;
    inventor?: string;
    ipc?: string;
    publicationDate?: string;
    googlePatentsUrl?: string;
    pdfUrl?: string;
    source?: string;
};

function extractGooglePatentNumberCandidates(patentNumber: string): string[] {
    const normalizeGoogleSeed = (value?: string): string[] => {
        const raw = normalizeText(value || '').toUpperCase();
        const hasHyphenCheckDigit = /-[0-9X]$/i.test(raw);
        const rawCompact = raw.replace(/[^A-Z0-9-]/g, '');
        const fullValue = rawCompact.replace(/[^A-Z0-9]/g, '');
        const beforeHyphen = (rawCompact.split('-')[0] || rawCompact).replace(/[^A-Z0-9]/g, '');
        const variants = new Set<string>([fullValue, beforeHyphen].filter(Boolean));
        const normalizedVariants = new Set<string>();
        for (const candidate of variants) {
            let normalized = candidate;
            const brMatch = normalized.match(/^BR(10|11|12|13)(\d+)$/);
            if (!hasHyphenCheckDigit && brMatch && brMatch[2].length > 10) {
                normalized = `BR${brMatch[1]}${brMatch[2].slice(0, -1)}`;
            }
            normalizedVariants.add(normalized);
        }
        return Array.from(normalizedVariants).filter(Boolean);
    };
    const bases = normalizeGoogleSeed(patentNumber);
    if (bases.length === 0) return [];
    const variants = new Set<string>(bases);
    for (const base of bases) {
        const noBr = base.replace(/^BR/i, '');
        if (noBr) variants.add(noBr);
    }
    return Array.from(variants).filter(Boolean);
}

function extractGooglePatentAbstract($: ReturnType<typeof cheerio.load>): string {
    const candidates = [
        $('meta[name="DC.description"]').attr('content'),
        $('meta[name="description"]').attr('content'),
        $('meta[property="og:description"]').attr('content'),
        $('[itemprop="abstract"]').first().text(),
        $('section[itemprop="abstract"] div.abstract').first().text(),
        $('div[data-proto*="abstract"]').first().text(),
        $('div.abstract').text(),
        $('div.abstract').first().text(),
        $('abstract').first().text(),
        $('patent-text[prefix="abstract"]').first().text()
    ];
    for (const candidate of candidates) {
        const value = normalizeText(candidate || '');
        if (value.length >= 40) return value;
    }
    return '';
}

function extractGooglePatentPdfUrl($: ReturnType<typeof cheerio.load>, pageUrl: string): string | undefined {
    const candidateLinks = new Set<string>();
    const addLink = (value?: string | null) => {
        const href = normalizeText(value || '');
        if (!href) return;
        if (/\.pdf($|\?)/i.test(href) || /download=pdf/i.test(href) || /\/patent\/.*\/download/i.test(href)) {
            const absolute = href.startsWith('http') ? href : `https://patents.google.com${href.startsWith('/') ? '' : '/'}${href}`;
            candidateLinks.add(absolute);
        }
    };
    addLink($('meta[name="citation_pdf_url"]').attr('content'));
    $('a, button').each((_, el) => {
        const text = normalizeText($(el).text()).toLowerCase();
        const aria = normalizeText($(el).attr('aria-label') || '').toLowerCase();
        if (text.includes('download pdf') || aria.includes('download pdf')) {
            addLink($(el).attr('href') || $(el).attr('data-href'));
        }
    });
    $('a[href]').each((_, el) => addLink($(el).attr('href')));
    for (const link of Array.from(candidateLinks)) {
        if (link.includes('/patent/')) return link;
    }
    return pageUrl;
}

function extractGooglePortugueseUrl($: ReturnType<typeof cheerio.load>, pageUrl: string): string | undefined {
    const direct = $('a[href*="/pt"]').toArray().find((el) => {
        const text = normalizeText($(el).text()).toLowerCase();
        return text.includes('portuguese') || text.includes('português');
    });
    const href = direct ? normalizeText($(direct).attr('href') || '') : '';
    if (!href) return undefined;
    return href.startsWith('http') ? href : `https://patents.google.com${href.startsWith('/') ? '' : '/'}${href}`;
}

type GooglePatentBrowserSnapshot = {
    detailUrl: string;
    detailHtml: string;
    portugueseUrl?: string;
    portugueseHtml?: string;
    pdfCandidates: string[];
    title?: string;
    abstract?: string;
    applicant?: string;
    inventor?: string;
    ipc?: string;
    publicationDate?: string;
    figureCandidates: string[];
    drawingsPdfCandidates: string[];
    firstPagePdfCandidates: string[];
};

async function openGooglePatentViaBrowser(patentNumber: string): Promise<GooglePatentBrowserSnapshot | null> {
    const candidates = extractGooglePatentNumberCandidates(patentNumber);
    if (candidates.length === 0) return null;
    const { default: puppeteer } = await import('puppeteer');
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
    try {
        let detailUrl = '';
        let detailHtml = '';
        const tryExtractFromCurrentPage = async (): Promise<{ url: string; html: string } | null> => {
            const currentUrl = page.url();
            if (!currentUrl.includes('/patent/')) return null;
            const html = await page.content();
            if (!html || /security verification|just a moment/i.test(html)) return null;
            return { url: currentUrl, html };
        };

        for (const candidate of candidates) {
            // Try direct URL first - much faster and more reliable than searching
            const directUrl = `https://patents.google.com/patent/${candidate}/pt`;
            const directLoaded = await googlePatentsPageGoto(page, directUrl);
            if (!directLoaded) continue;
            let extracted = await tryExtractFromCurrentPage();
            
            // If direct URL fails, fallback to search
            if (!extracted) {
                const searchLoaded = await googlePatentsPageGoto(page, 'https://patents.google.com/');
                if (!searchLoaded) continue;
                await page.evaluate((value: string) => {
                    const input = document.querySelector<HTMLInputElement>('input[type="search"], input[aria-label*="Search"], input[name="q"]');
                    if (!input) return;
                    input.focus();
                    input.value = '';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.value = value;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }, candidate);
                await page.keyboard.press('Enter');
                await sleep(1600 + Math.floor(Math.random() * 600));
                let currentUrl = page.url();
                if (!currentUrl.includes('/patent/')) {
                    await page.evaluate(() => {
                        const firstLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/patent/"]'))
                            .find((item) => Boolean(item.href));
                        if (firstLink) firstLink.click();
                    });
                    await sleep(1400 + Math.floor(Math.random() * 500));
                }
                extracted = await tryExtractFromCurrentPage();
            }
            
            if (!extracted) continue;
            detailUrl = extracted.url;
            detailHtml = extracted.html;
            break;
        }
        if (!detailUrl || !detailHtml) return null;

        const switchedToPortuguese = await page.evaluate(() => {
            const langLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
                .find((item) => /portuguese|português/i.test((item.textContent || '').toLowerCase()));
            if (!langLink) return false;
            langLink.click();
            return true;
        });
        let portugueseUrl: string | undefined;
        let portugueseHtml: string | undefined;
        if (switchedToPortuguese) {
            await sleep(1200 + Math.floor(Math.random() * 500));
            portugueseUrl = page.url();
            const html = await page.content();
            if (html && !/security verification|just a moment/i.test(html)) {
                portugueseHtml = html;
            }
        }
        if (!portugueseHtml) {
            const current = page.url() || detailUrl;
            const ptUrl = current.includes('/en')
                ? current.replace('/en', '/pt')
                : `${current.replace(/\/$/, '')}/pt`;
            const ptLoaded = await googlePatentsPageGoto(page, ptUrl);
            if (ptLoaded) {
                await sleep(900 + Math.floor(Math.random() * 500));
                const html = await page.content();
                if (html && !/security verification|just a moment/i.test(html) && !/error 404/i.test(html.toLowerCase())) {
                    portugueseUrl = page.url();
                    portugueseHtml = html;
                }
            }
        }

        const browserCandidates: {
            out: string[];
            figureCandidates: string[];
            drawingsPdfCandidates: string[];
            firstPagePdfCandidates: string[];
        } = await page.evaluate(() => {
            const out: string[] = [];
            const figureCandidates: string[] = [];
            const drawingsPdfCandidates: string[] = [];
            const firstPagePdfCandidates: string[] = [];
            const add = (value?: string | null) => {
                if (!value) return;
                out.push(value);
            };
            const addFigure = (value?: string | null) => {
                if (!value) return;
                figureCandidates.push(value);
            };
            const addDrawings = (value?: string | null) => {
                if (!value) return;
                drawingsPdfCandidates.push(value);
            };
            const addFirstPage = (value?: string | null) => {
                if (!value) return;
                firstPagePdfCandidates.push(value);
            };
            add(document.querySelector('meta[name="citation_pdf_url"]')?.getAttribute('content'));
            const nodes = Array.from(document.querySelectorAll<HTMLElement>('a[href], button[data-href], button[href]'));
            for (const node of nodes) {
                const text = (node.textContent || '').toLowerCase();
                const aria = (node.getAttribute('aria-label') || '').toLowerCase();
                const href = node.getAttribute('href') || node.getAttribute('data-href') || '';
                if (text.includes('download pdf') || aria.includes('download pdf')) add(href);
                if (/pdf|download|patentimages/i.test(href)) add(href);
                if (/drawing|drawings|figure|figures|first page|first-page/i.test(`${text} ${aria} ${href}`)) {
                    addFigure(href);
                    if (/drawing|drawings|figure|figures/i.test(`${text} ${aria} ${href}`)) addDrawings(href);
                    if (/first page|first-page/i.test(`${text} ${aria} ${href}`)) addFirstPage(href);
                }
            }
            const figureNodes = Array.from(document.querySelectorAll<HTMLImageElement>('img[src], source[srcset], img[data-src], img[data-lazy-src]'));
            for (const node of figureNodes) {
                const src = node.getAttribute('src')
                    || node.getAttribute('data-src')
                    || node.getAttribute('data-lazy-src')
                    || '';
                const srcset = node.getAttribute('srcset') || '';
                if (/figure|drawing|patentimages|googleusercontent/i.test(`${src} ${srcset}`)) {
                    addFigure(src);
                    if (srcset) {
                        const parts = srcset.split(',').map((item) => item.trim().split(' ')[0]).filter(Boolean);
                        parts.forEach((part) => addFigure(part));
                    }
                }
            }
            return { out, figureCandidates, drawingsPdfCandidates, firstPagePdfCandidates };
        });
        const browserBiblio = await page.evaluate(() => {
            const clean = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();
            const collectBySelectors = (selectors: string[]): string => {
                const values: string[] = [];
                for (const selector of selectors) {
                    const nodes = Array.from(document.querySelectorAll(selector));
                    for (const node of nodes) {
                        const value = clean(node.textContent || (node as HTMLElement).getAttribute?.('content') || '');
                        if (value) values.push(value);
                    }
                }
                return clean(Array.from(new Set(values)).join('; '));
            };
            const title = clean(
                document.querySelector('meta[name="DC.title"]')?.getAttribute('content')
                || document.querySelector('h1')?.textContent
                || document.title
            );
            const abstract = clean(
                document.querySelector('meta[name="DC.description"]')?.getAttribute('content')
                || document.querySelector('meta[property="og:description"]')?.getAttribute('content')
                || document.querySelector('[itemprop="abstract"]')?.textContent
                || document.querySelector('section[itemprop="abstract"] div.abstract')?.textContent
                || document.querySelector('patent-text[prefix="abstract"]')?.textContent
                || document.querySelector('div.abstract')?.textContent
                || document.querySelector('abstract')?.textContent
            );
            const applicant = collectBySelectors([
                'meta[scheme="assignee"]',
                'dd[itemprop="assigneeOriginal"] span[itemprop="name"]',
                'dd[itemprop="assigneeCurrent"] span[itemprop="name"]',
                '[itemprop="assigneeOriginal"] [itemprop="name"]',
                '[itemprop="assigneeCurrent"] [itemprop="name"]'
            ]) || clean(document.querySelector('meta[scheme="assignee"]')?.getAttribute('content'));
            const inventor = collectBySelectors([
                'meta[scheme="inventor"]',
                'dd[itemprop="inventor"] span[itemprop="name"]',
                '[itemprop="inventor"] [itemprop="name"]'
            ]) || clean(document.querySelector('meta[scheme="inventor"]')?.getAttribute('content'));
            const publicationDate = clean(
                document.querySelector('meta[scheme="publication-date"]')?.getAttribute('content')
                || document.querySelector('time[itemprop="publicationDate"]')?.getAttribute('datetime')
            );
            const ipcList = Array.from(document.querySelectorAll('span[itemprop="Code"], td[itemprop="Code"], [itemprop="ipc"], [itemprop="classificationCpc"]'))
                .map((el) => clean(el.textContent))
                .filter(Boolean)
                .slice(0, 20);
            const ipc = clean(ipcList.join(', '));
            return { title, abstract, applicant, inventor, ipc, publicationDate };
        });
        const base = portugueseUrl || detailUrl;
        const pdfCandidates = new Set<string>();
        const figureCandidates = new Set<string>();
        const drawingsPdfCandidates = new Set<string>();
        const firstPagePdfCandidates = new Set<string>();
        const addAbsolute = (raw?: string) => {
            const href = normalizeText(raw || '');
            if (!href) return;
            try {
                const absolute = new URL(href, base).toString();
                pdfCandidates.add(absolute);
            } catch {
                return;
            }
        };
        const addAbsoluteToSet = (target: Set<string>, raw?: string) => {
            const href = normalizeText(raw || '');
            if (!href) return;
            try {
                const absolute = new URL(href, base).toString();
                target.add(absolute);
            } catch {
                return;
            }
        };
        browserCandidates.out.forEach((item) => addAbsolute(item));
        browserCandidates.figureCandidates.forEach((item) => addAbsoluteToSet(figureCandidates, item));
        browserCandidates.drawingsPdfCandidates.forEach((item) => addAbsoluteToSet(drawingsPdfCandidates, item));
        browserCandidates.firstPagePdfCandidates.forEach((item) => addAbsoluteToSet(firstPagePdfCandidates, item));
        addAbsolute(`${detailUrl}${detailUrl.includes('?') ? '&' : '?'}download=pdf`);
        if (portugueseUrl) addAbsolute(`${portugueseUrl}${portugueseUrl.includes('?') ? '&' : '?'}download=pdf`);
        addAbsoluteToSet(drawingsPdfCandidates, `${detailUrl}${detailUrl.includes('?') ? '&' : '?'}download=drawings`);
        addAbsoluteToSet(drawingsPdfCandidates, `${detailUrl}${detailUrl.includes('?') ? '&' : '?'}download=figures`);
        addAbsoluteToSet(firstPagePdfCandidates, `${detailUrl}${detailUrl.includes('?') ? '&' : '?'}download=firstpage`);
        if (portugueseUrl) {
            addAbsoluteToSet(drawingsPdfCandidates, `${portugueseUrl}${portugueseUrl.includes('?') ? '&' : '?'}download=drawings`);
            addAbsoluteToSet(drawingsPdfCandidates, `${portugueseUrl}${portugueseUrl.includes('?') ? '&' : '?'}download=figures`);
            addAbsoluteToSet(firstPagePdfCandidates, `${portugueseUrl}${portugueseUrl.includes('?') ? '&' : '?'}download=firstpage`);
        }

        return {
            detailUrl,
            detailHtml,
            portugueseUrl,
            portugueseHtml,
            pdfCandidates: Array.from(pdfCandidates),
            title: browserBiblio.title || undefined,
            abstract: browserBiblio.abstract || undefined,
            applicant: browserBiblio.applicant || undefined,
            inventor: browserBiblio.inventor || undefined,
            ipc: browserBiblio.ipc || undefined,
            publicationDate: browserBiblio.publicationDate || undefined,
            figureCandidates: Array.from(figureCandidates),
            drawingsPdfCandidates: Array.from(drawingsPdfCandidates),
            firstPagePdfCandidates: Array.from(firstPagePdfCandidates)
        };
    } finally {
        await page.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
    }
}

async function fetchGooglePatentsBibliographicData(patentNumber: string): Promise<OpsBibliographicData | null> {
    if (!GOOGLE_PATENTS_FALLBACK_ENABLED) return null;
    const snapshot = await openGooglePatentViaBrowser(patentNumber);
    if (!snapshot) return null;
    const extractionHtml = snapshot.portugueseHtml || snapshot.detailHtml;
    const extractionUrl = snapshot.portugueseUrl || snapshot.detailUrl;
    const extractionHtmlLower = extractionHtml.toLowerCase();
    if (
        extractionHtmlLower.includes('error 404') ||
        extractionHtmlLower.includes('did not match any documents') ||
        extractionHtmlLower.includes('não encontrou nenhum resultado')
    ) {
        return null;
    }
    const extraction$ = cheerio.load(extractionHtml);
    const fallback$ = cheerio.load(snapshot.detailHtml);
    const title = normalizeText(snapshot.title || extraction$('meta[name="DC.title"]').attr('content') || extraction$('h1').first().text() || extraction$('title').text());
    const collectPeople = ($root: ReturnType<typeof cheerio.load>, selectors: string[]): string => {
        const values = new Set<string>();
        selectors.forEach((selector) => {
            $root(selector).each((_, el) => {
                const text = normalizeText($root(el).text() || $root(el).attr('content') || '');
                if (text) values.add(text);
            });
        });
        return Array.from(values).join('; ');
    };
    const applicant = normalizeText(
        snapshot.applicant
        || collectPeople(extraction$, [
            'meta[scheme="assignee"]',
            'dd[itemprop="assigneeOriginal"] span[itemprop="name"]',
            'dd[itemprop="assigneeCurrent"] span[itemprop="name"]',
            '[itemprop="assigneeOriginal"] [itemprop="name"]',
            '[itemprop="assigneeCurrent"] [itemprop="name"]'
        ])
        || collectPeople(fallback$, [
            'meta[scheme="assignee"]',
            'dd[itemprop="assigneeOriginal"] span[itemprop="name"]',
            'dd[itemprop="assigneeCurrent"] span[itemprop="name"]',
            '[itemprop="assigneeOriginal"] [itemprop="name"]',
            '[itemprop="assigneeCurrent"] [itemprop="name"]'
        ])
    );
    const inventor = normalizeText(
        snapshot.inventor
        || collectPeople(extraction$, [
            'meta[scheme="inventor"]',
            'dd[itemprop="inventor"] span[itemprop="name"]',
            '[itemprop="inventor"] [itemprop="name"]'
        ])
        || collectPeople(fallback$, [
            'meta[scheme="inventor"]',
            'dd[itemprop="inventor"] span[itemprop="name"]',
            '[itemprop="inventor"] [itemprop="name"]'
        ])
    );
    const publicationDate = normalizeText(
        snapshot.publicationDate
        || extraction$('meta[scheme="publication-date"]').attr('content')
        || extraction$('time[itemprop="publicationDate"]').attr('datetime')
        || fallback$('meta[scheme="publication-date"]').attr('content')
        || fallback$('time[itemprop="publicationDate"]').attr('datetime')
        || ''
    );
    const ipc = extraction$('span[itemprop="Code"], td[itemprop="Code"], [itemprop="ipc"], [itemprop="classificationCpc"]')
        .toArray()
        .map((el) => normalizeText(extraction$(el).text()))
        .filter(Boolean)
        .slice(0, 20)
        .join(', ');
    const fallbackIpc = fallback$('span[itemprop="Code"], td[itemprop="Code"], [itemprop="ipc"], [itemprop="classificationCpc"]')
        .toArray()
        .map((el) => normalizeText(fallback$(el).text()))
        .filter(Boolean)
        .slice(0, 20)
        .join(', ');
    const abstract = normalizeText(snapshot.abstract || extractGooglePatentAbstract(extraction$) || extractGooglePatentAbstract(fallback$));
    const pdfUrl = snapshot.pdfCandidates[0] || extractGooglePatentPdfUrl(extraction$, extractionUrl);
    if (!title && !applicant && !inventor && !ipc && !abstract) return null;
    return {
        docdbId: normalizePublicationNumber(patentNumber),
        title: title || undefined,
        abstract: abstract || undefined,
        detailedAbstract: abstract || undefined,
        applicant: applicant || undefined,
        inventor: inventor || undefined,
        ipc: snapshot.ipc || ipc || fallbackIpc || undefined,
        publicationDate: publicationDate || undefined,
        googlePatentsUrl: extractionUrl,
        pdfUrl,
        source: 'google_patents'
    };
}

async function tryDownloadPdfFromGoogleUrl(url: string): Promise<Buffer | null> {
    const response = await googlePatentsGetWithRetry(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        validateStatus: () => true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
        }
    });
    if (response.status < 200 || response.status >= 300) return null;
    const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
    const buffer = Buffer.from(response.data);
    if ((contentType.includes('pdf') || buffer.slice(0, 4).toString() === '%PDF') && buffer.length > 1024) {
        return buffer;
    }
    if (!contentType.includes('html')) return null;
    const html = buffer.toString('utf8');
    const $ = cheerio.load(html);
    const nestedLinks = new Set<string>();
    const addNested = (value?: string | null) => {
        const href = normalizeText(value || '');
        if (!href) return;
        if (/\.pdf($|\?)/i.test(href) || /download=pdf/i.test(href) || /\/patent\/.*\/download/i.test(href)) {
            nestedLinks.add(href.startsWith('http') ? href : `https://patents.google.com${href.startsWith('/') ? '' : '/'}${href}`);
        }
    };
    addNested($('meta[name="citation_pdf_url"]').attr('content'));
    $('a[href], button[data-href]').each((_, el) => addNested($(el).attr('href') || $(el).attr('data-href')));
    for (const nested of Array.from(nestedLinks)) {
        const nestedResponse = await googlePatentsGetWithRetry(nested, {
            responseType: 'arraybuffer',
            timeout: 60000,
            validateStatus: () => true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
            }
        });
        if (nestedResponse.status < 200 || nestedResponse.status >= 300) continue;
        const nestedBuffer = Buffer.from(nestedResponse.data);
        const nestedType = String(nestedResponse.headers?.['content-type'] || '').toLowerCase();
        if ((nestedType.includes('pdf') || nestedBuffer.slice(0, 4).toString() === '%PDF') && nestedBuffer.length > 1024) {
            return nestedBuffer;
        }
    }
    return null;
}

type GooglePatentDocumentBundle = {
    pdf: Buffer;
    snapshot: GooglePatentBrowserSnapshot;
};

async function downloadGooglePatentsDocumentBundle(patentNumber: string): Promise<GooglePatentDocumentBundle | null> {
    if (!GOOGLE_PATENTS_FALLBACK_ENABLED) return null;
    const snapshot = await openGooglePatentViaBrowser(patentNumber);
    if (!snapshot) return null;
    const detailUrl = snapshot.detailUrl;
    const candidateLinks = new Set<string>();
    const addLink = (value?: string | null) => {
        const href = normalizeText(value || '');
        if (!href) return;
        if (/\.pdf($|\?)/i.test(href) || /download=pdf/i.test(href) || /\/patent\/.*\/download/i.test(href) || href.includes('/patent/')) {
            candidateLinks.add(href.startsWith('http') ? href : `https://patents.google.com${href.startsWith('/') ? '' : '/'}${href}`);
        }
    };
    snapshot.pdfCandidates.forEach((item) => addLink(item));
    const ptOrEn$ = cheerio.load(snapshot.portugueseHtml || snapshot.detailHtml);
    addLink(ptOrEn$('meta[name="citation_pdf_url"]').attr('content'));
    ptOrEn$('a[href], button[data-href]').each((_, el) => {
        const text = normalizeText(ptOrEn$(el).text()).toLowerCase();
        const aria = normalizeText(ptOrEn$(el).attr('aria-label') || '').toLowerCase();
        if (text.includes('download pdf') || aria.includes('download pdf')) {
            addLink(ptOrEn$(el).attr('href') || ptOrEn$(el).attr('data-href'));
        } else {
            addLink(ptOrEn$(el).attr('href'));
        }
    });
    addLink(`${detailUrl}?download=pdf`);
    if (snapshot.portugueseUrl) {
        addLink(snapshot.portugueseUrl);
        addLink(`${snapshot.portugueseUrl}?download=pdf`);
    }
    for (const link of Array.from(candidateLinks)) {
        const pdf = await tryDownloadPdfFromGoogleUrl(link);
        if (pdf) return { pdf, snapshot };
    }
    return null;
}

async function downloadGooglePatentsFullDocument(patentNumber: string): Promise<Buffer | null> {
    const bundle = await downloadGooglePatentsDocumentBundle(patentNumber);
    return bundle?.pdf || null;
}

async function fetchEspacenetUiBibliographicData(patentNumber: string): Promise<OpsBibliographicData | null> {
    if (!ESPACENET_UI_FALLBACK_ENABLED) return null;
    const candidate = extractGooglePatentNumberCandidates(patentNumber)[0];
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
    const codPedido = normalizeInpiCodPedido(patentNumber);
    if (!codPedido) return null;
    try {
        const module = await import('./inpiWorker');
        if (!module?.processInpiPatent) return null;
        await module.processInpiPatent(codPedido, { includeDocuments: false });
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
            source: 'inpi_worker'
        };
    } catch (error) {
        const message = serializeUnknownError(error);
        if (message.includes('INPI_MAINTENANCE')) {
            throw new Error('INPI_MAINTENANCE');
        }
        opsJobLog({ status: 'inpi_scrape_error', patentNumber, error: message });
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

async function fetchBibliographicDataWithFallbacks(patentNumber: string, _attemptNumber = 1): Promise<OpsBibliographicData | null> {
    const fromGooglePatents = await fetchGooglePatentsBibliographicData(patentNumber);
    if (fromGooglePatents) return fromGooglePatents;
    const fromOps = await fetchOpsBibliographicData(patentNumber);
    if (fromOps) return fromOps;
    if (patentNumber.startsWith('BR')) {
        const inpi = await fetchInpiScrapeBibliographicData(patentNumber).catch(() => null);
        if (inpi) return inpi;
    }
    return null;
}

async function applyBibliographicData(patentNumber: string, biblio: OpsBibliographicData) {
    await prismaAny.inpiPublication.updateMany({
        where: { patent_number: patentNumber },
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
                { numero_publicacao: { contains: patentNumber, mode: 'insensitive' } },
                { cod_pedido: patentNumber }
            ]
        },
        select: {
            cod_pedido: true,
            title: true,
            abstract: true,
            resumo_detalhado: true,
            applicant: true,
            inventors: true,
            ipc_codes: true
        }
    });
    if (linkedPatent) {
        await prisma.inpiPatent.update({
            where: { cod_pedido: linkedPatent.cod_pedido },
            data: {
                title: linkedPatent.title || biblio.title || undefined,
                abstract: linkedPatent.abstract || biblio.abstract || undefined,
                resumo_detalhado: linkedPatent.resumo_detalhado || biblio.detailedAbstract || biblio.abstract || undefined,
                applicant: linkedPatent.applicant || biblio.applicant || undefined,
                inventors: linkedPatent.inventors || biblio.inventor || undefined,
                ipc_codes: linkedPatent.ipc_codes || biblio.ipc || undefined
            }
        });
    }
}

async function processNextOpsBibliographicJob() {
    if (opsRunning || opsPaused) return;
    opsRunning = true;
    try {
        let job = await prismaAny.opsBibliographicJob.findFirst({
            where: { status: 'pending' },
            orderBy: [{ created_at: 'asc' }]
        });
        if (!job) {
            job = await prismaAny.opsBibliographicJob.findFirst({
                where: {
                    status: 'failed',
                    attempts: { lt: MAX_DOC_ATTEMPTS }
                },
                orderBy: [{ attempts: 'asc' }, { updated_at: 'asc' }, { created_at: 'asc' }]
            });
        }
        if (!job) return;
        const nextAttempt = job.attempts + 1;
        await prismaAny.opsBibliographicJob.update({
            where: { id: job.id },
            data: {
                status: 'running',
                started_at: new Date(),
                attempts: { increment: 1 },
                error: null
            }
        });

        try {
            const biblio = await fetchBibliographicDataWithFallbacks(job.patent_number, nextAttempt);
            if (!biblio) {
                const recentIndexing = isRecentPatentForIndexing(job.patent_number);
                const status = recentIndexing ? 'waiting_indexing' : 'not_found';
                const biblioStatus = recentIndexing ? 'pending' : 'not_found';
                const errorText = recentIndexing
                    ? `Dados bibliográficos ainda não indexados nas fontes para ${job.patent_number}`
                    : `Dados bibliográficos não encontrados nas fontes para ${job.patent_number}`;
                await prismaAny.opsBibliographicJob.update({
                    where: { id: job.id },
                    data: {
                        status,
                        error: errorText,
                        finished_at: new Date()
                    }
                });
                await prismaAny.inpiPublication.updateMany({
                    where: { patent_number: job.patent_number },
                    data: {
                        bibliographic_status: biblioStatus,
                        ops_error: errorText,
                        ops_last_sync_at: new Date()
                    }
                });
                opsJobLog({ jobId: job.id, patentNumber: job.patent_number, status, code: biblioStatus === 'pending' ? 'OPS_BIBLIO_PENDING_INDEX' : 'OPS_BIBLIO_NOT_FOUND', source: 'none' });
                return;
            }

            await applyBibliographicData(job.patent_number, biblio);

            await prismaAny.opsBibliographicJob.update({
                where: { id: job.id },
                data: {
                    status: 'completed',
                    docdb_id: biblio.docdbId,
                    error: biblio.source ? `source=${biblio.source}` : null,
                    finished_at: new Date()
                }
            });
            opsJobLog({ jobId: job.id, patentNumber: job.patent_number, status: 'completed', source: biblio.source || 'unknown', docdbId: biblio.docdbId || null });
        } catch (error: unknown) {
            const message = truncateError(errorMessage(error, 'Erro ao consultar bibliografia no OPS'));
            await prismaAny.opsBibliographicJob.update({
                where: { id: job.id },
                data: {
                    status: nextAttempt >= MAX_DOC_ATTEMPTS ? 'failed_permanent' : 'failed',
                    error: message,
                    finished_at: new Date()
                }
            });
            await prismaAny.inpiPublication.updateMany({
                where: { patent_number: job.patent_number },
                data: {
                    bibliographic_status: 'failed',
                    ops_error: message,
                    ops_last_sync_at: new Date()
                }
            });
            opsJobLog({ jobId: job.id, patentNumber: job.patent_number, status: nextAttempt >= MAX_DOC_ATTEMPTS ? 'failed_permanent' : 'failed', source: 'error', error: message });
        }
    } finally {
        opsRunning = false;
    }
}

async function processNextBigQueryBibliographicJob() {
    if (bqRunning || bqPaused || !GOOGLE_PATENTS_FALLBACK_ENABLED) return;
    bqRunning = true;
    try {
        let job = await prismaAny.bigQueryBibliographicJob.findFirst({
            where: { status: 'pending' },
            orderBy: [{ created_at: 'asc' }]
        });
        if (!job) {
            job = await prismaAny.bigQueryBibliographicJob.findFirst({
                where: {
                    status: 'failed',
                    attempts: { lt: MAX_DOC_ATTEMPTS }
                },
                orderBy: [{ attempts: 'asc' }, { updated_at: 'asc' }, { created_at: 'asc' }]
            });
        }
        if (!job) {
            const archivedError = await prismaAny.bigQueryBibliographicJob.findFirst({
                where: {
                    status: { in: ['failed_permanent', 'not_found', 'waiting_indexing'] }
                },
                orderBy: [{ updated_at: 'asc' }, { created_at: 'asc' }]
            });
            if (archivedError) {
                job = await prismaAny.bigQueryBibliographicJob.update({
                    where: { id: archivedError.id },
                    data: {
                        status: 'pending',
                        attempts: 0,
                        error: null,
                        started_at: null,
                        finished_at: null
                    }
                });
            }
        }
        if (!job) return;
        const nextAttempt = job.attempts + 1;
        await prismaAny.bigQueryBibliographicJob.update({
            where: { id: job.id },
            data: {
                status: 'running',
                started_at: new Date(),
                attempts: { increment: 1 },
                error: null
            }
        });

        try {
            const googleData = await fetchGooglePatentsBibliographicData(job.patent_number);
            const externalBiblio = googleData ? mapGoogleBiblioToSearchData(googleData) : null;
            if (!externalBiblio) {
                const status = 'not_found';
                const errorText = `Dados bibliográficos Google Patents não encontrados para ${job.patent_number}`;
                await prismaAny.bigQueryBibliographicJob.update({
                    where: { id: job.id },
                    data: { status, error: errorText, finished_at: new Date() }
                });
                await prismaAny.inpiPublication.updateMany({
                    where: { patent_number: job.patent_number },
                    data: {
                        bibliographic_status: 'not_found',
                        ops_error: 'source=google_patents not_found',
                        ops_last_sync_at: new Date()
                    }
                });
                return;
            }

            const biblio = mapBigQueryToBiblio(job.patent_number, externalBiblio);
            await applyBibliographicData(job.patent_number, biblio);
            await prismaAny.bigQueryBibliographicJob.update({
                where: { id: job.id },
                data: {
                    status: 'completed',
                    docdb_id: biblio.docdbId,
                    error: `source=${externalBiblio.source || 'google_patents'}`,
                    finished_at: new Date()
                }
            });
        } catch (error: unknown) {
            const message = truncateError(errorMessage(error, 'Erro ao consultar bibliografia no Google Patents'));
            await prismaAny.bigQueryBibliographicJob.update({
                where: { id: job.id },
                data: {
                    status: nextAttempt >= MAX_DOC_ATTEMPTS ? 'failed_permanent' : 'failed',
                    error: message,
                    finished_at: new Date()
                }
            });
        }
    } finally {
        bqRunning = false;
    }
}

async function processNextDocumentJob() {
    if (docRunning || docsPaused) return;
    docRunning = true;
    try {
        let job = await prisma.documentDownloadJob.findFirst({
            where: { status: 'pending_google_patents' },
            orderBy: [{ created_at: 'asc' }]
        });
        if (!job) {
            job = await prisma.documentDownloadJob.findFirst({
                where: { status: 'pending_ops' },
                orderBy: [{ updated_at: 'asc' }, { created_at: 'asc' }]
            });
        }
        if (!job) {
            job = await prisma.documentDownloadJob.findFirst({
                where: { status: 'pending' },
                orderBy: [{ created_at: 'asc' }]
            });
        }
        if (!job) {
            job = await prisma.documentDownloadJob.findFirst({
                where: {
                    status: { in: ['failed', 'failed_google_patents', 'failed_ops'] },
                    attempts: { lt: MAX_DOC_ATTEMPTS }
                },
                orderBy: [{ attempts: 'asc' }, { updated_at: 'asc' }, { created_at: 'asc' }]
            });
        }
        if (!job) return;
        const stage: 'google_patents' | 'ops' = job.status === 'pending_ops' || job.status === 'failed_ops' ? 'ops' : 'google_patents';
        const nextAttempt = job.attempts + 1;
        await prisma.documentDownloadJob.update({
            where: { id: job.id },
            data: {
                status: stage === 'ops' ? 'running_ops' : 'running_google_patents',
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
                const existingPdf = await readObjectBufferFromS3(existingStorageKey);
                const existingQuality = existingPdf ? isLikelyCompletePatentPdf(existingPdf) : { ok: false, pages: 0, reason: 'storage_read_failed' };
                if (existingQuality.ok) {
                    await ensureDerivedStorageAssets(publicationNumber, existingPdf as Buffer).catch(() => undefined);
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
                documentJobLog({
                    jobId: job.id,
                    patentId: job.patent_id,
                    publicationNumber,
                    status: 'failed',
                    code: 'DOC_BUCKET_FILE_TOO_SHORT',
                    storageKey: existingStorageKey,
                    pages: existingQuality.pages,
                    reason: existingQuality.reason
                });
                await cleanupInvalidDocumentAssets(existingStorageKey, publicationNumber).catch(() => undefined);
            }

            const shouldPreferInpiDocForRecentDispatch = async (): Promise<boolean> => {
                const publication = await prismaAny.inpiPublication.findFirst({
                    where: {
                        patent_id: job.patent_id,
                        rpi: String(job.rpi_number || ''),
                        despacho_code: { in: ['3.1', '1.3', '16.1'] }
                    },
                    select: {
                        date: true,
                        despacho_code: true
                    },
                    orderBy: { created_at: 'desc' }
                }).catch(() => null);
                const publicationDate = parseBrDateToIso(publication?.date || '');
                if (!publicationDate) return false;
                const sixMonthsAgo = new Date();
                sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
                return publicationDate >= sixMonthsAgo;
            };
            if (await shouldPreferInpiDocForRecentDispatch()) {
                await queueInpiProcessingJob({
                    patentNumber: job.patent_id,
                    priority: 99,
                    mode: 'document'
                }).catch(() => undefined);
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: {
                        status: 'waiting_inpi',
                        error: truncateError(`DOC_RECENT_DISPATCH_DIRECT_INPI publication=${publicationNumber} dispatch=3.1|1.3|16.1`),
                        finished_at: new Date()
                    }
                });
                documentJobLog({
                    jobId: job.id,
                    patentId: job.patent_id,
                    publicationNumber,
                    status: 'waiting_inpi',
                    code: 'DOC_RECENT_DISPATCH_DIRECT_INPI'
                });
                return;
            }

            const googleSearchCandidates = Array.from(new Set([
                publicationNumber,
                normalizeText(patent.numero_publicacao || ''),
                normalizeText(job.patent_id || ''),
                normalizeText(patent.cod_pedido || '')
            ].flatMap((value) => extractGooglePatentNumberCandidates(value))
                .filter(Boolean)));

            const tryGooglePatentsFallback = async (reasonCode: string): Promise<boolean> => {
                for (const candidate of googleSearchCandidates) {
                    try {
                        const bundle = await downloadGooglePatentsDocumentBundle(candidate);
                        if (!bundle?.pdf || bundle.pdf.length < 1024) continue;
                        const quality = isLikelyCompletePatentPdf(bundle.pdf);
                        if (!quality.ok) {
                            googlePatentsMetrics.shortPdfRejected += 1;
                            documentJobLog({
                                jobId: job.id,
                                patentId: job.patent_id,
                                publicationNumber,
                                status: 'failed',
                                code: `${reasonCode}_GOOGLE_PATENTS_SHORT_PDF`,
                                candidate,
                                pages: quality.pages,
                                reason: quality.reason
                            });
                            continue;
                        }
                        const safeBase = publicationNumber.replace(/[^\w.-]/g, '_');
                        const baseKey = `patent-docs/${safeBase}`;
                        const fullKey = `${baseKey}/full_document.pdf`;
                        await uploadPdfToS3(fullKey, bundle.pdf);
                        await ensureDerivedStorageAssets(publicationNumber, bundle.pdf);
                        await prisma.documentDownloadJob.update({
                            where: { id: job.id },
                            data: {
                                status: 'completed',
                                storage_key: fullKey,
                                finished_at: new Date(),
                                publication_number: publicationNumber,
                                error: truncateError(`${reasonCode} source=google_patents candidate=${candidate}`)
                            }
                        });
                        documentJobLog({
                            jobId: job.id,
                            patentId: job.patent_id,
                            publicationNumber,
                            status: 'completed',
                            code: `${reasonCode}_GOOGLE_PATENTS`,
                            storageKey: fullKey,
                            candidate
                        });
                        return true;
                    } catch (error) {
                        documentJobLog({
                            jobId: job.id,
                            patentId: job.patent_id,
                            publicationNumber,
                            status: 'failed',
                            code: `${reasonCode}_GOOGLE_PATENTS_FAILED`,
                            detail: serializeUnknownError(error),
                            candidate
                        });
                    }
                }
                return false;
            };

            const googlePrimaryRecovered = stage === 'google_patents'
                ? await tryGooglePatentsFallback('DOC_PRIMARY')
                : false;
            
            const publicationBiblio = await prismaAny.inpiPublication.findFirst({
                where: { patent_number: publicationNumber, bibliographic_status: 'completed' },
                orderBy: { created_at: 'desc' },
                select: {
                    ops_title: true,
                    ops_applicant: true,
                    ops_inventor: true,
                    ops_ipc: true,
                    ops_publication_date: true
                }
            }).catch(() => null);
            const patentBiblio = await prisma.inpiPatent.findUnique({
                where: { cod_pedido: job.patent_id },
                select: {
                    title: true,
                    resumo_detalhado: true,
                    applicant: true,
                    inventors: true,
                    ipc_codes: true,
                    filing_date: true
                }
            }).catch(() => null);
            const hasDetailedAbstract = Boolean(normalizeText(patentBiblio?.resumo_detalhado || ''));
            const hasStoredBiblio = hasBasicBibliographicData({
                title: publicationBiblio?.ops_title || patentBiblio?.title,
                applicant: publicationBiblio?.ops_applicant || patentBiblio?.applicant,
                inventor: publicationBiblio?.ops_inventor || patentBiblio?.inventors,
                ipc: publicationBiblio?.ops_ipc || patentBiblio?.ipc_codes,
                filingDate: publicationBiblio?.ops_publication_date || patentBiblio?.filing_date
            });
            let fallbackBiblio: BigQueryBibliographicData | null = null;
            if (!hasStoredBiblio || !hasDetailedAbstract) {
                for (const candidate of googleSearchCandidates) {
                    const googleBiblio = await fetchGooglePatentsBibliographicData(candidate);
                    if (googleBiblio) {
                        fallbackBiblio = mapGoogleBiblioToSearchData(googleBiblio);
                        break;
                    }
                }
            }
            if (fallbackBiblio) {
                await prisma.inpiPatent.update({
                    where: { cod_pedido: job.patent_id },
                    data: {
                        title: fallbackBiblio.title || undefined,
                        abstract: fallbackBiblio.abstract || undefined,
                        resumo_detalhado: fallbackBiblio.detailedAbstract || fallbackBiblio.abstract || undefined,
                        applicant: fallbackBiblio.applicant || undefined,
                        inventors: fallbackBiblio.inventors || undefined,
                        ipc_codes: fallbackBiblio.ipc || undefined
                    }
                }).catch(() => undefined);
                await prismaAny.inpiPublication.updateMany({
                    where: { patent_number: publicationNumber },
                    data: {
                        bibliographic_status: 'completed',
                        ops_title: fallbackBiblio.title || null,
                        ops_applicant: fallbackBiblio.applicant || null,
                        ops_inventor: fallbackBiblio.inventors || null,
                        ops_ipc: fallbackBiblio.ipc || null,
                        ops_publication_date: fallbackBiblio.publicationDate || fallbackBiblio.filingDate || null,
                        ops_error: `source=${fallbackBiblio.source || 'google_patents'}`,
                        ops_last_sync_at: new Date()
                    }
                }).catch(() => undefined);
            }

            if (googlePrimaryRecovered) return;

            if (stage === 'google_patents') {
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: {
                        status: 'pending_ops',
                        error: truncateError(`DOC_GOOGLE_PATENTS_NOT_FOUND publication=${publicationNumber}`),
                        finished_at: null
                    }
                });
                documentJobLog({
                    jobId: job.id,
                    patentId: job.patent_id,
                    publicationNumber,
                    candidatesSearched: googleSearchCandidates,
                    status: 'pending_ops',
                    code: 'DOC_QUEUE_OPS_AFTER_GOOGLE'
                });
                return;
            }

            let opsBundle: { pdf: Buffer; docdbId: string } | null = null;
            for (const candidate of googleSearchCandidates.length ? googleSearchCandidates : [publicationNumber]) {
                opsBundle = await downloadOpsPatentPdf(candidate).catch(() => null);
                if (opsBundle?.pdf) break;
            }
            if (opsBundle?.pdf) {
                const safeBase = publicationNumber.replace(/[^\w.-]/g, '_');
                const baseKey = `patent-docs/${safeBase}`;
                const fullKey = `${baseKey}/full_document.pdf`;
                await uploadPdfToS3(fullKey, opsBundle.pdf);
                await ensureDerivedStorageAssets(publicationNumber, opsBundle.pdf);
                await prisma.documentDownloadJob.update({
                    where: { id: job.id },
                    data: {
                        status: 'completed',
                        storage_key: fullKey,
                        finished_at: new Date(),
                        publication_number: publicationNumber,
                        error: truncateError(`DOC_PRIMARY source=ops_api docdb=${opsBundle.docdbId}`)
                    }
                });
                documentJobLog({
                    jobId: job.id,
                    patentId: job.patent_id,
                    publicationNumber,
                    status: 'completed',
                    code: 'DOC_PRIMARY_OPS_API',
                    storageKey: fullKey,
                    docdbId: opsBundle.docdbId
                });
                return;
            }

            await queueInpiProcessingJob({
                patentNumber: job.patent_id,
                priority: 95,
                mode: 'document'
            }).catch(() => undefined);
            const errorText = `DOC_FALLBACK_QUEUED_INPI publication=${publicationNumber} source_chain=google_patents>ops_api>inpi_worker candidates=${googleSearchCandidates.join('|')}`;
            await prisma.documentDownloadJob.update({
                where: { id: job.id },
                data: { status: 'waiting_inpi', error: truncateError(errorText), finished_at: new Date() }
            });
            documentJobLog({
                jobId: job.id,
                patentId: job.patent_id,
                publicationNumber,
                candidatesSearched: googleSearchCandidates,
                status: 'waiting_inpi',
                code: 'DOC_FALLBACK_QUEUED_INPI'
            });
            return;
        } catch (error: unknown) {
            const raw = serializeUnknownError(error);
            const message = truncateError(`DOC_RUNTIME_ERROR ${raw}`);
            const lower = message.toLowerCase();
            const notFound = lower.includes('not found') || lower.includes('404') || lower.includes('não encontrado');
            if (notFound && stage === 'ops') {
                await queueInpiProcessingJob({
                    patentNumber: job.patent_id,
                    priority: 95,
                    mode: 'document'
                }).catch(() => undefined);
            }
            await prisma.documentDownloadJob.update({
                where: { id: job.id },
                data: {
                    status: notFound
                        ? (stage === 'ops' ? 'waiting_inpi' : 'pending_ops')
                        : (nextAttempt >= MAX_DOC_ATTEMPTS ? 'failed_permanent' : (stage === 'ops' ? 'failed_ops' : 'failed_google_patents')),
                    error: message,
                    finished_at: new Date()
                }
            });
            documentJobLog({
                jobId: job.id,
                patentId: job.patent_id,
                status: notFound
                    ? (stage === 'ops' ? 'waiting_inpi' : 'pending_ops')
                    : (nextAttempt >= MAX_DOC_ATTEMPTS ? 'failed_permanent' : (stage === 'ops' ? 'failed_ops' : 'failed_google_patents')),
                code: notFound ? 'DOC_RUNTIME_NOT_FOUND' : 'DOC_RUNTIME_FAILURE',
                detail: raw
            });
        }
    } finally {
        docRunning = false;
    }
}

export function getBackgroundWorkerState() {
    const inpiRunning = inpiTextRunning || inpiDocRunning;
    return {
        rpiPaused,
        docsPaused,
        opsPaused,
        inpiPaused,
        bqPaused,
        rpiRunning,
        docRunning,
        opsRunning,
        inpiRunning,
        inpiTextRunning,
        inpiDocRunning,
        bqRunning,
        opsCircuitOpen: opsCircuitOpenUntil > Date.now(),
        opsCircuitOpenUntil: opsCircuitOpenUntil > Date.now() ? new Date(opsCircuitOpenUntil).toISOString() : null,
        googlePatentsCircuitOpen: googlePatentsCircuitOpenUntil > Date.now(),
        googlePatentsCircuitOpenUntil: googlePatentsCircuitOpenUntil > Date.now() ? new Date(googlePatentsCircuitOpenUntil).toISOString() : null,
        googlePatentsMetrics: { ...googlePatentsMetrics },
        bigQueryEnabled: BIGQUERY_ENABLED,
        bigQueryProject: BIGQUERY_BILLING_PROJECT || null,
        bigQueryFirstEnabled: BIGQUERY_FIRST_ENABLED,
        inpiEnabled: INPI_SCRAPE_FALLBACK_ENABLED,
        googlePatentsEnabled: GOOGLE_PATENTS_FALLBACK_ENABLED
    };
}

export async function debugBigQueryLookup(publicationNumber: string) {
    const normalized = normalizePublicationForBigQuery(publicationNumber);
    const parsed = parsePublicationNumber(normalized);
    const diagnostics: Record<string, unknown> = {};
    try {
        const ping = await runBigQueryQuery({ query: 'SELECT 1 AS ok', useLegacySql: false });
        diagnostics.ping = Boolean(ping?.rows?.length);
    } catch (error) {
        diagnostics.pingError = serializeUnknownError(error);
    }
    if (parsed?.country && parsed?.docNumber) {
        try {
            const probe = await runBigQueryQuery({
                query: `
                  SELECT
                    COUNT(1) AS exact_hits,
                    COUNTIF(UPPER(IFNULL(kind_code, '')) = @kindCode) AS same_kind_hits
                  FROM \`patents-public-data.patents.publications\`
                  WHERE UPPER(IFNULL(country_code, '')) = @country
                    AND REGEXP_REPLACE(UPPER(IFNULL(publication_number, '')), r'[^0-9A-Z]', '') IN (@docNumber, @docNoZero)
                `,
                useLegacySql: false,
                parameterMode: 'NAMED',
                queryParameters: [
                    { name: 'country', parameterType: { type: 'STRING' }, parameterValue: { value: parsed.country } },
                    { name: 'docNumber', parameterType: { type: 'STRING' }, parameterValue: { value: parsed.docNumber } },
                    { name: 'docNoZero', parameterType: { type: 'STRING' }, parameterValue: { value: parsed.docNumber.replace(/^0+/, '') || parsed.docNumber } },
                    { name: 'kindCode', parameterType: { type: 'STRING' }, parameterValue: { value: parsed.kindCode || '' } }
                ]
            });
            diagnostics.probeRows = probe?.rows || [];
        } catch (error) {
            diagnostics.probeError = serializeUnknownError(error);
        }
    }
    const result = normalized ? await fetchBigQueryBibliographicData(normalized) : null;
    return {
        enabled: BIGQUERY_ENABLED,
        project: BIGQUERY_BILLING_PROJECT || null,
        publicationNumber,
        normalized,
        parsed,
        diagnostics,
        found: Boolean(result),
        result
    };
}

export async function debugGooglePatentsLookup(publicationNumber: string) {
    const normalized = normalizePublicationNumber(publicationNumber);
    const bibliographic = normalized ? await fetchGooglePatentsBibliographicData(normalized) : null;
    const pdfBuffer = normalized ? await downloadGooglePatentsFullDocument(normalized) : null;
    return {
        publicationNumber,
        normalized,
        found: Boolean(bibliographic),
        bibliographic,
        pdfFound: Boolean(pdfBuffer && pdfBuffer.length > 1024),
        pdfBytes: pdfBuffer?.length || 0
    };
}

export async function debugInpiLookup(patentNumber: string) {
    const codPedido = normalizeInpiCodPedido(patentNumber);
    const module = await import('./inpiScraper');
    if (!module?.debugInpiScrapeSteps) {
        return { ok: false, patentNumber, codPedido, steps: [{ step: 'load_module', message: 'debugInpiScrapeSteps indisponível' }] };
    }
    const result = await module.debugInpiScrapeSteps(codPedido);
    return { patentNumber, ...result };
}

export function setBackgroundWorkerPause(queue: 'rpi' | 'docs' | 'ops' | 'inpi' | 'bigquery' | 'all', paused: boolean) {
    if (queue === 'all' || queue === 'rpi') rpiPaused = paused;
    if (queue === 'all' || queue === 'docs') docsPaused = paused;
    if (queue === 'all' || queue === 'ops') opsPaused = paused;
    if (queue === 'all' || queue === 'inpi') inpiPaused = paused;
    if (queue === 'all' || queue === 'bigquery') bqPaused = paused;
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
            status: 'pending_google_patents',
            attempts: 0,
            error: null,
            started_at: null,
            finished_at: null
        }
    });
    processNextDocumentJob().catch(() => undefined);
    return updated;
}

export async function retryOpsBibliographicJob(jobId: string, preferBigQuery = false) {
    const updated = await prismaAny.opsBibliographicJob.update({
        where: { id: jobId },
        data: {
            status: 'pending',
            attempts: preferBigQuery ? 1 : 0,
            error: null,
            started_at: null,
            finished_at: null
        }
    });
    processNextOpsBibliographicJob().catch(() => undefined);
    return updated;
}

export async function retryAllRpiErrorJobs(ids?: string[], preferBigQuery = false) {
    const where = ids && ids.length > 0
        ? { id: { in: Array.from(new Set(ids)) }, status: { in: ['failed', 'failed_permanent'] } }
        : { status: { in: ['failed', 'failed_permanent'] } };
    const result = await prisma.rpiImportJob.updateMany({
        where,
        data: {
            status: 'pending',
            attempts: preferBigQuery ? 1 : 0,
            error: null,
            started_at: null,
            finished_at: null
        }
    });
    processNextRpiImportJob().catch(() => undefined);
    return { updated: result.count };
}

export async function retryAllDocumentErrorJobs(ids?: string[]) {
    const requeueStatuses = [
        'failed',
        'failed_permanent',
        'failed_google_patents',
        'failed_ops',
        'not_found',
        'waiting_indexing',
        'waiting_inpi',
        'waiting_inpi_text',
        'pending_ops',
        'running',
        'running_google_patents',
        'running_ops'
    ];
    const where = ids && ids.length > 0
        ? { id: { in: Array.from(new Set(ids)) }, status: { in: requeueStatuses } }
        : { status: { in: requeueStatuses } };
    const result = await prisma.documentDownloadJob.updateMany({
        where,
        data: {
            status: 'pending_google_patents',
            attempts: 0,
            error: null,
            started_at: null,
            finished_at: null
        }
    });
    processNextDocumentJob().catch(() => undefined);
    return { updated: result.count };
}

export async function retryAllOpsErrorJobs(ids?: string[], preferBigQuery = false) {
    const where = ids && ids.length > 0
        ? { id: { in: Array.from(new Set(ids)) }, status: { in: ['failed', 'failed_permanent', 'not_found', 'waiting_indexing'] } }
        : { status: { in: ['failed', 'failed_permanent', 'not_found', 'waiting_indexing'] } };
    const result = await prismaAny.opsBibliographicJob.updateMany({
        where,
        data: {
            status: 'pending',
            attempts: preferBigQuery ? 1 : 0,
            error: null,
            started_at: null,
            finished_at: null
        }
    });
    processNextOpsBibliographicJob().catch(() => undefined);
    return { updated: result.count };
}

export async function enqueueBigQueryReprocessing(patentNumbers?: string[], sourceJobType?: string) {
    const values = Array.from(new Set((patentNumbers || [])
        .map((item) => normalizeText(item).toUpperCase())
        .filter(Boolean)));
    if (!values.length) return { enqueued: 0 };
    const result = await prismaAny.bigQueryBibliographicJob.createMany({
        data: values.map((patentNumber) => ({
            patent_number: patentNumber,
            status: 'pending',
            attempts: 0,
            source_job_type: sourceJobType || null,
            created_at: new Date()
        })),
        skipDuplicates: true
    });
    processNextBigQueryBibliographicJob().catch(() => undefined);
    return { enqueued: result.count };
}

export async function enqueueIncompletePatentReprocessing(limit = 500) {
    const take = Math.max(1, Math.min(5000, Number(limit) || 500));
    const incompletePatents = await prisma.inpiPatent.findMany({
        where: {
            OR: [
                { resumo_detalhado: null },
                { resumo_detalhado: '' },
                { applicant: null },
                { applicant: '' },
                { ipc_codes: null },
                { ipc_codes: '' },
                {
                    document_jobs: {
                        none: {
                            status: 'completed',
                            storage_key: { not: null }
                        }
                    }
                }
            ]
        },
        select: {
            cod_pedido: true,
            numero_publicacao: true
        },
        orderBy: { updated_at: 'asc' },
        take
    });
    const patentNumbers = new Set<string>();
    let docJobsQueued = 0;
    for (const patent of incompletePatents) {
        const codPedido = normalizeText(patent.cod_pedido);
        const publicationNumber = normalizeText(patent.numero_publicacao || codPedido);
        if (!codPedido) continue;
        patentNumbers.add(publicationNumber || codPedido);
        await prisma.documentDownloadJob.upsert({
            where: { patent_id: codPedido },
            update: {
                publication_number: publicationNumber || undefined,
                status: 'pending',
                attempts: 0,
                error: null,
                started_at: null,
                finished_at: null
            },
            create: {
                patent_id: codPedido,
                publication_number: publicationNumber || codPedido,
                status: 'pending'
            }
        }).catch(() => undefined);
        docJobsQueued += 1;
    }
    const biblioResult = await enqueueBigQueryReprocessing(Array.from(patentNumbers), 'google_patents_incomplete_reprocess');
    processNextDocumentJob().catch(() => undefined);
    return {
        selected: incompletePatents.length,
        bibliographicEnqueued: biblioResult.enqueued,
        documentJobsQueued: docJobsQueued
    };
}

export async function enqueueShortDocumentReprocessing(limit = 500, maxPages = 1) {
    const take = Math.max(1, Math.min(5000, Number(limit) || 500));
    const pagesThreshold = Math.max(1, Math.min(3, Number(maxPages) || 1));
    const rows = await prisma.documentDownloadJob.findMany({
        where: {
            status: 'completed',
            storage_key: { not: null }
        },
        select: {
            id: true,
            patent_id: true,
            publication_number: true,
            storage_key: true,
            updated_at: true
        },
        orderBy: { updated_at: 'asc' },
        take
    });
    let scanned = 0;
    let requeued = 0;
    for (const row of rows) {
        scanned += 1;
        const storageKey = normalizeText(row.storage_key || '');
        if (!storageKey) continue;
        const pdf = await readObjectBufferFromS3(storageKey);
        if (!pdf) continue;
        const pages = estimatePdfPageCount(pdf);
        if (pages > pagesThreshold) continue;
        await cleanupInvalidDocumentAssets(storageKey, row.publication_number || row.patent_id).catch(() => undefined);
        await prisma.documentDownloadJob.update({
            where: { id: row.id },
            data: {
                status: 'pending',
                attempts: 0,
                storage_key: null,
                error: truncateError(`DOC_REPROCESS_SHORT_PDF pages=${pages} previous_key=${storageKey}`),
                started_at: null,
                finished_at: null
            }
        }).catch(() => undefined);
        requeued += 1;
    }
    processNextDocumentJob().catch(() => undefined);
    return { scanned, requeued, limit: take, maxPages: pagesThreshold };
}

export async function enqueueAllProcessedPatentsDocumentAudit(batchSize = 1000) {
    const take = Math.max(100, Math.min(5000, Number(batchSize) || 1000));
    let cursor: string | null = null;
    let scanned = 0;
    let queued = 0;
    for (;;) {
        const rows = await prisma.inpiPatent.findMany({
            ...(cursor ? { cursor: { cod_pedido: cursor }, skip: 1 } : {}),
            orderBy: { cod_pedido: 'asc' },
            take,
            select: {
                cod_pedido: true,
                numero_publicacao: true
            }
        }) as Array<{ cod_pedido: string; numero_publicacao: string | null }>;
        if (rows.length === 0) break;
        for (const patent of rows) {
            const codPedido = normalizeText(patent.cod_pedido);
            if (!codPedido) continue;
            const publicationNumber = normalizeText(patent.numero_publicacao || codPedido);
            await prisma.documentDownloadJob.upsert({
                where: { patent_id: codPedido },
                update: {
                    publication_number: publicationNumber || undefined,
                    status: 'pending',
                    attempts: 0,
                    error: null,
                    started_at: null,
                    finished_at: null
                },
                create: {
                    patent_id: codPedido,
                    publication_number: publicationNumber || codPedido,
                    status: 'pending'
                }
            }).catch(() => undefined);
            queued += 1;
            scanned += 1;
        }
        cursor = rows[rows.length - 1]?.cod_pedido || null;
        if (!cursor) break;
    }
    processNextDocumentJob().catch(() => undefined);
    return { scanned, queued, batchSize: take };
}

export async function retryBigQueryJob(jobId: string) {
    const updated = await prismaAny.bigQueryBibliographicJob.update({
        where: { id: jobId },
        data: {
            status: 'pending',
            attempts: 0,
            error: null,
            started_at: null,
            finished_at: null
        }
    });
    processNextBigQueryBibliographicJob().catch(() => undefined);
    return updated;
}

export async function retryAllBigQueryErrorJobs(ids?: string[]) {
    const where = ids && ids.length > 0
        ? { id: { in: Array.from(new Set(ids)) }, status: { in: ['failed', 'failed_permanent', 'not_found', 'waiting_indexing'] } }
        : { status: { in: ['failed', 'failed_permanent', 'not_found', 'waiting_indexing'] } };
    const result = await prismaAny.bigQueryBibliographicJob.updateMany({
        where,
        data: {
            status: 'pending',
            attempts: 0,
            error: null,
            started_at: null,
            finished_at: null
        }
    });
    processNextBigQueryBibliographicJob().catch(() => undefined);
    return { updated: result.count };
}

export async function enqueueBigQueryFromFailedSources(source: 'docs' | 'ops' | 'inpi' | 'all' = 'all') {
    const patentNumbers = new Set<string>();
    if (source === 'all' || source === 'ops') {
        const rows = await prismaAny.opsBibliographicJob.findMany({
            where: { status: { in: ['failed', 'failed_permanent', 'not_found', 'waiting_indexing'] } },
            select: { patent_number: true },
            take: 2000
        });
        rows.forEach((row: any) => {
            const value = normalizeText(row.patent_number).toUpperCase();
            if (value) patentNumbers.add(value);
        });
    }
    if (source === 'all' || source === 'docs') {
        const rows = await prisma.documentDownloadJob.findMany({
            where: { status: { in: ['failed', 'failed_permanent', 'not_found', 'waiting_indexing'] } },
            select: { publication_number: true, patent_id: true },
            take: 2000
        });
        rows.forEach((row: any) => {
            const value = normalizeText(row.publication_number || row.patent_id).toUpperCase();
            if (value) patentNumbers.add(value);
        });
    }
    if (source === 'all' || source === 'inpi') {
        const rows = await prismaAny.inpiProcessingJob.findMany({
            where: { status: { in: ['failed', 'failed_permanent'] } },
            select: { patent_number: true },
            take: 2000
        });
        rows.forEach((row: any) => {
            const value = normalizeText(row.patent_number).toUpperCase();
            if (value) patentNumbers.add(value);
        });
    }
    const numbers = Array.from(patentNumbers);
    const result = await enqueueBigQueryReprocessing(numbers, source);
    return { selected: numbers.length, enqueued: result.enqueued, source };
}

// INPI Workers - separados por modo (text/doc)
async function processNextInpiJobByMode(mode: 'text' | 'document'): Promise<boolean> {
    if (inpiPaused) return false;
    if (mode === 'text' && inpiTextRunning) return false;
    if (mode === 'document' && inpiDocRunning) return false;
    if (mode === 'text') inpiTextRunning = true;
    else inpiDocRunning = true;
    const modeTag = `mode=${mode}`;
    const modeFilter = mode === 'document'
        ? { error: { contains: 'mode=document' } }
        : { NOT: { error: { contains: 'mode=document' } } };
    try {
        let job = await prisma.inpiProcessingJob.findFirst({
            where: { status: 'pending', ...modeFilter },
            orderBy: [{ priority: 'desc' }, { created_at: 'asc' }]
        });
        if (!job) {
            job = await prisma.inpiProcessingJob.findFirst({
                where: {
                    status: 'failed',
                    attempts: { lt: 3 },
                    ...modeFilter
                },
                orderBy: [{ attempts: 'asc' }, { updated_at: 'asc' }, { created_at: 'asc' }]
            });
        }
        if (!job) return false;
        const includeDocuments = mode === 'document';
        const nextAttempt = job.attempts + 1;
        const claimed = await prisma.inpiProcessingJob.updateMany({
            where: { id: job.id, status: job.status },
            data: {
                status: 'running',
                started_at: new Date(),
                attempts: { increment: 1 },
                error: modeTag
            }
        });
        if (claimed.count === 0) return false;
        try {
            console.log(`🔍 INPI Worker ${mode.toUpperCase()} processando: ${job.patent_number}`);
            const { processInpiPatent } = await import('./inpiWorker');
            const result = await processInpiPatent(job.patent_number, { includeDocuments });
            if (includeDocuments) {
                const publicationNumber = normalizeText((result as any)?.numeroProcesso || '');
                const docs = Array.isArray((result as any)?.documentos) ? (result as any).documentos : [];
                let uploadedStorageKey: string | null = null;
                for (const doc of docs) {
                    const localPath = normalizeText(doc?.caminho || '');
                    if (!doc?.baixado || !localPath) continue;
                    try {
                        const pdf = await fs.readFile(localPath);
                        const quality = isLikelyCompletePatentPdf(pdf);
                        if (!quality.ok) continue;
                        const safeBase = (publicationNumber || job.patent_number).replace(/[^\w.-]/g, '_');
                        const fullKey = `patent-docs/${safeBase}/full_document.pdf`;
                        await uploadPdfToS3(fullKey, pdf);
                        await ensureDerivedStorageAssets(publicationNumber || job.patent_number, pdf);
                        uploadedStorageKey = fullKey;
                        break;
                    } catch {
                        continue;
                    }
                }
                if (uploadedStorageKey) {
                    await prisma.documentDownloadJob.updateMany({
                        where: { patent_id: job.patent_number },
                        data: {
                            status: 'completed',
                            storage_key: uploadedStorageKey,
                            finished_at: new Date(),
                            publication_number: publicationNumber || undefined,
                            error: 'source=inpi_worker'
                        }
                    }).catch(() => undefined);
                } else {
                    await prisma.documentDownloadJob.updateMany({
                        where: { patent_id: job.patent_number },
                        data: {
                            status: 'not_found',
                            finished_at: new Date(),
                            error: 'DOC_INPI_FALLBACK_NOT_FOUND source=inpi_worker'
                        }
                    }).catch(() => undefined);
                }
            } else {
                await prisma.documentDownloadJob.updateMany({
                    where: {
                        patent_id: job.patent_number,
                        status: 'waiting_inpi_text'
                    },
                    data: {
                        status: 'pending_google_patents',
                        error: null,
                        finished_at: null
                    }
                }).catch(() => undefined);
            }
            await prisma.inpiProcessingJob.update({
                where: { id: job.id },
                data: {
                    status: 'completed',
                    finished_at: new Date(),
                    result_data: result as any
                }
            });
            console.log(`✅ INPI Worker ${mode.toUpperCase()} concluído: ${job.patent_number}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`❌ INPI Worker ${mode.toUpperCase()} falhou: ${job.patent_number} - ${errorMessage}`);
            const infraBrowserError = errorMessage.includes('INPI_BROWSER_LAUNCH_FAILED')
                || errorMessage.includes('Failed to launch the browser process')
                || errorMessage.includes('spawn ')
                || errorMessage.includes(' ENOENT');
            await prisma.inpiProcessingJob.update({
                where: { id: job.id },
                data: {
                    status: infraBrowserError || nextAttempt >= 3 ? 'failed_permanent' : 'failed',
                    finished_at: new Date(),
                    error: `${modeTag} ${errorMessage}`.trim()
                }
            });
            if (!includeDocuments) {
                await prisma.documentDownloadJob.updateMany({
                    where: {
                        patent_id: job.patent_number,
                        status: 'waiting_inpi_text'
                    },
                    data: {
                        status: 'pending_google_patents',
                        error: truncateError(`INPI_TEXT_FAILED_FALLBACK_TO_GOOGLE ${errorMessage}`),
                        finished_at: null
                    }
                }).catch(() => undefined);
            }
        }
        lastInpiJobCompletedAt = Date.now();
        return true;
    } catch (error) {
        console.error(`Erro no INPI Worker ${mode.toUpperCase()} loop:`, error);
        return false;
    } finally {
        if (mode === 'text') inpiTextRunning = false;
        else inpiDocRunning = false;
    }
}

async function processNextInpiJobs() {
    if (inpiPaused || inpiTextRunning || inpiDocRunning) return;
    const acquireLock = async (): Promise<boolean> => {
        try {
            const rows = await prisma.$queryRawUnsafe<any[]>(
                `select pg_try_advisory_lock($1::bigint) as locked`,
                INPI_WORKER_LOCK_KEY
            );
            inpiDbLockHeld = Boolean(rows?.[0]?.locked);
            return inpiDbLockHeld;
        } catch {
            inpiDbLockHeld = true;
            return true;
        }
    };
    const releaseLock = async () => {
        if (!inpiDbLockHeld) return;
        try {
            await prisma.$queryRawUnsafe<any[]>(
                `select pg_advisory_unlock($1::bigint)`,
                INPI_WORKER_LOCK_KEY
            );
        } catch {
        }
        inpiDbLockHeld = false;
    };
    const recoverStaleRunningJobs = async () => {
        const staleSince = new Date(Date.now() - INPI_STALE_RUNNING_MS);
        await prisma.inpiProcessingJob.updateMany({
            where: {
                status: 'running',
                started_at: { lt: staleSince }
            },
            data: {
                status: 'failed',
                finished_at: new Date(),
                error: 'INPI_STALE_RUNNING_AUTO_RECOVERY'
            }
        }).catch(() => undefined);
    };
    if (!(await acquireLock())) return;
    try {
        await recoverStaleRunningJobs();
        const currentlyRunning = await prisma.inpiProcessingJob.count({
            where: { status: 'running' }
        });
        if (currentlyRunning > 0) return;
        const elapsed = Date.now() - lastInpiJobCompletedAt;
        if (lastInpiJobCompletedAt > 0 && elapsed < INPI_JOB_MIN_INTERVAL_MS) return;
        if (lastInpiJobCompletedAt > 0) {
            const jitter = Math.floor(Math.random() * INPI_JOB_DELAY_JITTER_MS);
            if (jitter > 0) await sleep(jitter);
        }
        const processedDoc = await processNextInpiJobByMode('document');
        if (processedDoc) return;
        await processNextInpiJobByMode('text');
    } finally {
        await releaseLock();
    }
}

// Funções para gerenciamento do worker INPI
export async function retryInpiJob(jobId: string) {
    const current = await prisma.inpiProcessingJob.findUnique({
        where: { id: jobId },
        select: { error: true }
    });
    const mode = parseInpiJobMode(current?.error || '');
    const updated = await prisma.inpiProcessingJob.update({
        where: { id: jobId },
        data: {
            status: 'pending',
            attempts: 0,
            error: `mode=${mode}`,
            started_at: null,
            finished_at: null
        }
    });
    processNextInpiJobs().catch(() => undefined);
    return updated;
}

export async function retryAllInpiErrorJobs(ids?: string[]) {
    const where = ids && ids.length > 0
        ? { id: { in: Array.from(new Set(ids)) }, status: { in: ['failed', 'failed_permanent'] } }
        : { status: { in: ['failed', 'failed_permanent'] } };
    const rows = await prisma.inpiProcessingJob.findMany({
        where,
        select: { id: true, error: true }
    });
    let updatedCount = 0;
    for (const row of rows) {
        const mode = parseInpiJobMode(row.error || '');
        await prisma.inpiProcessingJob.update({
            where: { id: row.id },
            data: {
                status: 'pending',
                attempts: 0,
                error: `mode=${mode}`,
                started_at: null,
                finished_at: null
            }
        });
        updatedCount += 1;
    }
    processNextInpiJobs().catch(() => undefined);
    return { updated: updatedCount };
}

export async function enqueueInpiReprocessing(patentNumbers?: string[], priority = 10, mode: 'text' | 'document' = 'text') {
    if (!patentNumbers || patentNumbers.length === 0) {
        // Se não especificado, enfileira todas as patentes BR existentes
        const existingPatents = await prisma.inpiPatent.findMany({
            where: { cod_pedido: { startsWith: 'BR' } },
            select: { cod_pedido: true }
        });
        patentNumbers = existingPatents.map((p: any) => p.cod_pedido);
    }

    const values = (patentNumbers || []).filter(Boolean);
    const jobs = values.map((patentNumber) => ({
        patent_number: patentNumber,
        priority,
        status: 'pending' as const,
        attempts: 0,
        error: `mode=${mode}`,
        created_at: new Date()
    }));
    
    const result = await prisma.inpiProcessingJob.createMany({
        data: jobs,
        skipDuplicates: true
    });
    
    return { enqueued: result.count };
}

export async function enqueueInpiDocumentReprocessing(patentNumbers?: string[], priority = 95) {
    return enqueueInpiReprocessing(patentNumbers, priority, 'document');
}

export async function startBackgroundWorkers() {
    if (loopsStarted) return;
    loopsStarted = true;
    recoverStaleRunningJobs().catch(() => undefined);
    quarantineInvalidFutureRpiJobs().catch(() => undefined);
    enqueueLastFiveYearsRpi().catch(() => undefined);
    processNextInpiJobs().catch(() => undefined);
    processNextRpiImportJob().catch(() => undefined);
    processNextDocumentJob().catch(() => undefined);
    processNextOpsBibliographicJob().catch(() => undefined);
    processNextBigQueryBibliographicJob().catch(() => undefined);
    setInterval(() => {
        processNextInpiJobs().catch(() => undefined);
    }, 3000);
    setInterval(() => {
        processNextRpiImportJob().catch(() => undefined);
    }, 4000);
    setInterval(() => {
        processNextDocumentJob().catch(() => undefined);
    }, 5000);
    setInterval(() => {
        processNextOpsBibliographicJob().catch(() => undefined);
    }, 6000);
    setInterval(() => {
        processNextBigQueryBibliographicJob().catch(() => undefined);
    }, 6500);
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
