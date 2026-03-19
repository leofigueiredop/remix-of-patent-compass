import axios from 'axios';
import * as cheerio from 'cheerio';
import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createSign, randomUUID } from 'crypto';
import { CreateBucketCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { prisma } from '../db';

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
const S3_ENDPOINT = process.env.S3_ENDPOINT || '';
const S3_REGION = process.env.S3_REGION || 'garage';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || '';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || '';
const S3_BUCKET = process.env.S3_BUCKET || 'patents';

let loopsStarted = false;
let rpiRunning = false;
let docRunning = false;
let opsRunning = false;
let inpiRunning = false;
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
let bigQueryAccessToken: string | null = null;
let bigQueryAccessTokenExpiration = 0;

function normalizeText(value?: string): string {
    return (value || '').replace(/\s+/g, ' ').trim();
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
    const existingStorageKey = await resolveExistingStorageKey([
        params.publicationNumber,
        existing?.publication_number,
        params.patentId
    ]);
    if (existingStorageKey) {
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

async function processRpiXmlContent(rpiNumber: number, xmlContent: string): Promise<number> {
    const $ = cheerio.load(xmlContent, { xmlMode: true });
    const revista = $('revista').first();
    const dataPublicacao = revista.attr('dataPublicacao') || revista.attr('data-publicacao') || '';
    const despachoNodes = revista.find('despacho').toArray();
    const bqCache = new Map<string, BigQueryBibliographicData | null>();
    const monitoredAttorneyRows = await prisma.$queryRawUnsafe<any[]>(
        `select name from monitoring_attorneys where active=true`
    ).catch(() => []);
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
            const matchedAttorney = monitoredAttorneys.find((name) => mergedAttorneyText.includes(name));
            if (matchedAttorney) {
                const monitoringNumber = patentNumber || numeroPublicacao || codPedidoFromNumero || numeroRaw;
                const monitoringId = normalizeMonitoringPatentKey(monitoringNumber);
                if (monitoringId) {
                    const currentRows = await prisma.$queryRawUnsafe<any[]>(
                        `select id, blocked_by_user from monitored_inpi_patents where patent_number=$1 limit 1`,
                        monitoringId
                    ).catch(() => []);
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

        const monitoringRows = await prisma.$queryRawUnsafe<any[]>(
            `select id, active
             from monitored_inpi_patents
             where patent_number=$1
             limit 1`,
            normalizeMonitoringPatentKey(patentNumber)
        ).catch(() => []);
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

        if (isDocumentEligible && patentId) {
            if (INPI_SCRAPE_FIRST_ENABLED) {
                await prisma.inpiProcessingJob.createMany({
                    data: [{
                        patent_number: patentId,
                        priority: 10,
                        status: 'pending',
                        attempts: 0,
                        created_at: new Date()
                    }],
                    skipDuplicates: true
                }).catch(() => undefined);
            }
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
    const normalizeGoogleSeed = (value?: string): string => {
        const raw = normalizeText(value || '').toUpperCase();
        const beforeHyphen = raw.split('-')[0] || raw;
        let normalized = beforeHyphen.replace(/[^A-Z0-9]/g, '');
        const hasHyphenCheckDigit = /-[0-9X]$/i.test(raw);
        const brMatch = normalized.match(/^BR(10|11|12|13)(\d+)$/);
        if (!hasHyphenCheckDigit && brMatch && brMatch[2].length > 10) {
            normalized = `BR${brMatch[1]}${brMatch[2].slice(0, -1)}`;
        }
        return normalized;
    };
    const base = normalizeGoogleSeed(patentNumber);
    if (!base) return [];
    const variants = new Set<string>([base]);
    const noBr = base.replace(/^BR/i, '');
    if (noBr) variants.add(noBr);
    return Array.from(variants).filter(Boolean);
}

function extractGooglePatentAbstract($: ReturnType<typeof cheerio.load>): string {
    const candidates = [
        $('meta[name="DC.description"]').attr('content'),
        $('meta[name="description"]').attr('content'),
        $('section[itemprop="abstract"] div.abstract').first().text(),
        $('div.abstract').first().text(),
        $('abstract').first().text()
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
            await waitGooglePatentsThrottle();
            lastGooglePatentsRequestAt = Date.now();
            
            // Try direct URL first - much faster and more reliable than searching
            const directUrl = `https://patents.google.com/patent/${candidate}/pt`;
            await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
            let extracted = await tryExtractFromCurrentPage();
            
            // If direct URL fails, fallback to search
            if (!extracted) {
                await waitGooglePatentsThrottle();
                lastGooglePatentsRequestAt = Date.now();
                await page.goto('https://patents.google.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
                await page.evaluate((value) => {
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
            await waitGooglePatentsThrottle();
            lastGooglePatentsRequestAt = Date.now();
            await page.goto(ptUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await sleep(900 + Math.floor(Math.random() * 500));
            const html = await page.content();
            if (html && !/security verification|just a moment/i.test(html) && !/error 404/i.test(html.toLowerCase())) {
                portugueseUrl = page.url();
                portugueseHtml = html;
            }
        }

        const browserCandidates = await page.evaluate(() => {
            const out: string[] = [];
            const add = (value?: string | null) => {
                if (!value) return;
                out.push(value);
            };
            add(document.querySelector('meta[name="citation_pdf_url"]')?.getAttribute('content'));
            const nodes = Array.from(document.querySelectorAll<HTMLElement>('a[href], button[data-href], button[href]'));
            for (const node of nodes) {
                const text = (node.textContent || '').toLowerCase();
                const aria = (node.getAttribute('aria-label') || '').toLowerCase();
                const href = node.getAttribute('href') || node.getAttribute('data-href') || '';
                if (text.includes('download pdf') || aria.includes('download pdf')) add(href);
                if (/pdf|download|patentimages/i.test(href)) add(href);
            }
            return out;
        });
        const browserBiblio = await page.evaluate(() => {
            const clean = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();
            const title = clean(
                document.querySelector('meta[name="DC.title"]')?.getAttribute('content')
                || document.querySelector('h1')?.textContent
                || document.title
            );
            const abstract = clean(
                document.querySelector('meta[name="DC.description"]')?.getAttribute('content')
                || document.querySelector('section[itemprop="abstract"] div.abstract')?.textContent
                || document.querySelector('div.abstract')?.textContent
                || document.querySelector('abstract')?.textContent
            );
            const applicant = clean(
                document.querySelector('meta[scheme="assignee"]')?.getAttribute('content')
                || document.querySelector('dd[itemprop="assigneeOriginal"] span[itemprop="name"]')?.textContent
            );
            const inventor = clean(
                document.querySelector('meta[scheme="inventor"]')?.getAttribute('content')
                || document.querySelector('dd[itemprop="inventor"] span[itemprop="name"]')?.textContent
            );
            const publicationDate = clean(
                document.querySelector('meta[scheme="publication-date"]')?.getAttribute('content')
                || document.querySelector('time[itemprop="publicationDate"]')?.getAttribute('datetime')
            );
            const ipcList = Array.from(document.querySelectorAll('span[itemprop="Code"], td[itemprop="Code"]'))
                .map((el) => clean(el.textContent))
                .filter(Boolean)
                .slice(0, 20);
            const ipc = clean(ipcList.join(', '));
            return { title, abstract, applicant, inventor, ipc, publicationDate };
        });
        const base = portugueseUrl || detailUrl;
        const pdfCandidates = new Set<string>();
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
        browserCandidates.forEach((item) => addAbsolute(item));
        addAbsolute(`${detailUrl}${detailUrl.includes('?') ? '&' : '?'}download=pdf`);
        if (portugueseUrl) addAbsolute(`${portugueseUrl}${portugueseUrl.includes('?') ? '&' : '?'}download=pdf`);

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
            publicationDate: browserBiblio.publicationDate || undefined
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
    const applicant = normalizeText(
        snapshot.applicant
        || extraction$('meta[scheme="assignee"]').attr('content')
        || extraction$('dd[itemprop="assigneeOriginal"] span[itemprop="name"]').first().text()
        || fallback$('meta[scheme="assignee"]').attr('content')
        || fallback$('dd[itemprop="assigneeOriginal"] span[itemprop="name"]').first().text()
    );
    const inventor = normalizeText(
        snapshot.inventor
        || extraction$('meta[scheme="inventor"]').attr('content')
        || extraction$('dd[itemprop="inventor"] span[itemprop="name"]').first().text()
        || fallback$('meta[scheme="inventor"]').attr('content')
        || fallback$('dd[itemprop="inventor"] span[itemprop="name"]').first().text()
    );
    const publicationDate = normalizeText(
        snapshot.publicationDate
        || extraction$('meta[scheme="publication-date"]').attr('content')
        || extraction$('time[itemprop="publicationDate"]').attr('datetime')
        || fallback$('meta[scheme="publication-date"]').attr('content')
        || fallback$('time[itemprop="publicationDate"]').attr('datetime')
        || ''
    );
    const ipc = extraction$('span[itemprop="Code"], td[itemprop="Code"]')
        .toArray()
        .map((el) => normalizeText(extraction$(el).text()))
        .filter(Boolean)
        .slice(0, 20)
        .join(', ');
    const fallbackIpc = fallback$('span[itemprop="Code"], td[itemprop="Code"]')
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
    await waitGooglePatentsThrottle();
    lastGooglePatentsRequestAt = Date.now();
    const response = await axios.get(url, {
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
        await waitGooglePatentsThrottle();
        lastGooglePatentsRequestAt = Date.now();
        const nestedResponse = await axios.get(nested, {
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

async function downloadGooglePatentsFullDocument(patentNumber: string): Promise<Buffer | null> {
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
        if (pdf) return pdf;
    }
    return null;
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
        await module.processInpiPatent(codPedido);
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

async function fetchBibliographicDataWithFallbacks(patentNumber: string, attemptNumber = 1): Promise<OpsBibliographicData | null> {
    // Ordem exigida: 1) INPI worker 2) OPS 3) Google Patents Scrape / BigQuery
    if (patentNumber.startsWith('BR')) {
        try {
            const inpi = await fetchInpiScrapeBibliographicData(patentNumber);
            if (inpi) return inpi;
        } catch (error) {
            if (serializeUnknownError(error).includes('INPI_MAINTENANCE')) {
                // Se INPI em manutenção, seguimos para OPS sem erro
            } else {
                // Qualquer outro erro: seguir para OPS
            }
        }
    }
    const fromOps = await fetchOpsBibliographicData(patentNumber);
    if (fromOps) return fromOps;
    const fromGooglePatents = await fetchGooglePatentsBibliographicData(patentNumber);
    if (fromGooglePatents) return fromGooglePatents;
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
    if (bqRunning || bqPaused || !BIGQUERY_ENABLED) return;
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
                        const pdf = await downloadGooglePatentsFullDocument(candidate);
                        if (!pdf || pdf.length < 1024) continue;
                        const safeBase = publicationNumber.replace(/[^\w.-]/g, '_');
                        const baseKey = `patent-docs/${safeBase}`;
                        const fullKey = `${baseKey}/full_document.pdf`;
                        await uploadPdfToS3(fullKey, pdf);
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

            const googlePrimaryRecovered = await tryGooglePatentsFallback('DOC_PRIMARY');
            
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

            const errorText = `DOC_GOOGLE_PATENTS_NOT_FOUND publication=${publicationNumber} source=google_patents candidates=${googleSearchCandidates.join('|')}`;
            await prisma.documentDownloadJob.update({
                where: { id: job.id },
                data: { status: 'not_found', error: truncateError(errorText), finished_at: new Date() }
            });
            documentJobLog({ jobId: job.id, patentId: job.patent_id, publicationNumber, candidatesSearched: googleSearchCandidates, status: 'not_found', code: 'DOC_GOOGLE_PATENTS_NOT_FOUND' });
            return;
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
        inpiPaused,
        bqPaused,
        rpiRunning,
        docRunning,
        opsRunning,
        inpiRunning,
        bqRunning,
        opsCircuitOpen: opsCircuitOpenUntil > Date.now(),
        opsCircuitOpenUntil: opsCircuitOpenUntil > Date.now() ? new Date(opsCircuitOpenUntil).toISOString() : null,
        bigQueryEnabled: BIGQUERY_ENABLED,
        bigQueryProject: BIGQUERY_BILLING_PROJECT || null,
        bigQueryFirstEnabled: BIGQUERY_FIRST_ENABLED,
        inpiEnabled: INPI_SCRAPE_FALLBACK_ENABLED
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
    const where = ids && ids.length > 0
        ? { id: { in: Array.from(new Set(ids)) }, status: { in: ['failed', 'failed_permanent', 'not_found', 'waiting_indexing'] } }
        : { status: { in: ['failed', 'failed_permanent', 'not_found', 'waiting_indexing'] } };
    const result = await prisma.documentDownloadJob.updateMany({
        where,
        data: {
            status: 'pending',
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

// INPI Worker - Processamento de dados completos do INPI
async function processNextInpiJob() {
    if (inpiRunning || inpiPaused) return;
    inpiRunning = true;
    
    try {
        let job = await prisma.inpiProcessingJob.findFirst({
            where: { status: 'pending' },
            orderBy: [{ priority: 'desc' }, { created_at: 'asc' }]
        });
        
        if (!job) {
            job = await prisma.inpiProcessingJob.findFirst({
                where: {
                    status: 'failed',
                    attempts: { lt: 3 }
                },
                orderBy: [{ attempts: 'asc' }, { updated_at: 'asc' }, { created_at: 'asc' }]
            });
        }
        
        if (!job) {
            inpiRunning = false;
            return;
        }
        
        const nextAttempt = job.attempts + 1;
        await prisma.inpiProcessingJob.update({
            where: { id: job.id },
            data: {
                status: 'running',
                started_at: new Date(),
                attempts: { increment: 1 },
                error: null
            }
        });
        
        try {
            console.log(`🔍 INPI Worker processando: ${job.patent_number}`);
            
            // Importar e usar o worker INPI
            const { processInpiPatent } = await import('./inpiWorker');
            const result = await processInpiPatent(job.patent_number);
            
            await prisma.inpiProcessingJob.update({
                where: { id: job.id },
                data: {
                    status: 'completed',
                    finished_at: new Date(),
                    result_data: result as any
                }
            });
            
            console.log(`✅ INPI Worker concluído: ${job.patent_number}`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`❌ INPI Worker falhou: ${job.patent_number} - ${errorMessage}`);
            const infraBrowserError = errorMessage.includes('INPI_BROWSER_LAUNCH_FAILED')
                || errorMessage.includes('Failed to launch the browser process')
                || errorMessage.includes('spawn ')
                || errorMessage.includes(' ENOENT');
            
            await prisma.inpiProcessingJob.update({
                where: { id: job.id },
                data: {
                    status: infraBrowserError || nextAttempt >= 3 ? 'failed_permanent' : 'failed',
                    finished_at: new Date(),
                    error: errorMessage
                }
            });
        }
        
    } catch (error) {
        console.error('Erro no INPI Worker loop:', error);
    } finally {
        inpiRunning = false;
    }
}

// Funções para gerenciamento do worker INPI
export async function retryInpiJob(jobId: string) {
    const updated = await prisma.inpiProcessingJob.update({
        where: { id: jobId },
        data: {
            status: 'pending',
            attempts: 0,
            error: null,
            started_at: null,
            finished_at: null
        }
    });
    processNextInpiJob().catch(() => undefined);
    return updated;
}

export async function retryAllInpiErrorJobs(ids?: string[]) {
    const where = ids && ids.length > 0
        ? { id: { in: Array.from(new Set(ids)) }, status: { in: ['failed', 'failed_permanent'] } }
        : { status: { in: ['failed', 'failed_permanent'] } };
    const result = await prisma.inpiProcessingJob.updateMany({
        where,
        data: {
            status: 'pending',
            attempts: 0,
            error: null,
            started_at: null,
            finished_at: null
        }
    });
    processNextInpiJob().catch(() => undefined);
    return { updated: result.count };
}

export async function enqueueInpiReprocessing(patentNumbers?: string[], priority = 10) {
    if (!patentNumbers || patentNumbers.length === 0) {
        // Se não especificado, enfileira todas as patentes BR existentes
        const existingPatents = await prisma.inpiPatent.findMany({
            where: { cod_pedido: { startsWith: 'BR' } },
            select: { cod_pedido: true }
        });
        patentNumbers = existingPatents.map(p => p.cod_pedido);
    }
    
    const jobs = patentNumbers.map(patentNumber => ({
        patent_number: patentNumber,
        priority,
        status: 'pending' as const,
        attempts: 0,
        created_at: new Date()
    }));
    
    const result = await prisma.inpiProcessingJob.createMany({
        data: jobs,
        skipDuplicates: true
    });
    
    return { enqueued: result.count };
}

export async function startBackgroundWorkers() {
    if (loopsStarted) return;
    loopsStarted = true;
    recoverStaleRunningJobs().catch(() => undefined);
    quarantineInvalidFutureRpiJobs().catch(() => undefined);
    enqueueLastFiveYearsRpi().catch(() => undefined);
    processNextInpiJob().catch(() => undefined);
    processNextRpiImportJob().catch(() => undefined);
    processNextDocumentJob().catch(() => undefined);
    processNextOpsBibliographicJob().catch(() => undefined);
    processNextBigQueryBibliographicJob().catch(() => undefined);
    setInterval(() => {
        processNextInpiJob().catch(() => undefined);
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
