import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import axios from 'axios';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import FormData from 'form-data';
import * as cheerio from 'cheerio';
import bcrypt from 'bcryptjs';
import { prisma } from './db';
import {
    debugBigQueryLookup,
    debugInpiLookup,
    enqueueInpiReprocessing,
    enqueueLastFiveYearsRpi,
    getBackgroundWorkerState,
    retryAllDocumentErrorJobs,
    retryInpiJob,
    retryAllOpsErrorJobs,
    retryAllRpiErrorJobs,
    retryDocumentJob,
    retryOpsBibliographicJob,
    retryRpiJob,
    setBackgroundWorkerPause,
    startBackgroundWorkers
} from './services/backgroundWorkers';
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import pdfParse from 'pdf-parse';

const execAsync = promisify(exec);


const fastify = Fastify({ logger: true });
// const prisma = new PrismaClient(); // Removed, already imported from './db' oben.

const corsAllowedOrigins = new Set(
    (process.env.CORS_ORIGINS || 'https://patent-scope.seafeetlabs.tech,http://localhost:8080,http://localhost:5173')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
);

fastify.register(cors, {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (corsAllowedOrigins.has(origin)) return callback(null, true);
        try {
            const parsed = new URL(origin);
            if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.seafeetlabs.tech')) {
                return callback(null, true);
            }
        } catch {
        }
        return callback(new Error('Origin not allowed by CORS'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400
});
fastify.register(multipart);
fastify.register(jwt, { secret: process.env.JWT_SECRET || 'patent-scope-secret-change-me' });

// ─── Environment ───────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const WHISPER_BASE_URL = process.env.WHISPER_BASE_URL || 'http://whisper:8000';
const OPS_CONSUMER_KEY = process.env.OPS_CONSUMER_KEY || '';
const OPS_CONSUMER_SECRET = process.env.OPS_CONSUMER_SECRET || '';
const INPI_MODE = process.env.INPI_MODE || 'scrape';
const S3_ENDPOINT = process.env.S3_ENDPOINT || '';
const S3_REGION = process.env.S3_REGION || 'garage';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || '';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || '';
const S3_BUCKET = process.env.S3_BUCKET || 'patents';

// ─── Queues (Throttle APIs) ───────────────────────────────────
class AsyncQueue {
    private queue: (() => Promise<void>)[] = [];
    private running: boolean = false;
    private delayMs: number;

    constructor(delayMs: number = 0) {
        this.delayMs = delayMs;
    }

    async enqueue<T>(task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const res = await task();
                    resolve(res);
                } catch (err) {
                    reject(err);
                }
            });
            this.process();
        });
    }

    private async process() {
        if (this.running || this.queue.length === 0) return;
        this.running = true;
        const task = this.queue.shift();
        if (task) {
            await task();
            if (this.delayMs > 0) {
                await new Promise(r => setTimeout(r, this.delayMs));
            }
        }
        this.running = false;
        this.process();
    }
}

const espacenetQueue = new AsyncQueue(800); // 800ms between calls

function isRetryableInpiNetworkError(message: string): boolean {
    const normalized = (message || '').toLowerCase();
    return normalized.includes('failed to connect')
        || normalized.includes('connection refused')
        || normalized.includes('timed out')
        || normalized.includes('empty reply')
        || normalized.includes('connection reset');
}

function isMissingTableError(error: any): boolean {
    return Boolean(error && error.code === 'P2021');
}

function emptyBackgroundQueuesPayload() {
    return {
        rpi: {
            processing: [],
            success: [],
            errors: [],
            counts: { processing: 0, success: 0, errors: 0 }
        },
        docs: {
            processing: [],
            success: [],
            errors: [],
            counts: { processing: 0, success: 0, errors: 0 }
        },
        ops: {
            processing: [],
            success: [],
            errors: [],
            counts: { processing: 0, success: 0, errors: 0 }
        },
        inpi: {
            processing: [],
            success: [],
            errors: [],
            counts: { processing: 0, success: 0, errors: 0 }
        }
    };
}

async function execInpiCurlWithRetry(command: string, attempts = 3, timeout = 30000, maxBuffer?: number): Promise<{ stdout: string; stderr: string; }> {
    let lastError: any;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await execAsync(command, maxBuffer ? { timeout, maxBuffer } : { timeout });
        } catch (error: any) {
            lastError = error;
            const message = error?.message || '';
            if (!isRetryableInpiNetworkError(message) || i === attempts) {
                throw error;
            }
            const backoffMs = 400 * i;
            fastify.log.warn(`INPI network error (attempt ${i}/${attempts}), retrying in ${backoffMs}ms: ${message}`);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
    }
    throw lastError;
}

// ─── OPS Token Cache ───────────────────────────────────────────
let opsAccessToken: string | null = null;
let opsTokenExpiration = 0;

type CachedPatentRecord = {
    source: string;
    publicationNumber: string;
    title: string;
    applicant: string;
    inventor: string;
    date: string;
    abstract: string;
    classification: string;
    url: string;
    status: string;
    figures: string[];
    updatedAt: string;
    lastSeenAt: string;
};

const dbWriteQueue = new AsyncQueue(120);
const prismaAny = prisma as any;

async function ensureMonitoringTables() {
    const statements = [
        `create table if not exists monitoring_attorneys (
            id text primary key,
            name text not null unique,
            active boolean not null default true,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )`,
        `create index if not exists idx_monitoring_attorneys_active on monitoring_attorneys(active)`,
        `create table if not exists monitored_inpi_patents (
            id text primary key,
            patent_number text not null unique,
            patent_id text null,
            source text not null default 'manual',
            matched_attorney text null,
            active boolean not null default true,
            blocked_by_user boolean not null default false,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            last_seen_at timestamptz null
        )`,
        `create index if not exists idx_monitored_inpi_patents_active on monitored_inpi_patents(active)`,
        `create index if not exists idx_monitored_inpi_patents_patent_number on monitored_inpi_patents(patent_number)`,
        `create table if not exists monitoring_alerts (
            id text primary key,
            monitored_patent_id text not null references monitored_inpi_patents(id) on delete cascade,
            alert_key text not null unique,
            patent_number text not null,
            rpi_number text not null,
            rpi_date timestamptz not null,
            despacho_code text null,
            title text null,
            complement text null,
            severity text not null default 'low',
            deadline timestamptz null,
            is_read boolean not null default false,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )`,
        `create index if not exists idx_monitoring_alerts_unread on monitoring_alerts(is_read)`,
        `create index if not exists idx_monitoring_alerts_monitored_patent on monitoring_alerts(monitored_patent_id)`
    ];
    for (const sql of statements) {
        await prisma.$executeRawUnsafe(sql);
    }
}

function normalizeText(value?: string): string {
    return (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeStringField(value: any): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeFiguresField(value: any): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item) => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 30);
}

function getCachedPatentKey(source: string, publicationNumber: string): string {
    return `${normalizeText(source)}::${normalizeText(publicationNumber)}`;
}

function pickBestField(current: string, incoming: string): string {
    if (!incoming) return current;
    if (!current) return incoming;
    return incoming.length > current.length ? incoming : current;
}

function normalizePatentRecord(record: any): CachedPatentRecord | null {
    const source = normalizeStringField(record?.source);
    const publicationNumber = normalizeStringField(record?.publicationNumber);
    if (!source || !publicationNumber) return null;
    const nowIso = new Date().toISOString();
    return {
        source,
        publicationNumber,
        title: normalizeStringField(record?.title),
        applicant: normalizeStringField(record?.applicant),
        inventor: normalizeStringField(record?.inventor),
        date: normalizeStringField(record?.date),
        abstract: normalizeStringField(record?.abstract),
        classification: normalizeStringField(record?.classification),
        url: normalizeStringField(record?.url),
        status: normalizeStringField(record?.status),
        figures: normalizeFiguresField(record?.figures),
        updatedAt: normalizeStringField(record?.updatedAt) || nowIso,
        lastSeenAt: normalizeStringField(record?.lastSeenAt) || nowIso
    };
}

function mergePatentRecord(existing: CachedPatentRecord, incoming: CachedPatentRecord): CachedPatentRecord {
    const nowIso = new Date().toISOString();
    return {
        source: incoming.source || existing.source,
        publicationNumber: incoming.publicationNumber || existing.publicationNumber,
        title: pickBestField(existing.title, incoming.title),
        applicant: pickBestField(existing.applicant, incoming.applicant),
        inventor: pickBestField(existing.inventor, incoming.inventor),
        date: pickBestField(existing.date, incoming.date),
        abstract: pickBestField(existing.abstract, incoming.abstract),
        classification: pickBestField(existing.classification, incoming.classification),
        url: pickBestField(existing.url, incoming.url),
        status: pickBestField(existing.status, incoming.status),
        figures: incoming.figures.length > 0 ? incoming.figures : existing.figures,
        updatedAt: nowIso,
        lastSeenAt: nowIso
    };
}

function mapRecordToApiPatent(record: CachedPatentRecord): any {
    return {
        publicationNumber: record.publicationNumber,
        title: record.title,
        applicant: record.applicant,
        inventor: record.inventor,
        date: record.date,
        abstract: record.abstract,
        classification: record.classification,
        source: record.source,
        url: record.url,
        status: record.status,
        figures: record.figures
    };
}

function mapDbCacheRowToPatent(row: any): any {
    return mapRecordToApiPatent({
        source: normalizeStringField(row?.source),
        publicationNumber: normalizeStringField(row?.publication_number),
        title: normalizeStringField(row?.title),
        applicant: normalizeStringField(row?.applicant),
        inventor: normalizeStringField(row?.inventor),
        date: normalizeStringField(row?.patent_date),
        abstract: normalizeStringField(row?.abstract),
        classification: normalizeStringField(row?.classification),
        url: normalizeStringField(row?.url),
        status: normalizeStringField(row?.status),
        figures: normalizeFiguresField(row?.figures),
        updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
        lastSeenAt: row?.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
    });
}

function enqueueSearchResultsPersistence(records: any[]) {
    if (!records.length) return;
    for (const record of records) {
        const normalized = normalizePatentRecord(record);
        if (!normalized) continue;
        dbWriteQueue.enqueue(async () => {
            await prismaAny.searchResultCache.upsert({
                where: {
                    source_publication_number: {
                        source: normalized.source,
                        publication_number: normalized.publicationNumber
                    }
                },
                update: {
                    title: normalized.title || null,
                    applicant: normalized.applicant || null,
                    inventor: normalized.inventor || null,
                    patent_date: normalized.date || null,
                    abstract: normalized.abstract || null,
                    classification: normalized.classification || null,
                    url: normalized.url || null,
                    status: normalized.status || null,
                    figures: normalized.figures
                },
                create: {
                    source: normalized.source,
                    publication_number: normalized.publicationNumber,
                    title: normalized.title || null,
                    applicant: normalized.applicant || null,
                    inventor: normalized.inventor || null,
                    patent_date: normalized.date || null,
                    abstract: normalized.abstract || null,
                    classification: normalized.classification || null,
                    url: normalized.url || null,
                    status: normalized.status || null,
                    figures: normalized.figures
                }
            });
        }).catch((error: any) => {
            fastify.log.warn(`Falha ao persistir resultado de busca no banco: ${error.message}`);
        });
    }
}

async function searchQuickSearchCache(filters: {
    number?: string;
    titular?: string;
    inventor?: string;
    keywords?: string;
}): Promise<any[]> {
    const normalizedNumber = normalizeStringField(filters.number);
    const normalizedTitular = normalizeStringField(filters.titular);
    const normalizedInventor = normalizeStringField(filters.inventor);
    const keywordTokens = normalizeText(filters.keywords)
        .split(' ')
        .filter((token) => token.length >= 3);

    const andClauses: any[] = [];
    if (normalizedNumber) andClauses.push({ publication_number: { contains: normalizedNumber, mode: 'insensitive' } });
    if (normalizedTitular) andClauses.push({ applicant: { contains: normalizedTitular, mode: 'insensitive' } });
    if (normalizedInventor) andClauses.push({ inventor: { contains: normalizedInventor, mode: 'insensitive' } });
    for (const token of keywordTokens) {
        andClauses.push({
            OR: [
                { title: { contains: token, mode: 'insensitive' } },
                { abstract: { contains: token, mode: 'insensitive' } },
                { classification: { contains: token, mode: 'insensitive' } },
                { applicant: { contains: token, mode: 'insensitive' } },
                { inventor: { contains: token, mode: 'insensitive' } },
                { publication_number: { contains: token, mode: 'insensitive' } }
            ]
        });
    }

    try {
        const rows = await prismaAny.searchResultCache.findMany({
            where: andClauses.length ? { AND: andClauses } : undefined,
            orderBy: { updated_at: 'desc' },
            take: 200
        });
        return rows.map(mapDbCacheRowToPatent);
    } catch (error: any) {
        fastify.log.warn(`Falha ao buscar cache de patentes no banco: ${error.message}`);
        return [];
    }
}

function mergePatentLists(base: any[], incoming: any[]): any[] {
    const merged = new Map<string, CachedPatentRecord>();
    const applyRecord = (record: any) => {
        const normalized = normalizePatentRecord(record);
        if (!normalized) return;
        const key = getCachedPatentKey(normalized.source, normalized.publicationNumber);
        const existing = merged.get(key);
        merged.set(key, existing ? mergePatentRecord(existing, normalized) : normalized);
    };

    base.forEach(applyRecord);
    incoming.forEach(applyRecord);

    return Array.from(merged.values()).map(mapRecordToApiPatent);
}

type LocalPatentSearchInput = {
    number?: string;
    titular?: string;
    inventor?: string;
    keywords?: string;
    ipcCodes?: string[];
    ignoreSecret?: boolean;
    page?: number;
    pageSize?: number;
};

function buildInpiDetailUrl(codPedido?: string, publicationNumber?: string): string {
    if (codPedido) {
        return `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${encodeURIComponent(codPedido)}`;
    }
    const fallback = publicationNumber || '';
    return `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${encodeURIComponent(fallback)}`;
}

function parseQueryTokens(value?: string): string[] {
    return normalizeText(value)
        .replace(/["'()]/g, ' ')
        .split(/[^a-z0-9]+/i)
        .filter((token) => token.length >= 3);
}

function normalizeDispatchCode(value?: string): string {
    return normalizeStringField(value)
        .replace(',', '.')
        .replace(/\s+/g, '')
        .replace(/[^\d.]/g, '');
}

function isEligibleForDocDownloadByCode(value?: string): boolean {
    const normalized = normalizeDispatchCode(value);
    return normalized === '3.1' || normalized === '16.1';
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

function sanitizePublicationForStorage(publicationNumber?: string): string {
    return (publicationNumber || '').replace(/[^\w.-]/g, '_');
}

function buildStorageAssetPath(publicationNumber: string, asset: 'full' | 'drawings' | 'first'): string {
    const encodedPublication = encodeURIComponent(publicationNumber);
    return `/patent/storage/${encodedPublication}/${asset}`;
}

function buildStorageAssetKey(publicationNumber: string, asset: 'full' | 'drawings' | 'first'): string {
    const safeBase = sanitizePublicationForStorage(publicationNumber);
    const fileName = asset === 'full'
        ? 'full_document.pdf'
        : asset === 'drawings'
            ? 'drawings.pdf'
            : 'first_page.pdf';
    return `patent-docs/${safeBase}/${fileName}`;
}

function buildStorageAssets(publicationNumber: string) {
    return {
        fullDocumentPath: buildStorageAssetPath(publicationNumber, 'full'),
        drawingsPath: buildStorageAssetPath(publicationNumber, 'drawings'),
        firstPagePath: buildStorageAssetPath(publicationNumber, 'first')
    };
}

function normalizePatentForWeb(publicationNumber?: string): string {
    return (publicationNumber || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function buildGooglePatentsUrl(publicationNumber?: string): string {
    const normalized = normalizePatentForWeb(publicationNumber);
    return normalized ? `https://patents.google.com/patent/${normalized}/en` : '';
}

function buildEspacenetUiUrl(publicationNumber?: string): string {
    const normalized = normalizePatentForWeb(publicationNumber);
    return normalized ? `https://worldwide.espacenet.com/patent/search/publication/${normalized}` : '';
}

async function searchLocalPatentBase(input: LocalPatentSearchInput): Promise<{
    results: any[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}> {
    const requestedPage = typeof input.page === 'number' && input.page > 0 ? Math.floor(input.page) : 1;
    const requestedPageSize = typeof input.pageSize === 'number' && input.pageSize > 0
        ? Math.min(Math.max(Math.floor(input.pageSize), 10), 200)
        : 20;
    const normalizedNumber = normalizeStringField(input.number);
    const normalizedTitular = normalizeStringField(input.titular);
    const normalizedInventor = normalizeStringField(input.inventor);
    const keywordTokens = parseQueryTokens(input.keywords);
    const ipcTokens = (input.ipcCodes || [])
        .map((code) => normalizeStringField(code))
        .filter((code) => code.length > 0);
    const andClauses: any[] = [];

    if (normalizedNumber) {
        andClauses.push({
            OR: [
                { numero_publicacao: { contains: normalizedNumber, mode: 'insensitive' } },
                { cod_pedido: { contains: normalizedNumber, mode: 'insensitive' } }
            ]
        });
    }
    if (normalizedTitular) {
        andClauses.push({ applicant: { contains: normalizedTitular, mode: 'insensitive' } });
    }
    if (normalizedInventor) {
        andClauses.push({ inventors: { contains: normalizedInventor, mode: 'insensitive' } });
    }
    for (const token of keywordTokens) {
        andClauses.push({
            OR: [
                { title: { contains: token, mode: 'insensitive' } },
                { abstract: { contains: token, mode: 'insensitive' } },
                { applicant: { contains: token, mode: 'insensitive' } },
                { inventors: { contains: token, mode: 'insensitive' } },
                { numero_publicacao: { contains: token, mode: 'insensitive' } },
                { cod_pedido: { contains: token, mode: 'insensitive' } },
                { ipc_codes: { contains: token, mode: 'insensitive' } }
            ]
        });
    }
    for (const ipc of ipcTokens) {
        andClauses.push({ ipc_codes: { contains: ipc, mode: 'insensitive' } });
    }
    if (input.ignoreSecret) {
        andClauses.push({
            OR: [
                { status: null },
                { status: { not: { contains: 'sigilo', mode: 'insensitive' } } }
            ]
        });
    }

    const where = andClauses.length > 0 ? { AND: andClauses } : undefined;
    const [total, patents] = await Promise.all([
        prismaAny.inpiPatent.count({ where }),
        prismaAny.inpiPatent.findMany({
            where,
            orderBy: { updated_at: 'desc' },
            skip: (requestedPage - 1) * requestedPageSize,
            take: requestedPageSize,
            include: {
                document_jobs: {
                    orderBy: { updated_at: 'desc' },
                    take: 1
                }
            }
        })
    ]);

    const results = patents.map((patent: any) => {
        const publicationNumber = patent.numero_publicacao || patent.cod_pedido;
        const documentJob = Array.isArray(patent.document_jobs) ? patent.document_jobs[0] : null;
        const downloadable = Boolean(documentJob?.status === 'completed' && documentJob?.storage_key);
        return {
            publicationNumber,
            title: patent.title || 'Sem título',
            applicant: patent.applicant || '',
            inventor: patent.inventors || '',
            date: patent.filing_date || '',
            abstract: patent.abstract || '',
            classification: patent.ipc_codes || '',
            source: 'INPI',
            url: downloadable
                ? buildStorageAssetPath(publicationNumber, 'full')
                : buildInpiDetailUrl(patent.cod_pedido, publicationNumber),
            status: patent.status || '',
            cod_pedido: patent.cod_pedido,
            inpiUrl: buildInpiDetailUrl(patent.cod_pedido, publicationNumber),
            googlePatentsUrl: buildGooglePatentsUrl(publicationNumber),
            espacenetUrl: buildEspacenetUiUrl(publicationNumber),
            figures: downloadable ? [buildStorageAssetPath(publicationNumber, 'first'), buildStorageAssetPath(publicationNumber, 'drawings')] : [],
            storage: {
                hasStoredDocument: downloadable,
                ...buildStorageAssets(publicationNumber)
            }
        };
    });

    return {
        results,
        total,
        page: requestedPage,
        pageSize: requestedPageSize,
        totalPages: Math.max(1, Math.ceil(total / requestedPageSize))
    };
}

async function getOpsToken(): Promise<string> {
    if (opsAccessToken && Date.now() < opsTokenExpiration) {
        return opsAccessToken;
    }
    if (!OPS_CONSUMER_KEY || !OPS_CONSUMER_SECRET) {
        throw new Error('Credenciais OPS não configuradas (OPS_CONSUMER_KEY / OPS_CONSUMER_SECRET)');
    }
    const credentials = Buffer.from(`${OPS_CONSUMER_KEY}:${OPS_CONSUMER_SECRET}`).toString('base64');
    const response = await axios.post(
        'https://ops.epo.org/3.2/auth/accesstoken',
        'grant_type=client_credentials',
        {
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );
    opsAccessToken = response.data.access_token;
    opsTokenExpiration = Date.now() + (parseInt(response.data.expires_in) * 1000) - 60000;
    return opsAccessToken!;
}

// ─── Groq Helper (primary) ─────────────────────────────────────
const DEFAULT_SYSTEM_MESSAGE = 'You are a senior patent search engineer and query architect. You are an expert in CQL (Espacenet OPS API), INPI boolean search, and IPC classification. You always respond in the requested format. When JSON is requested, return ONLY valid JSON without markdown or explanations. You are fluent in both Portuguese and English patent terminology.';

async function generateWithGroq(prompt: string, expectJson = true, customSystemMessage?: string): Promise<string> {
    const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: customSystemMessage || DEFAULT_SYSTEM_MESSAGE },
                { role: 'user', content: prompt }
            ],
            temperature: 0.2,
            max_tokens: 8192,
            ...(expectJson ? { response_format: { type: 'json_object' } } : {})
        },
        {
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        }
    );

    const text = response.data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Groq retornou uma resposta vazia.');
    return text;
}

async function generateWithGemini(prompt: string, expectJson = true, customSystemMessage?: string): Promise<string> {
    if (!GROQ_API_KEY) {
        throw new Error('Nenhum provedor LLM configurado. Configure GROQ_API_KEY.');
    }
    return await generateWithGroq(prompt, expectJson, customSystemMessage);
}

// ─── POST /auth/register ───────────────────────────────────────
fastify.post('/auth/register', async (request, reply) => {
    const { email, password, name } = request.body as { email: string; password: string; name?: string };
    if (!email || !password) return reply.code(400).send({ error: 'Email e senha são obrigatórios' });
    if (password.length < 6) return reply.code(400).send({ error: 'Senha deve ter no mínimo 6 caracteres' });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
        return reply.code(409).send({ error: 'Este e-mail já está cadastrado' });
    }

    const userCount = await prisma.user.count();
    const hash = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
        data: {
            email,
            name: name || email.split('@')[0],
            password_hash: hash,
            role: userCount === 0 ? 'admin' : 'user'
        }
    });

    const token = fastify.jwt.sign({ id: newUser.id, email: newUser.email, role: newUser.role }, { expiresIn: '7d' });
    return { token, user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role } };
});

// ─── POST /auth/login ──────────────────────────────────────────
fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };
    if (!email || !password) return reply.code(400).send({ error: 'Email e senha são obrigatórios' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.code(401).send({ error: 'Credenciais inválidas' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return reply.code(401).send({ error: 'Credenciais inválidas' });

    const token = fastify.jwt.sign({ id: user.id, email: user.email, role: user.role }, { expiresIn: '7d' });
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
});

// ─── GET /auth/me ──────────────────────────────────────────────
fastify.get('/auth/me', async (request, reply) => {
    try {
        await request.jwtVerify();
        const { id } = request.user as any;
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) return reply.code(401).send({ error: 'Usuário não encontrado' });
        return { id: user.id, email: user.email, name: user.name, role: user.role };
    } catch {
        return reply.code(401).send({ error: 'Token inválido' });
    }
});

// ─── Health Check ──────────────────────────────────────────────
fastify.get('/health', async () => {
    return {
        status: 'ok',
        services: { groq: GROQ_API_KEY ? 'configured' : 'missing', whisper: WHISPER_BASE_URL },
        ops: OPS_CONSUMER_KEY ? 'configured' : 'missing',
        inpi_mode: INPI_MODE
    };
});

// ─── POST /transcribe ──────────────────────────────────────────
fastify.post('/transcribe', async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'Audio file is required' });

    const tempFilePath = path.join(os.tmpdir(), data.filename);
    await pipeline(data.file, createWriteStream(tempFilePath));

    try {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(tempFilePath));

        const response = await axios.post(`${WHISPER_BASE_URL}/v1/audio/transcriptions`, formData, {
            headers: { ...formData.getHeaders() },
            timeout: 120000
        });
        fs.unlinkSync(tempFilePath);
        return response.data;
    } catch (error: any) {
        request.log.error(error);
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        return reply.code(500).send({ error: 'Transcription failed', details: error.message });
    }
});

// ─── POST /briefing/:field ─────────────────────────────────────
const briefingPrompts: Record<string, string> = {
    problem: "Trabalhe como um especialista em patentes. Analise o texto e descreva APENAS o PROBLEMA TÉCNICO que a invenção resolve. Seja conciso e técnico. REGRA ESTRITA: NÃO use introduções como 'Como especialista, analisei...' nem frases de encerramento. Comece DIRETAMENTE com o problema.",
    solution: "Trabalhe como um especialista em patentes. Analise o texto e descreva APENAS a SOLUÇÃO TÉCNICA proposta pela invenção. Seja conciso e técnico. REGRA ESTRITA: NÃO use introduções como 'Como especialista, analisei...' nem frases de encerramento. Comece DIRETAMENTE com a solução.",
    highlights: "Trabalhe como um especialista em patentes. Analise o texto e extraia uma LISTA de DIFERENCIAIS técnicos em relação ao estado da arte. Responda em tópicos. REGRA ESTRITA: NÃO use introduções como 'Como especialista, analisei...' nem frases de encerramento. Comece DIRETAMENTE com os tópicos.",
    applications: "Trabalhe como um especialista em patentes. Analise o texto e identifique as APLICAÇÕES INDUSTRIAIS e MERCADOS-ALVO da invenção. REGRA ESTRITA: NÃO use introduções como 'Como especialista, analisei...' nem frases de encerramento. Comece DIRETAMENTE com as aplicações."
};

fastify.post('/briefing/problem', async (request) => {
    const { text } = request.body as { text: string };
    const raw = await generateWithGemini(`${briefingPrompts.problem}\n\nText:\n${text.substring(0, 15000)}`, false);
    return { problemaTecnico: raw.replace(/["{}]/g, '').trim() };
});

fastify.post('/briefing/solution', async (request) => {
    const { text } = request.body as { text: string };
    const raw = await generateWithGemini(`${briefingPrompts.solution}\n\nText:\n${text.substring(0, 15000)}`, false);
    return { solucaoProposta: raw.replace(/["{}]/g, '').trim() };
});

fastify.post('/briefing/highlights', async (request) => {
    const { text } = request.body as { text: string };
    const raw = await generateWithGemini(`${briefingPrompts.highlights}\n\nText:\n${text.substring(0, 15000)}`, false);
    return { diferenciais: raw.replace(/["{}]/g, '').trim() };
});

fastify.post('/briefing/applications', async (request) => {
    const { text } = request.body as { text: string };
    const raw = await generateWithGemini(`${briefingPrompts.applications}\n\nText:\n${text.substring(0, 15000)}`, false);
    return { aplicacoes: raw.replace(/["{}]/g, '').trim() };
});

fastify.post('/briefing', async (request, reply) => {
    const { text } = request.body as { text: string };
    if (!text) return reply.code(400).send({ error: 'Text is required' });

    const prompt = `Você é um especialista em patentes brasileiro. Analise o texto abaixo e extraia um briefing técnico estruturado.
Responda APENAS um JSON válido com estes campos exatos:
{
  "problemaTecnico": "descrição do problema técnico",
  "solucaoProposta": "descrição da solução técnica",
  "diferenciais": "lista dos diferenciais",
  "aplicacoes": "aplicações industriais"
}

Texto:
${text.substring(0, 15000)}`;

    try {
        const raw = await generateWithGemini(prompt, true);
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            parsed = JSON.parse(match ? match[1] : raw);
        }
        return parsed;
    } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Failed to generate briefing', details: error.message });
    }
});

// ─── POST /strategy ────────────────────────────────────────────

// Dedicated system message for patent search strategy generation
const STRATEGY_SYSTEM_MESSAGE = `You are a world-class patent search strategist with 20+ years of experience at the EPO (European Patent Office) and INPI (Brazil).

═══ CQL SYNTAX (Espacenet OPS API) ═══
- Use ONLY "ta all" for text search (title+abstract combined)
- NEVER use "ti=" or "ab=" separately
- Multi-word terms MUST be quoted: ta all "solar collector"
- Single words do NOT need quotes: ta all collector
- Operators: AND, OR with parentheses

═══ INPI BOOLEAN SYNTAX ═══
- Pure boolean: ("termo1" OR "termo2") AND ("termo3" OR "termo4")
- Portuguese terms ONLY
- All multi-word terms in double quotes

═══ REGRAS DE EXPANSÃO LEXICAL (CRÍTICAS) ═══
Para CADA conceito-chave da invenção, você DEVE gerar termos usando TODAS estas técnicas:

a) TERMOS SIMPLES DE 1 PALAVRA PRIMEIRO (prioridade máxima):
   - Substantivos genéricos: "máquina", "dispositivo", "aparelho", "equipamento"
   - Em inglês: "machine", "device", "apparatus", "equipment"
   
b) VARIAÇÕES MORFOLÓGICAS (verbo → substantivo → adjetivo → agente):
   - cortar → corte → cortador → cortante
   - selar → selagem → selador → selante  
   - aquecer → aquecimento → aquecedor → térmico
   - cut → cutting → cutter
   - seal → sealing → sealer
   
c) SINÔNIMOS DO COTIDIANO INDUSTRIAL (não apenas técnicos):
   - "forno" = "estufa" = "câmara"
   - "molde" = "forma" = "matriz"
   - "prensa" = "compressor" = "máquina de prensar"
   
d) HIPERÔNIMOS (termos mais genéricos que capturam o conceito pai):
   - "pastel" → "massa recheada" → "produto alimentício"
   - "sensor" → "transdutor" → "elemento de medição"

e) DEPOIS termos compostos mais específicos:
   - "máquina de corte", "dispositivo de selagem"

REGRA DE OURO: Comece SEMPRE com 3-4 termos SIMPLES de 1 palavra, depois adicione 4-6 termos compostos. Mínimo 7-10 termos por grupo.

═══ OBJETIVO ═══
MÁXIMO RECALL. Se existir QUALQUER patente remotamente similar à invenção, ela DEVE ser encontrável com estes termos. Prefira falsos positivos a falsos negativos. Termos simples e genéricos ampliam o recall.

Retorne APENAS JSON válido. Sem markdown, sem explicações.`;

// Format briefing as readable structured text for better LLM comprehension
function formatBriefingForPrompt(briefing: any): string {
    const parts: string[] = [];
    if (briefing.problemaTecnico) parts.push(`PROBLEMA TÉCNICO:\n${briefing.problemaTecnico}`);
    if (briefing.solucaoProposta) parts.push(`SOLUÇÃO PROPOSTA:\n${briefing.solucaoProposta}`);
    if (briefing.diferenciais) parts.push(`DIFERENCIAIS TÉCNICOS:\n${briefing.diferenciais}`);
    if (briefing.aplicacoes) parts.push(`APLICAÇÕES INDUSTRIAIS:\n${briefing.aplicacoes}`);
    return parts.join('\n\n');
}

function normalizeStrategyTerms(raw: any): string[] {
    const seen = new Set<string>();
    const terms: string[] = [];
    if (!Array.isArray(raw)) return terms;
    for (const item of raw) {
        if (typeof item !== 'string') continue;
        let t = item.trim();
        if (!t) continue;
        t = t.replace(/^[\"'“”«»]+|[\"'“”«»]+$/g, '').replace(/\s+/g, ' ');
        const upper = t.toUpperCase();
        if (upper === 'AND' || upper === 'OR' || upper === 'NOT' || upper === 'E' || upper === 'OU' || upper === 'NÃO' || upper === 'NAO') continue;
        if (t.length < 3 || t.length > 60) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        terms.push(t);
    }
    return terms;
}

function validateAndFixStrategy(parsed: any): any {
    // Ensure required fields exist
    if (!parsed.techBlocks) parsed.techBlocks = [];
    if (!parsed.blocks) parsed.blocks = [];
    if (!parsed.searchLevels) parsed.searchLevels = [];
    if (!parsed.ipc_codes) parsed.ipc_codes = [];

    // Fix blocks: ensure each has id, connector, and groups
    parsed.blocks = parsed.blocks.map((b: any, i: number) => {
        const groups = (b.groups || []).map((g: any, j: number) => {
            const termsPt = normalizeStrategyTerms(g.terms_pt || g.termsPt || g.terms_PT || g.terms || []);
            const termsEn = normalizeStrategyTerms(g.terms_en || g.termsEn || g.terms_EN || []);
            return {
                id: g.id || `g${i + 1}-${j + 1}`,
                terms_pt: termsPt,
                terms_en: termsEn
            };
        }).filter((g: any) => g.terms_pt.length > 0 || g.terms_en.length > 0);
        return {
            id: b.id || `b${i + 1}`,
            connector: b.connector || 'AND',
            groups
        };
    }).filter((b: any) => b.groups.length > 0);

    // Fix searchLevels: validate CQL syntax and enforce character limits
    parsed.searchLevels = parsed.searchLevels.map((lvl: any) => {
        let cql = (lvl.cql || '').trim();
        let inpi = (lvl.inpi || '').trim();

        // Fix common CQL mistakes: replace ti= or ab= with ta all
        cql = cql.replace(/\bti\s*=\s*/gi, 'ta all ');
        cql = cql.replace(/\bab\s*=\s*/gi, 'ta all ');
        // Fix ta= without "all"
        cql = cql.replace(/\bta\s*=\s*/gi, 'ta all ');
        // Fix double spaces
        cql = cql.replace(/\s{2,}/g, ' ');
        inpi = inpi.replace(/\s{2,}/g, ' ');

        return {
            level: lvl.level,
            label: lvl.label || `Nível ${lvl.level}`,
            cql,
            inpi
        };
    });

    // Fix IPC codes: normalize format
    parsed.ipc_codes = parsed.ipc_codes.map((ipc: any) => {
        if (typeof ipc === 'string') return { code: ipc.trim(), justification: '' };
        return { code: (ipc.code || '').trim(), justification: (ipc.justification || '').trim() };
    }).filter((ipc: any) => ipc.code.length > 0);

    // Fix techBlocks
    parsed.techBlocks = parsed.techBlocks.map((tb: any, i: number) => ({
        id: tb.id || `tb${i + 1}`,
        name: tb.name || `Bloco ${i + 1}`,
        description: tb.description || ''
    }));

    return parsed;
}

fastify.post('/strategy', async (request, reply) => {
    const { briefing } = request.body as { briefing: any };
    if (!briefing) return reply.code(400).send({ error: 'Briefing object is required' });

    const formattedBriefing = formatBriefingForPrompt(briefing);

    const prompt = `Analise o briefing técnico abaixo e gere uma estratégia de busca de patentes com MÁXIMO RECALL.

═══════════════════════════════════════
BRIEFING DA INVENÇÃO
═══════════════════════════════════════
${formattedBriefing}

═══════════════════════════════════════
INSTRUÇÕES
═══════════════════════════════════════

1) BLOCOS TECNOLÓGICOS (techBlocks)
Identifique 2-4 eixos tecnológicos independentes da invenção.
Use descrições funcionais curtas.

2) CAMADAS DE KEYWORDS (blocks)
Crie EXATAMENTE 3 camadas obrigatórias, cada uma representando uma DIMENSÃO da invenção:

CAMADA 1 — OBJETO (o que É): tipo de dispositivo, aparelho, sistema, estrutura.
  Ex: "dispositivo", "device", "aparelho", "apparatus", "sensor", "wearable"

CAMADA 2 — AÇÃO/FUNÇÃO (o que FAZ): verbos e substantivos de ação que descrevem a função principal.
  Ex: "monitorar", "monitor", "monitoramento", "monitoring", "medir", "measure", "aquecer", "heat", "resfriar", "cool"

CAMADA 3 — DOMÍNIO/APLICAÇÃO (onde/para que): área de aplicação, material, ou finalidade.
  Ex: "saúde", "health", "construção civil", "building", "alimento", "food"

REGRAS CRÍTICAS DE TERMOS (siga na ordem para CADA grupo):
a) SEPARE ESTRITAMENTE POR IDIOMA: Não misture idiomas. Use "terms_pt" APENAS para português e "terms_en" APENAS para inglês.
b) PRIMEIRO: 3-4 termos SIMPLES de 1 palavra — substantivos/verbos genéricos rigorosamente sinônimos.
c) DEPOIS: variações morfológicas do idioma (verbo/substantivo/adjetivo/agente):
   Ex PT: "monitorar", "monitoramento" / Ex EN: "monitor", "monitoring"
d) DEPOIS: sinônimos do cotidiano industrial na respectiva língua:
   Ex: "medir" = "aferir" = "mensurar" / "prensa" = "compressor"
e) POR ÚLTIMO: termos compostos mais específicos:
   Ex: "dispositivo de monitoramento", "monitoring device"
f) Mínimo 7-10 termos por grupo SOMANDO OS DOIS IDIOMAS.
g) NÃO use: termos de marca, neologismos, gírias.

3) SEARCH LEVELS (searchLevels) — 3 níveis de queries PRONTAS

REGRAS CQL (Espacenet):
- Sintaxe: ta all "termo" (SEMPRE "ta all", NUNCA "ti=" ou "ab=")
- Máx 300 caracteres por query
- Nível 1: máx 1 AND — busca ampla, use termos SIMPLES de 1 palavra
- Nível 2: máx 2 AND — cruza OBJETO + AÇÃO
- Nível 3: máx 3 AND — cruza OBJETO + AÇÃO + DOMÍNIO

REGRAS INPI:
- Sintaxe: ("termo1" OR "termo2") AND ("termo3" OR "termo4")
- SOMENTE termos em Português
- Mesmas restrições de AND por nível

4) CÓDIGOS IPC (ipc_codes)
3-5 códigos IPC/CPC mais relevantes com justificativa técnica de 1 linha.

═══════════════════════════════════════
EXEMPLO COMPLETO
═══════════════════════════════════════

Briefing: Dispositivo vestível para monitoramento contínuo de saúde com coleta de dados fisiológicos.

{
  "techBlocks": [
    { "id": "tb1", "name": "Dispositivo Vestível", "description": "Equipamento portátil vestível para uso contínuo no corpo" },
    { "id": "tb2", "name": "Monitoramento Fisiológico", "description": "Captação e análise de dados biométricos e fisiológicos" },
    { "id": "tb3", "name": "Saúde e Bem-Estar", "description": "Aplicação em saúde preventiva e acompanhamento clínico" }
  ],
  "blocks": [
    {
      "id": "b1", "connector": "AND",
      "groups": [
        { "id": "g1", "terms_pt": ["dispositivo", "aparelho", "equipamento", "vestível", "sensor", "portátil", "dispositivo vestível"], "terms_en": ["device", "apparatus", "equipment", "wearable", "sensor", "portable", "wearable device"] }
      ]
    },
    {
      "id": "b2", "connector": "AND",
      "groups": [
        { "id": "g2", "terms_pt": ["monitorar", "monitoramento", "medir", "medição", "detecção", "rastrear", "sensoriamento", "coletar", "coleta de dados"], "terms_en": ["monitor", "monitoring", "measure", "detect", "track", "sense", "collect", "data acquisition"] }
      ]
    },
    {
      "id": "b3", "connector": "AND",
      "groups": [
        { "id": "g3", "terms_pt": ["saúde", "médico", "clínico", "fisiológico", "biométrico", "bem-estar", "sinais vitais", "frequência cardíaca"], "terms_en": ["health", "medical", "clinical", "physiological", "biometric", "wellness", "vital signs", "heart rate"] }
      ]
    }
  ],
  "searchLevels": [
    {
      "level": 1,
      "label": "Busca Ampla",
      "cql": "ta all wearable OR ta all sensor OR ta all \"wearable device\" OR ta all \"portable device\"",
      "inpi": "(\"dispositivo\" OR \"vestível\" OR \"sensor\" OR \"aparelho\" OR \"portátil\")"
    },
    {
      "level": 2,
      "label": "Interseção: Objeto + Ação",
      "cql": "(ta all wearable OR ta all sensor OR ta all device) AND (ta all monitoring OR ta all measuring OR ta all detecting)",
      "inpi": "(\"dispositivo\" OR \"vestível\" OR \"sensor\") AND (\"monitoramento\" OR \"medição\" OR \"detecção\")"
    },
    {
      "level": 3,
      "label": "Busca Refinada: Objeto + Ação + Domínio",
      "cql": "(ta all wearable OR ta all sensor) AND (ta all monitoring OR ta all measuring) AND (ta all health OR ta all physiological OR ta all biometric)",
      "inpi": "(\"vestível\" OR \"sensor\") AND (\"monitoramento\" OR \"medição\") AND (\"saúde\" OR \"fisiológico\" OR \"biométrico\")"
    }
  ],
  "ipc_codes": [
    { "code": "A61B 5/00", "justification": "Medição para fins de diagnóstico; identificação de pessoas" },
    { "code": "G16H 40/67", "justification": "Informática em saúde com dispositivos vestíveis" },
    { "code": "A61B 5/024", "justification": "Medição de frequência cardíaca ou pressão arterial" }
  ]
}

═══════════════════════════════════════
AGORA GERE A ESTRATÉGIA PARA O BRIEFING ACIMA
═══════════════════════════════════════
LEMBRE: 3 CAMADAS OBRIGATÓRIAS (Objeto + Ação + Domínio). Termos simples primeiro, depois compostos. Mínimo 7-10 termos por grupo.
Retorne APENAS o JSON, sem texto adicional.`;

    try {
        const raw = await generateWithGemini(prompt, true, STRATEGY_SYSTEM_MESSAGE);
        let parsed = JSON.parse(raw);
        parsed = validateAndFixStrategy(parsed);
        fastify.log.info(`Strategy generated: ${parsed.techBlocks?.length || 0} tech blocks, ${parsed.blocks?.length || 0} keyword blocks, ${parsed.searchLevels?.length || 0} search levels, ${parsed.ipc_codes?.length || 0} IPC codes`);
        return parsed;
    } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Failed to generate strategy', details: error.message });
    }
});

// ─── POST /search/espacenet ────────────────────────────────────
fastify.post('/search/espacenet', async (request, reply) => {
    const { cql } = request.body as { cql: string };
    if (!cql) return reply.code(400).send({ error: 'CQL query is required' });

    try {
        const token = await getOpsToken();
        const url = `https://ops.epo.org/3.2/rest-services/published-data/search/biblio?q=${encodeURIComponent(cql)}`;

        const response = await espacenetQueue.enqueue(() => axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            timeout: 30000
        }));

        const results = parseOpsResponse(response.data);
        const translated = await translatePatentsToPortuguese(results);
        return { results: translated, total: translated.length };
    } catch (error: any) {
        request.log.error(error);
        if (error.response?.status === 404) {
            return { results: [], total: 0 };
        }
        return reply.code(500).send({ error: 'Espacenet search failed', details: error.message });
    }
});

function parseOpsResponse(data: any): any[] {
    const results: any[] = [];
    const biblioData = data?.['ops:world-patent-data']?.['ops:biblio-search']?.['ops:search-result']?.['exchange-documents'];
    if (!biblioData) return [];

    const toArray = (value: any): any[] => {
        if (!value) return [];
        return Array.isArray(value) ? value : [value];
    };

    const extractText = (value: any): string => {
        if (!value) return '';
        if (typeof value === 'string') return value.trim();
        if (Array.isArray(value)) {
            return value.map(extractText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        }
        if (typeof value === 'object') {
            if (typeof value.$ === 'string') return value.$.trim();
            if (typeof value._ === 'string') return value._.trim();
            return Object.values(value).map(extractText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        }
        return '';
    };

    const docs = toArray(biblioData);

    for (const doc of docs) {
        const exchangeDocs = doc?.['exchange-document']
            ? toArray(doc['exchange-document'])
            : (doc?.['bibliographic-data'] ? [doc] : []);

        for (const exchangeDoc of exchangeDocs) {
            if (!exchangeDoc) continue;
            const bibData = exchangeDoc['bibliographic-data'];
            if (!bibData) continue;

            let title = 'Sem Título';
            const invTitle = toArray(bibData?.['invention-title']);
            if (invTitle.length > 0) {
                const preferredTitle = invTitle.find((t: any) => t?.['@lang'] === 'pt' || t?.['@lang'] === 'en') || invTitle[0];
                title = extractText(preferredTitle) || 'Sem Título';
            }

            let abstract = '';
            const absData = toArray(exchangeDoc['abstract']);
            if (absData.length > 0) {
                const preferredAbs = absData.find((a: any) => a?.['@lang'] === 'pt' || a?.['@lang'] === 'en') || absData[0];
                abstract = extractText(preferredAbs?.p ?? preferredAbs);
            }

            let applicant = 'Desconhecido';
            const parties = toArray(bibData?.['parties']?.['applicants']?.['applicant']);
            if (parties.length > 0) {
                const appObj = parties[0];
                applicant = extractText(appObj?.['applicant-name']?.['name']) || 'Desconhecido';
            }

            let inventor = '';
            const inventors = toArray(bibData?.['parties']?.['inventors']?.['inventor']);
            if (inventors.length > 0) {
                inventor = inventors
                    .map((inv: any) => extractText(inv?.['inventor-name']?.['name']))
                    .filter(Boolean)
                    .join('; ');
            }

            const pubRef = toArray(bibData?.['publication-reference']?.['document-id']);
            const docDb = pubRef.find((r: any) => r?.['@document-id-type'] === 'docdb') || pubRef[0] || {};
            const pubDate = extractText(docDb?.['date']);
            const pubNum = extractText(docDb?.['doc-number']);
            const country = extractText(docDb?.['country']);
            const kind = extractText(docDb?.['kind']);
            const publicationNumber = `${country}${pubNum}${kind}`.trim();

            let classification = '';
            const classData = toArray(bibData?.['patent-classifications']?.['patent-classification']);
            if (classData.length > 0) {
                const cls = classData[0];
                classification = `${extractText(cls?.['section'])}${extractText(cls?.['class'])}${extractText(cls?.['subclass'])} ${extractText(cls?.['main-group'])}/${extractText(cls?.['subgroup'])}`.trim();
            }

            if (!publicationNumber && !title) continue;

            results.push({
                publicationNumber: publicationNumber || `${country} ${pubNum}`.trim(),
                title,
                applicant,
                inventor,
                date: pubDate,
                abstract,
                classification,
                source: 'Espacenet',
                figures: [],
                url: publicationNumber
                    ? `https://worldwide.espacenet.com/patent/search?q=pn%3D${publicationNumber}`
                    : `https://worldwide.espacenet.com/patent/search?q=${encodeURIComponent(title)}`
            });
        }
    }
    return results.filter((item, index, arr) =>
        arr.findIndex((x) => x.publicationNumber === item.publicationNumber && x.source === item.source) === index
    );
}

// Heuristic: detect if text is likely already in Portuguese
function isLikelyPortuguese(text: string): boolean {
    if (!text || text.length < 10) return true;
    const ptIndicators = /\b(de|da|do|das|dos|para|com|uma|um|que|não|por|são|pelo|pela|entre|sobre|como|mais|também|esta|este|ao|aos|nas|nos|seu|sua|pode|tem|foi|ser|ter|está)\b/i;
    const words = text.split(/\s+/).slice(0, 20);
    const ptMatches = words.filter(w => ptIndicators.test(w)).length;
    return ptMatches >= 3;
}

// Batch translate patent titles and abstracts to PT-BR using LLM
async function translatePatentsToPortuguese(patents: any[]): Promise<any[]> {
    if (!patents.length) return patents;

    // Filter patents that need translation (title or abstract not in PT)
    const needsTranslation = patents.filter(
        p => !isLikelyPortuguese(p.title) || (!isLikelyPortuguese(p.abstract) && p.abstract)
    );

    if (needsTranslation.length === 0) return patents;

    // Process in batches of 10
    const batchSize = 10;
    const translatedMap = new Map<string, { title: string; abstract: string }>();

    for (let i = 0; i < needsTranslation.length; i += batchSize) {
        const batch = needsTranslation.slice(i, i + batchSize);

        const items = batch.map((p, idx) =>
            `[${idx}] TÍTULO: ${p.title}\nRESUMO: ${(p.abstract || '').substring(0, 400)}`
        ).join('\n\n');

        const prompt = `Traduza os títulos e resumos de patentes abaixo para Português Brasileiro (PT-BR). Mantenha terminologia técnica precisa.

${items}

Responda APENAS um JSON array com objetos na mesma ordem:
[{"index":0,"title":"título traduzido","abstract":"resumo traduzido"},...]

Se o texto já estiver em português, retorne-o sem alteração. Se o resumo estiver vazio, retorne string vazia.`;

        try {
            const raw = await generateWithGemini(prompt, true);
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                parsed = JSON.parse(match ? match[1] : raw);
            }
            const translations = Array.isArray(parsed) ? parsed : (parsed.translations || parsed.results || []);

            translations.forEach((t: any, idx: number) => {
                if (batch[idx]) {
                    translatedMap.set(batch[idx].publicationNumber, {
                        title: t.title || batch[idx].title,
                        abstract: t.abstract ?? batch[idx].abstract
                    });
                }
            });
        } catch (err: any) {
            // Translation failed for this batch — keep originals
            console.warn(`Translation batch failed: ${err.message}`);
        }

        // Small delay between translation batches
        if (i + batchSize < needsTranslation.length) {
            await new Promise(resolve => setTimeout(resolve, 800));
        }
    }

    // Apply translations
    return patents.map(p => {
        const translation = translatedMap.get(p.publicationNumber);
        if (translation) {
            return { ...p, title: translation.title, abstract: translation.abstract };
        }
        return p;
    });
}

// ─── POST /search/inpi ─────────────────────────────────────────
fastify.post('/search/inpi', async (request, reply) => {
    const { keywords, ipc_codes, ignoreSecret } = request.body as { keywords: string[]; ipc_codes: string[]; ignoreSecret?: boolean };
    if (!keywords?.length) return reply.code(400).send({ error: 'Keywords are required' });

    try {
        const local = await searchLocalPatentBase({
            keywords: keywords.join(' '),
            ipcCodes: ipc_codes,
            ignoreSecret,
            page: 1,
            pageSize: 200
        });
        const results = local.results;
        enqueueSearchResultsPersistence(results);
        return { results, total: results.length };
    } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'INPI search failed', details: error.message });
    }
});

// ─── INPI Session + Search via curl ─────────────────────────────

function parseInpiResults(html: string): any[] {
    const $ = cheerio.load(html);
    const results: any[] = [];
    const baseUrl = 'https://busca.inpi.gov.br';

    $('table tr').each((_, row) => {
        const link = $(row).find('a[href*="PatenteServletController"]').first();
        if (!link.length) return;

        // Only accept detail view links (skips pagination, header/footer)
        const href = link.attr('href') || '';
        const onclick = link.attr('onclick') || '';
        if (!href.includes('Action=detail') && !onclick.includes('Action=detail')) return;
        
        // Skip links that just look like page numbers or control text
        const linkText = link.text().trim();
        if (/^\d+$/.test(linkText) && linkText.length < 5) return;
        if (/pr[óo]xima|anterior|in[íi]cio|fim/i.test(linkText)) return;

        const cells = $(row).find('td');
        if (cells.length < 2) return;

        const number = linkText;
        if (!number) return;

        const codMatch = (href.match(/[?&]CodPedido=(\d+)/i) || onclick.match(/[?&]CodPedido=(\d+)/i));
        const codPedido = codMatch ? codMatch[1] : '';
        const detailUrl = href
            ? new URL(href, baseUrl).toString()
            : (codPedido
                ? `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${codPedido}`
                : `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${encodeURIComponent(number)}`);

        const cellTexts = cells.toArray()
            .map((c) => $(c).text().replace(/\s+/g, ' ').trim())
            .filter(Boolean);

        const dateFromCell = cells.length > 1 ? $(cells[1]).text().replace(/\s+/g, ' ').trim() : '';
        const dateFromRow = cellTexts.find((text) => /\d{2}\/\d{2}\/\d{4}/.test(text)) || '';
        const date = dateFromCell || dateFromRow;

        let title = cells.length > 2
            ? ($(cells[2]).find('b').first().text().trim() || $(cells[2]).text().replace(/\s+/g, ' ').trim())
            : '';
        if (!title) {
            title = cellTexts.find((text) => text !== number && text !== date && text.length > 12) || '';
        }

        const classificationByCell = cells.length > 3 ? $(cells[3]).text().replace(/\s+/g, ' ').trim() : '';
        const classificationByPattern = cellTexts.find((text) => /^[A-H]\d{2}[A-Z]/i.test(text)) || '';
        const classification = classificationByCell || classificationByPattern;

        const isSecret = !title || /sigilo|aguardando\s+publica/i.test(title) || /sigilo|aguardando\s+publica/i.test(classification);

        if (number) {
            results.push({
                publicationNumber: number,
                title: title || 'Mantido em sigilo',
                applicant: '',
                date,
                abstract: '',
                classification,
                source: 'INPI',
                url: detailUrl,
                status: isSecret ? 'Mantido em sigilo' : undefined
            });
        }
    });

    const pageText = $.root().text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
    // Improved regex to capture totals even with dots/commas and varied bold tags
    const totalMatch = html.match(/Foram\s+encontrados.*?<b>\s*([\d.,]+)\s*<\/b>\s*processos/i)
        || html.match(/Foram\s+encontrados.*?([\d.,]+)\s*processos/i)
        || html.match(/Foram\s+encontrados.*?<b>\s*([\d.,]+)\s*<\/b>/i)
        || pageText.match(/Foram\s+encontrados\s*([\d.,]+)/i);
    
    const totalRaw = totalMatch?.[1]?.replace(/[^\d]/g, '');
    const currentPageMatch = html.match(/Mostrando\s+p[aá]gina[\s\S]{0,60}?<b>\s*(\d+)\s*<\/b>[\s\S]{0,40}?<b>\s*(\d+)\s*<\/b>/i)
        || pageText.match(/Mostrando\s+p[aá]gina\s*(\d+)\s*de\s*(\d+)/i);
    const currentPage = currentPageMatch ? parseInt(currentPageMatch[1], 10) : 1;
    const totalPagesFromText = currentPageMatch ? parseInt(currentPageMatch[2], 10) : 1;
    const linkedPageNumbers = Array.from(html.matchAll(/Action=nextPage&Page=(\d+)/gi))
        .map((m) => parseInt(m[1], 10))
        .filter((v) => Number.isFinite(v) && v > 0);
    const maxLinkedPage = linkedPageNumbers.length > 0 ? Math.max(...linkedPageNumbers) : currentPage;
    const totalPages = Math.max(totalPagesFromText, maxLinkedPage, currentPage);
    const perPage = results.length;
    const minimumTotalByPage = Math.max(0, (currentPage - 1) * Math.max(perPage, 1) + results.length);
    const minimumTotalByLinks = totalPages > currentPage ? totalPages * Math.max(perPage, 1) : minimumTotalByPage;
    const total = totalRaw
        ? Math.max(parseInt(totalRaw, 10), minimumTotalByPage)
        : Math.max(minimumTotalByPage, minimumTotalByLinks);
    fastify.log.info(`INPI: found ${perPage} results on page ${currentPage}/${totalPages} (reported total: ${total})`);

    (results as any).total = total;
    (results as any).perPage = perPage;
    (results as any).currentPage = currentPage;
    (results as any).totalPages = totalPages;
    return results;
}

const INPI_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const INPI_SEC_HEADERS = `-H 'sec-ch-ua: "Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"' -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Mac OS X"'`;

async function initializeInpiSession(cookieFile: string): Promise<void> {
    const payloadFilePrimary = `/tmp/inpi_login_primary_${randomUUID()}.txt`;
    const payloadFileFallback = `/tmp/inpi_login_fallback_${randomUUID()}.txt`;
    const loginUrl = 'https://busca.inpi.gov.br/pePI/servlet/LoginController';
    const debugLog = `/tmp/inpi_init_${randomUUID()}.log`;

    fs.writeFileSync(debugLog, `Init session start for ${cookieFile}\n`);

    try {
        fs.appendFileSync(debugLog, 'Step 1: Accessing root page to get initial cookies...\n');
        await execInpiCurlWithRetry(
            `curl -v --http1.1 -L -A '${INPI_USER_AGENT}' ${INPI_SEC_HEADERS} -c ${cookieFile} 'https://busca.inpi.gov.br/pePI/' -o /dev/null`,
            3,
            20000
        );

        if (fs.existsSync(cookieFile)) {
            const cookies = fs.readFileSync(cookieFile, 'utf8');
            fs.appendFileSync(debugLog, `Initial cookies:\n${cookies}\n`);
        }

        const inpiUser = process.env.INPI_USER || '';
        const inpiPass = (process.env.INPI_PASSWORD || '').replace(/!/g, '%21');
        const loginPayload = `T_Login=${encodeURIComponent(inpiUser)}&T_Senha=${inpiPass}&action=login&Usuario=`;

        fs.writeFileSync(payloadFilePrimary, loginPayload, 'utf8');
        fs.appendFileSync(debugLog, `Step 2: Authenticating as ${inpiUser ? inpiUser : 'anonymous'}...\n`);

        const loginResp = `/tmp/inpi_login_resp_${randomUUID()}.html`;
        await execInpiCurlWithRetry(
            `curl -v --http1.1 -L -A '${INPI_USER_AGENT}' ${INPI_SEC_HEADERS} ` +
            `-H 'Content-Type: application/x-www-form-urlencoded' ` +
            `-H 'Origin: https://busca.inpi.gov.br' ` +
            `-H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8' ` +
            `-e 'https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login' ` +
            `-b ${cookieFile} -c ${cookieFile} ` +
            `-X POST '${loginUrl}' --data-binary @${payloadFilePrimary} -o ${loginResp}`,
            3,
            30000
        );

        if (fs.existsSync(cookieFile)) {
            const cookies = fs.readFileSync(cookieFile, 'utf8');
            fs.appendFileSync(debugLog, `Cookies after POST:\n${cookies}\n`);
        }

        if (fs.existsSync(loginResp)) {
            const respHtml = fs.readFileSync(loginResp, 'utf8');
            const userRef = inpiUser || 'leopickler';
            if (!respHtml.includes(`Login: ${userRef}`)) {
                fs.appendFileSync(debugLog, `Login check failed: 'Login: ${userRef}' not found in response.\n`);
                // If we're on the login page, it's a hard failure
                if (respHtml.toLowerCase().includes('para realizar a pesquisa anonimamente')) {
                    throw new Error('Falha na autenticação INPI: Login ignorado pelo portal.');
                }
            } else {
                fs.appendFileSync(debugLog, `Login confirmed for ${userRef}.\n`);
            }
            try { fs.unlinkSync(loginResp); } catch { }
        }

        // Step 3: Access PatenteSearchBasico.jsp to ensure session is bound to the patent module
        fs.appendFileSync(debugLog, 'Step 3: Accessing Patente Busca page to bind session...\n');
        await execInpiCurlWithRetry(
            `curl -s --http1.1 -L -A '${INPI_USER_AGENT}' ${INPI_SEC_HEADERS} ` +
            `-e 'https://busca.inpi.gov.br/pePI/servlet/LoginController' ` +
            `-b ${cookieFile} -c ${cookieFile} 'https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchBasico.jsp' -o /dev/null`,
            3,
            20000
        );

        // Step 4: Access SearchAvancado to fully activate patent session
        fs.appendFileSync(debugLog, 'Step 4: Accessing SearchAvancado...\n');
        await execInpiCurlWithRetry(
            `curl -s --http1.1 -L -A '${INPI_USER_AGENT}' ${INPI_SEC_HEADERS} ` +
            `-e 'https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchBasico.jsp' ` +
            `-b ${cookieFile} -c ${cookieFile} 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=SearchAvancado' -o /dev/null`,
            3,
            20000
        );

        fs.appendFileSync(debugLog, 'Session initialized successfully.\n');
    } catch (err: any) {
        fs.appendFileSync(debugLog, `Init failed: ${err.message}\nStack: ${err.stack}\n`);
        throw err;
    } finally {
        try { fs.unlinkSync(payloadFilePrimary); } catch { }
        try { fs.unlinkSync(payloadFileFallback); } catch { }
    }
}

async function fetchPatentDetailViaCurl(cookieFile: string, detailUrl: string): Promise<Partial<any>> {
    try {
        // fastify.log.info(`Fetching detail: ${detailUrl}`);
        const { stdout } = await execInpiCurlWithRetry(
            `curl -s --http1.1 -L -A '${INPI_USER_AGENT}' ${INPI_SEC_HEADERS} ` +
            `-H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' ` +
            `-e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} '${detailUrl}' | iconv -f ISO-8859-1 -t UTF-8`,
            3,
            20000,
            10 * 1024 * 1024
        );
        const $ = cheerio.load(stdout);

        const extract = (label: string) => {
            // Find td containing the label, then get the next td's text
            // Note: The label might be in a font tag inside the td
            return $('td').filter((_, el) => $(el).text().includes(label)).first().next().text().replace(/\s+/g, ' ').trim();
        };

        const applicant = extract('Nome do Depositante:');
        const inventor = extract('Nome do Inventor:');
        const title = extract('Título:');
        const abstract = extract('Resumo:');
        const status = extract('Despacho:') || extract('Situação:');

        // fastify.log.info(`Extracted for ${detailUrl}: applicant="${applicant}" inventor="${inventor}"`);

        return {
            applicant,
            inventor,
            title,
            abstract,
            status
        };
    } catch (error: any) {
        console.error(`Error fetching detail for ${detailUrl}:`, error.message);
        return {};
    }
}

async function searchInpiViaCurl(params: {
    number?: string;
    titular?: string;
    inventor?: string;
    keywords?: string;
    resumo?: string;
    page?: number;
    pageSize?: number;
    maxPages?: number;
    enrichDetails?: boolean;
    enrichLimit?: number;
    ignoreSecret?: boolean;
    cookieFile?: string;
}): Promise<any[]> {
    const cookieFile = params.cookieFile || `/tmp/inpi_${randomUUID()}.txt`;
    const payloadFile = `/tmp/inpi_payload_${randomUUID()}.txt`;

    try {
        if (!params.cookieFile) {
            await initializeInpiSession(cookieFile);
        }

        const requestedPage = typeof params.page === 'number' && params.page > 0 ? Math.floor(params.page) : 1;
        const requestedPageSize = typeof params.pageSize === 'number' && params.pageSize > 0
            ? Math.min(Math.max(Math.floor(params.pageSize), 10), 100)
            : 100;
        const fields: Record<string, string> = {
            Action: 'SearchAvancado',
            NumPedido: params.number?.trim() || '',
            NumGru: '',
            NumProtocolo: '',
            NumPrioridade: '',
            CodigoPct: '',
            DataDeposito1: '',
            DataDeposito2: '',
            DataPrioridade1: '',
            DataPrioridade2: '',
            DataDepositoPCT1: '',
            DataDepositoPCT2: '',
            DataPublicacaoPCT1: '',
            DataPublicacaoPCT2: '',
            ClassificacaoIPC: '',
            CatchWordIPC: '',
            Titulo: params.keywords?.trim() || '',
            Resumo: params.resumo?.trim() || '',
            NomeDepositante: params.titular?.trim() || '',
            CpfCnpjDepositante: '',
            NomeInventor: params.inventor?.trim() || '',
            RegisterPerPage: String(requestedPageSize),
            botao: ' pesquisar » ',
        };

        const postBody = Object.entries(fields)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');
        fs.writeFileSync(payloadFile, postBody, 'utf8');
        fastify.log.info(`INPI curl search: Titulo="${(params.keywords || '').substring(0, 100)}" Resumo="${(params.resumo || '').substring(0, 100)}"`);

        const { stdout, stderr } = await execInpiCurlWithRetry(
            `curl -sS -L --http1.1 -A '${INPI_USER_AGENT}' ${INPI_SEC_HEADERS} -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController' --data-binary @${payloadFile} | iconv -f ISO-8859-1 -t UTF-8`,
            3,
            35000,
            50 * 1024 * 1024
        );

        // Don't delete cookies yet - needed for details
        try { fs.unlinkSync(payloadFile); } catch { }

        let firstPageResults = parseInpiResults(stdout);
        const baseNextPageUrl = 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=nextPage';
        const firstPageReportedTotal = (firstPageResults as any).total as number | undefined;
        const firstPageLooksIncomplete = requestedPage === 1
            && firstPageResults.length > 0
            && firstPageResults.length < requestedPageSize
            && typeof firstPageReportedTotal === 'number'
            && firstPageReportedTotal > firstPageResults.length;
        if (firstPageResults.length === 0 || firstPageLooksIncomplete) {
            try {
                const { stdout: firstPageFallbackHtml } = await execInpiCurlWithRetry(
                    `curl -s -L --http1.1 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} '${baseNextPageUrl}&Page=1&Resumo=&Titulo=' | iconv -f ISO-8859-1 -t UTF-8`,
                    2,
                    25000,
                    50 * 1024 * 1024
                );
                const fallbackResults = parseInpiResults(firstPageFallbackHtml);
                if (fallbackResults.length > 0) {
                    firstPageResults = fallbackResults;
                }
            } catch (fallbackErr: any) {
                fastify.log.warn(`INPI page 1 fallback failed: ${fallbackErr.message}`);
            }
        }
        const reportedTotal: number | undefined = (firstPageResults as any).total;
        const perPageFromHtml: number | undefined = (firstPageResults as any).perPage;
        const reportedTotalPages: number | undefined = (firstPageResults as any).totalPages;
        const maxResults = 10000;
        const maxPages = typeof params.maxPages === 'number' && params.maxPages > 0 ? params.maxPages : 20;
        const targetTotal = reportedTotal && reportedTotal > 0 ? Math.min(reportedTotal, maxResults) : maxResults;
        const perPageEstimate = perPageFromHtml && perPageFromHtml > 0 ? perPageFromHtml : requestedPageSize;
        const estimatedTotalPages = reportedTotalPages && reportedTotalPages > 0
            ? reportedTotalPages
            : Math.max(1, Math.ceil(targetTotal / Math.max(perPageEstimate, 1)));

        let pageResults = firstPageResults;
        if (requestedPage > 1) {
            const targetPage = Math.min(requestedPage, estimatedTotalPages);
            const pageUrl = `${baseNextPageUrl}&Page=${targetPage}&Resumo=&Titulo=`;
            try {
                const { stdout: pageHtml } = await execInpiCurlWithRetry(
                    `curl -s -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} '${pageUrl}' | iconv -f ISO-8859-1 -t UTF-8`,
                    3,
                    25000,
                    50 * 1024 * 1024
                );
                pageResults = parseInpiResults(pageHtml);
            } catch (pageErr: any) {
                fastify.log.warn(`INPI target page fetch failed for Page=${targetPage}: ${pageErr.message}`);
            }
        }

        let pageMetaTotal = reportedTotal ?? (pageResults as any).total ?? pageResults.length;
        const pageMetaPerPage = (pageResults as any).perPage ?? perPageEstimate;
        const pageMetaCurrentPage = (pageResults as any).currentPage ?? Math.min(requestedPage, estimatedTotalPages);
        const pageMetaTotalPages = reportedTotalPages ?? (pageResults as any).totalPages ?? estimatedTotalPages;

        if (requestedPage === 1 && reportedTotal && perPageFromHtml && reportedTotal > perPageFromHtml) {
            const results = pageResults;
            const totalPages = Math.min(Math.ceil(reportedTotal / perPageFromHtml), maxPages);
            fastify.log.info(`INPI: fetching up to ${totalPages} pages (~${targetTotal} results)`);

            const pagesToFetch = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
            const batchSize = 3;

            for (let i = 0; i < pagesToFetch.length; i += batchSize) {
                if (results.length >= targetTotal) break;
                const batch = pagesToFetch.slice(i, i + batchSize);
                fastify.log.info(`Fetching INPI pages batch: ${batch.join(', ')}`);

                await Promise.all(batch.map(async (page) => {
                    if (results.length >= targetTotal) return;
                    const pageUrl = `${baseNextPageUrl}&Page=${page}&Resumo=&Titulo=`;
                    try {
                        const { stdout: pageHtml } = await execInpiCurlWithRetry(
                            `curl -s -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} '${pageUrl}' | iconv -f ISO-8859-1 -t UTF-8`,
                            2, // max retries
                            25000,
                            50 * 1024 * 1024
                        );
                        const pageTempResults = parseInpiResults(pageHtml);
                        for (const item of pageTempResults) {
                            if (results.length >= targetTotal) break;
                            const already = results.some((r: any) =>
                                r.publicationNumber === item.publicationNumber &&
                                r.source === item.source
                            );
                            if (!already) {
                                results.push(item);
                            }
                        }
                    } catch (pageErr: any) {
                        fastify.log.warn(`INPI nextPage fetch failed for Page=${page}: ${pageErr.message}`);
                    }
                }));
            }
        }

        let results = pageResults;
        if (params.ignoreSecret) {
            const initialCount = results.length;
            results = results.filter((r: any) => r.status !== 'Mantido em sigilo');
            const ignoredCount = initialCount - results.length;
            pageMetaTotal -= ignoredCount;
        }

        (results as any).total = pageMetaTotal;
        (results as any).perPage = pageMetaPerPage;
        (results as any).currentPage = pageMetaCurrentPage;
        (results as any).totalPages = pageMetaTotalPages;

        if (results.length === 0) {
            const debugFile = `/tmp/inpi_debug_fail_${randomUUID()}.html`;
            fs.writeFileSync(debugFile, stdout);
            fastify.log.warn(`INPI search returned 0 results. Saved HTML to ${debugFile}`);
            if (stderr) fastify.log.warn(`INPI curl stderr: ${stderr}`);
        } else if (params.enrichDetails !== false) {
            const enrichLimit = typeof params.enrichLimit === 'number' && params.enrichLimit > 0
                ? Math.min(params.enrichLimit, results.length)
                : Math.min(results.length, 50); // Hard limit to 50 if not specified to avoid timeouts
            const targetResults = results.slice(0, enrichLimit);
            fastify.log.info(`Enriching ${targetResults.length} of ${results.length} INPI results with details...`);
            const batchSize = 5; // Reduced from 10 to 5 to protect INPI session limits
            for (let i = 0; i < targetResults.length; i += batchSize) {
                const batch = targetResults.slice(i, i + batchSize);
                fastify.log.info(`Processing batch ${i / batchSize + 1} of ${Math.ceil(targetResults.length / batchSize)}`);
                await Promise.all(batch.map(async (result) => {
                    if (!result.url) return;
                    try {
                        const details = await fetchPatentDetailViaCurl(cookieFile, result.url);
                        if (details.applicant) result.applicant = details.applicant;
                        if (details.inventor) result.inventor = details.inventor;
                        if (details.status) result.status = details.status;
                        if (details.title && (result.title === '(Sem título)' || !result.title)) {
                            result.title = details.title;
                        }
                        if (details.abstract && !result.abstract) result.abstract = details.abstract;
                    } catch (detailErr: any) {
                        fastify.log.error(`Failed to enrich detail for ${result.url}: ${detailErr.message}`);
                    }
                }));
            }
        }

        try { fs.unlinkSync(cookieFile); } catch { }
        return results;
    } catch (error: any) {
        try { fs.unlinkSync(cookieFile); } catch { }
        try { fs.unlinkSync(payloadFile); } catch { }

        const errorLogFile = `/tmp/inpi_error_${randomUUID()}.txt`;
        fs.writeFileSync(errorLogFile, `Error: ${error.message}\nStderr: ${error.stderr || ''}\nStack: ${error.stack}`);

        fastify.log.warn(`INPI curl search failed: ${error.message}. Log saved to ${errorLogFile}`);
        if (error.stderr) fastify.log.warn(`INPI curl stderr (error): ${error.stderr}`);
        return [];
    }
}

const ALLOWED_PATENT_DOCUMENT_HOSTS = [
    'busca.inpi.gov.br',
    'worldwide.espacenet.com',
    'ops.epo.org',
    'register.epo.org'
];

function isAllowedPatentDocumentUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        return ALLOWED_PATENT_DOCUMENT_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
    } catch {
        return false;
    }
}

function extractPdfCandidatesFromHtml(html: string, baseUrl: string): string[] {
    const $ = cheerio.load(html);
    const candidates = new Set<string>();

    const addCandidate = (rawValue?: string) => {
        if (!rawValue) return;
        try {
            const normalized = new URL(rawValue.trim(), baseUrl).toString();
            if (!isAllowedPatentDocumentUrl(normalized)) return;
            const lower = normalized.toLowerCase();
            if (!lower.includes('.pdf') && !lower.includes('pdf')) return;
            candidates.add(normalized);
        } catch {
            return;
        }
    };

    $('a[href], iframe[src], embed[src], object[data]').each((_, el) => {
        addCandidate($(el).attr('href'));
        addCandidate($(el).attr('src'));
        addCandidate($(el).attr('data'));
    });

    return Array.from(candidates).slice(0, 20);
}

function getFilenameFromHeaders(contentDisposition: string | undefined, fallback: string): string {
    if (!contentDisposition) return fallback;
    const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1]);
    const standardMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
    if (standardMatch?.[1]) return standardMatch[1];
    return fallback;
}

async function fetchPatentPdf(url: string, fallbackName: string): Promise<{ buffer: Buffer; filename: string }> {
    if (!isAllowedPatentDocumentUrl(url)) {
        throw new Error('URL de documento não permitida');
    }

    if (url.includes('busca.inpi.gov.br')) {
        const cookieFile = `/tmp/inpi_pdf_cookie_${randomUUID()}.txt`;
        const pdfFile = `/tmp/inpi_pdf_${randomUUID()}.pdf`;

        try {
            // Step 1: Initialize session
            await initializeInpiSession(cookieFile);
            fastify.log.info(`Downloading INPI document via authenticated cURL: ${url}`);

            // Step 2: Establish search context for this specific patent
            const codPedidoMatch = url.match(/CodPedido=(\d+)/);
            if (codPedidoMatch) {
                const codPedido = codPedidoMatch[1];
                fastify.log.info(`Establishing search context for CodPedido=${codPedido}`);
                // Use searchInpiViaCurl to perform a real POST search for this number
                // This activates the session for this specific record on the INPI side
                await searchInpiViaCurl({ number: codPedido, cookieFile });
            }

            // Step 3: Download the detail page (as HTML) to extract PDF candidates
            // IMPORTANT: Referer MUST be the PatenteServletController to get the body
            const secFetchHeaders = `-H 'Sec-Fetch-Site: same-origin' -H 'Sec-Fetch-Mode: navigate' -H 'Sec-Fetch-User: ?1' -H 'Sec-Fetch-Dest: document'`;
            let curlCmd = `curl -s --http1.1 -L -A '${INPI_USER_AGENT}' ${INPI_SEC_HEADERS} ${secFetchHeaders} ` +
                `-H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' ` +
                `-e 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController' -b ${cookieFile} -c ${cookieFile} '${url}' -o ${pdfFile}`;

            await new Promise<void>((resolve, reject) => {
                exec(curlCmd, { timeout: 60000 }, (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });

            if (!fs.existsSync(pdfFile)) {
                throw new Error("Falha no curl: arquivo não foi criado.");
            }

            // Check if it's already a PDF
            const magicBytes = fs.readFileSync(pdfFile, { encoding: 'binary', flag: 'r' }).substring(0, 5);
            if (magicBytes.startsWith('%PDF-')) {
                const buffer = fs.readFileSync(pdfFile);
                return { buffer, filename: fallbackName };
            }

            // If not a PDF, it's an HTML detail page
            const html = fs.readFileSync(pdfFile, 'utf8');
            const candidates = extractPdfCandidatesFromHtml(html, url);
            fastify.log.info(`Found ${candidates.length} PDF candidates in INPI HTML.`);

            if (candidates.length === 0) {
                const debugPath = `/tmp/inpi_fail_debug_${randomUUID()}.html`;
                fs.writeFileSync(debugPath, html);
                fastify.log.warn(`No PDF candidates found. Saved HTML to ${debugPath}`);
            }

            for (const candidate of candidates) {
                fastify.log.info(`Trying candidate: ${candidate}`);
                const candidateCmd = `curl -s --http1.1 -L -A '${INPI_USER_AGENT}' ${INPI_SEC_HEADERS} ` +
                    `-H 'Accept: application/pdf,application/octet-stream,*/*' ` +
                    `-e '${url}' -b ${cookieFile} -c ${cookieFile} '${candidate}' -o ${pdfFile}`;

                await new Promise<void>((resolve, reject) => {
                    exec(candidateCmd, { timeout: 60000 }, (error) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });

                if (fs.existsSync(pdfFile)) {
                    const magicBytesCand = fs.readFileSync(pdfFile, { encoding: 'binary', flag: 'r' }).substring(0, 5);
                    if (magicBytesCand.startsWith('%PDF-')) {
                        const buffer = fs.readFileSync(pdfFile);
                        fastify.log.info(`PDF successfully downloaded from candidate.`);
                        return { buffer, filename: fallbackName };
                    }
                }
            }

            throw new Error("Nenhum PDF real foi retornado pelas URLs candidatas do INPI.");

        } finally {
            try { if (fs.existsSync(cookieFile)) fs.unlinkSync(cookieFile); } catch { }
            try { if (fs.existsSync(pdfFile)) fs.unlinkSync(pdfFile); } catch { }
        }
    }

    // Fallback for non-INPI URLs
    const initialResponse = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/pdf,text/html;q=0.9,*/*;q=0.8'
        },
        validateStatus: (status) => status >= 200 && status < 400
    });

    const initialContentType = String(initialResponse.headers['content-type'] || '').toLowerCase();
    const initialContentDisposition = initialResponse.headers['content-disposition'] as string | undefined;
    if (initialContentType.includes('application/pdf')) {
        return {
            buffer: Buffer.from(initialResponse.data),
            filename: getFilenameFromHeaders(initialContentDisposition, fallbackName)
        };
    }

    const finalUrl = (initialResponse.request?.res?.responseUrl as string | undefined) || url;
    const html = Buffer.isBuffer(initialResponse.data)
        ? initialResponse.data.toString('utf8')
        : String(initialResponse.data || '');

    const candidates = extractPdfCandidatesFromHtml(html, finalUrl);
    for (const candidate of candidates) {
        const pdfResponse = await axios.get(candidate, {
            responseType: 'arraybuffer',
            timeout: 30000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/pdf,*/*;q=0.8'
            },
            validateStatus: (status) => status >= 200 && status < 400
        });
        const contentType = String(pdfResponse.headers['content-type'] || '').toLowerCase();
        const contentDisposition = pdfResponse.headers['content-disposition'] as string | undefined;
        if (!contentType.includes('application/pdf')) continue;
        return {
            buffer: Buffer.from(pdfResponse.data),
            filename: getFilenameFromHeaders(contentDisposition, fallbackName)
        };
    }

    throw new Error('PDF não encontrado para o documento solicitado');
}

function normalizeDocumentText(text: string): string {
    return text
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function translateDocumentTextToPortuguese(text: string): Promise<{ translatedText: string; originalLength: number; translated: boolean }> {
    const normalized = normalizeDocumentText(text);
    if (!normalized) {
        return { translatedText: '', originalLength: 0, translated: false };
    }
    const maxChars = 18000;
    const excerpt = normalized.substring(0, maxChars);
    if (isLikelyPortuguese(excerpt)) {
        return { translatedText: excerpt, originalLength: normalized.length, translated: false };
    }
    const prompt = `Traduza para Português Brasileiro (PT-BR) o texto técnico de patente abaixo, preservando termos técnicos e numeração.

Texto:
${excerpt}

Retorne somente o texto traduzido, sem explicações.`;
    try {
        const translated = (await generateWithGemini(prompt, false)).trim();
        if (translated) {
            return { translatedText: translated, originalLength: normalized.length, translated: true };
        }
        return { translatedText: excerpt, originalLength: normalized.length, translated: false };
    } catch {
        return { translatedText: excerpt, originalLength: normalized.length, translated: false };
    }
}


fastify.get('/patent/document', async (request, reply) => {
    const { url, publicationNumber } = request.query as {
        url?: string;
        publicationNumber?: string;
    };

    if (!url) {
        return reply.code(400).send({ error: 'Parâmetro url é obrigatório' });
    }

    const fallbackName = `${(publicationNumber || 'patente').replace(/[^\w.-]/g, '_')}.pdf`;
    try {
        const { buffer, filename } = await fetchPatentPdf(url, fallbackName);
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `inline; filename="${filename}"`);
        return reply.send(buffer);
    } catch (error: any) {
        fastify.log.warn(`Patent document fetch failed: ${error.message}`);
        return reply.code(404).send({ error: 'Não foi possível localizar PDF para esta patente' });
    }
});

fastify.get('/patent/document/translation', async (request, reply) => {
    const { url, publicationNumber } = request.query as {
        url?: string;
        publicationNumber?: string;
    };

    if (!url) {
        return reply.code(400).send({ error: 'Parâmetro url é obrigatório' });
    }

    const fallbackName = `${(publicationNumber || 'patente').replace(/[^\w.-]/g, '_')}.pdf`;
    try {
        const { buffer } = await fetchPatentPdf(url, fallbackName);
        const parsed = await pdfParse(buffer);
        const text = normalizeDocumentText(parsed.text || '');
        if (!text) {
            return reply.code(404).send({ error: 'Não foi possível extrair texto do PDF da patente' });
        }
        const translation = await translateDocumentTextToPortuguese(text);
        return {
            publicationNumber: publicationNumber || '',
            translatedText: translation.translatedText,
            originalLength: translation.originalLength,
            translated: translation.translated,
            truncated: translation.originalLength > 18000
        };
    } catch (error: any) {
        fastify.log.warn(`Patent document translation failed (PDF): ${error.message}`);

        // Fallback: Try to fetch full text from OPS if publicationNumber is available
        if (publicationNumber) {
            try {
                const opsText = await fetchFullTextFromOps(publicationNumber);
                if (opsText) {
                    const translation = await translateDocumentTextToPortuguese(opsText);
                    return {
                        publicationNumber: publicationNumber,
                        translatedText: translation.translatedText,
                        originalLength: translation.originalLength,
                        translated: translation.translated,
                        truncated: translation.originalLength > 18000
                    };
                }
            } catch (opsError: any) {
                fastify.log.warn(`Patent document translation failed (OPS fallback): ${opsError.message}`);
            }
        }

        return reply.code(404).send({ error: 'Não foi possível traduzir o documento desta patente' });
    }
});

async function fetchFullTextFromOps(publicationNumber: string): Promise<string | null> {
    if (!OPS_CONSUMER_KEY || !OPS_CONSUMER_SECRET) return null;
    const cleanedPn = publicationNumber.replace(/\s+/g, '');
    try {
        const token = await getOpsToken();
        const url = `https://ops.epo.org/3.2/rest-services/published-data/publication/epodoc/${cleanedPn}/fulltext`;
        const response = await espacenetQueue.enqueue(() => axios.get(url, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/xml' },
            timeout: 30000
        }));
        return extractTextFromOpsXml(response.data);
    } catch (error: any) {
        fastify.log.warn(`OPS fulltext failed for ${publicationNumber}: ${error.message}`);
        return null;
    }
}

function extractTextFromOpsXml(xml: string): string {
    const $ = cheerio.load(xml, { xmlMode: true });
    let text = '';

    // Extract description
    const description = $('description').text();
    if (description) {
        text += 'DESCRIÇÃO:\n\n' + description + '\n\n';
    }

    // Extract claims
    const claims = $('claims').text();
    if (claims) {
        text += 'REIVINDICAÇÕES:\n\n' + claims + '\n\n';
    }

    return text.trim();
}


// ─── POST /search/quick ────────────────────────────────────────
fastify.post('/search/quick', async (request, reply) => {
    const { number, titular, inventor, keywords, page, pageSize, includeEspacenet, ignoreSecret } = request.body as {
        number?: string;
        titular?: string;
        inventor?: string;
        keywords?: string;
        page?: number;
        pageSize?: number;
        includeEspacenet?: boolean;
        ignoreSecret?: boolean;
    };

    if (!number && !titular && !inventor && !keywords) {
        return reply.code(400).send({ error: 'Informe pelo menos um critério de busca' });
    }

    const requestedPage = typeof page === 'number' && page > 0 ? Math.floor(page) : 1;
    const requestedPageSize = typeof pageSize === 'number' && pageSize > 0
        ? Math.min(Math.max(Math.floor(pageSize), 10), 100)
        : 20;
    const shouldFetchEspacenet = includeEspacenet !== false;

    const cachedResults = await searchQuickSearchCache({ number, titular, inventor, keywords });
    let inpiResults: any[] = [];
    let espacenetResults: any[] = cachedResults.filter((item: any) => item.source === 'Espacenet');

    const fetchedInpiResults: any[] = [];
    const fetchedEspacenetResults: any[] = [];

    let inpiMeta = { total: 0, totalPages: 1, perPage: requestedPageSize, currentPage: requestedPage };

    try {
        const local = await searchLocalPatentBase({
            number,
            titular,
            inventor,
            keywords,
            ignoreSecret,
            page: requestedPage,
            pageSize: requestedPageSize
        });
        inpiMeta = {
            total: local.total,
            totalPages: local.totalPages,
            perPage: local.pageSize,
            currentPage: local.page
        };
        fetchedInpiResults.push(...local.results);
        enqueueSearchResultsPersistence(local.results);
    } catch (err: any) {
        fastify.log.warn(`Quick search local base failed: ${err.message}`);
    }

    if (shouldFetchEspacenet && OPS_CONSUMER_KEY && OPS_CONSUMER_SECRET) {
        try {
            const cqlParts: string[] = [];
            if (number) cqlParts.push(`pn=${number.trim()}`);
            if (titular) cqlParts.push(`pa="${titular.trim()}"`);
            if (inventor) cqlParts.push(`in="${inventor.trim()}"`);
            if (keywords) cqlParts.push(`ta all "${keywords.trim().replace(/"/g, '\\"')}"`);

            const cql = cqlParts.join(' AND ');
            const token = await getOpsToken();
            const opsUrl = `https://ops.epo.org/3.2/rest-services/published-data/search/biblio?q=${encodeURIComponent(cql)}`;

            const response = await espacenetQueue.enqueue(() => axios.get(opsUrl, {
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
                timeout: 30000
            }));

            const opsResults = parseOpsResponse(response.data);
            const translatedOps = await translatePatentsToPortuguese(opsResults);
            fetchedEspacenetResults.push(...translatedOps);
            enqueueSearchResultsPersistence(translatedOps);
        } catch (err: any) {
            if (err.response?.status !== 404) {
                fastify.log.warn(`Quick search Espacenet failed: ${err.message}`);
            }
        }
    }

    if (fetchedInpiResults.length > 0 || requestedPage > 1) {
        inpiResults = fetchedInpiResults;
    } else {
        const cachedInpiResults = cachedResults.filter((item: any) => item.source === 'INPI');
        inpiResults = mergePatentLists(cachedInpiResults, fetchedInpiResults);
    }

    if (shouldFetchEspacenet) {
        espacenetResults = mergePatentLists(espacenetResults, fetchedEspacenetResults);
    }

    const inpiCurrentPage = Math.max(1, inpiMeta.currentPage ?? requestedPage);
    const inpiPageSize = inpiMeta.perPage ?? requestedPageSize;
    const inpiCurrentCount = inpiResults.length;
    const inpiTotal = inpiMeta.total ?? inpiResults.length;
    const inpiTotalPages = inpiMeta.totalPages
        ?? Math.max(1, Math.ceil(Math.max(inpiTotal, 1) / inpiPageSize));
    const inpiFrom = inpiTotal > 0 ? ((inpiCurrentPage - 1) * inpiPageSize) + 1 : 0;
    const inpiTo = inpiTotal > 0 ? inpiFrom + Math.max(inpiCurrentCount, 1) - 1 : 0;
    const inpiHasNext = inpiCurrentPage < inpiTotalPages;
    const espacenetTotal = espacenetResults.length;
    const allTotal = inpiTotal + espacenetTotal;

    return {
        inpi: inpiResults,
        espacenet: espacenetResults,
        totals: {
            inpi: inpiTotal,
            espacenet: espacenetTotal,
            all: allTotal
        },
        pagination: {
            inpi: {
                page: inpiCurrentPage,
                pageSize: requestedPageSize,
                total: inpiTotal,
                totalPages: inpiTotalPages,
                from: inpiFrom,
                to: inpiTo,
                hasPrevious: inpiCurrentPage > 1,
                hasNext: inpiHasNext
            }
        },
        results: [...inpiResults, ...espacenetResults],
        total: allTotal
    };
});

// ─── POST /search (unified) ────────────────────────────────────
fastify.post('/search', async (request) => {
    const { cql, inpiQuery, keywords, ipc_codes, ignoreSecret } = request.body as {
        cql: string;
        inpiQuery?: string;
        keywords?: string[];
        ipc_codes: string[];
        ignoreSecret?: boolean;
    };

    fastify.log.info(`=== SEARCH REQUEST ===`);
    fastify.log.info(`CQL query (${cql?.length || 0} chars): ${cql}`);
    fastify.log.info(`INPI query (${inpiQuery?.length || 0} chars): ${inpiQuery}`);
    fastify.log.info(`IPC codes: ${ipc_codes?.join(', ') || 'none'}`);

    const results: { espacenet: any[]; inpi: any[] } = { espacenet: [], inpi: [] };

    const localQuery = inpiQuery ? inpiQuery : (keywords?.length ? keywords.join(' ') : '');

    const [espacenetResult, localBaseResult] = await Promise.allSettled([
        cql ? (async () => {
            try {
                const token = await getOpsToken();
                const url = `https://ops.epo.org/3.2/rest-services/published-data/search/biblio?q=${encodeURIComponent(cql)}`;
                const response = await espacenetQueue.enqueue(() => axios.get(url, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
                    timeout: 30000
                }));
                const opsResults = parseOpsResponse(response.data);
                return translatePatentsToPortuguese(opsResults);
            } catch (err: any) {
                if (err.response?.status === 404) return [];
                throw err;
            }
        })() : Promise.resolve([]),
        localQuery ? searchLocalPatentBase({
            keywords: localQuery,
            ipcCodes: ipc_codes || [],
            ignoreSecret,
            page: 1,
            pageSize: 200
        }).then((res) => res.results) : Promise.resolve([])
    ]);

    if (espacenetResult.status === 'fulfilled') {
        results.espacenet = espacenetResult.value;
        enqueueSearchResultsPersistence(results.espacenet);
    } else {
        fastify.log.error(`Espacenet search FAILED: ${espacenetResult.reason?.message || espacenetResult.reason}`);
    }
    if (localBaseResult.status === 'fulfilled') {
        results.inpi = localBaseResult.value;
        enqueueSearchResultsPersistence(results.inpi);
    } else {
        fastify.log.error(`Local base search FAILED: ${localBaseResult.reason?.message || localBaseResult.reason}`);
    }

    return results;
});

// ─── POST /analyze ─────────────────────────────────────────────
fastify.post('/analyze', async (request, reply) => {
    const { patents, briefing } = request.body as { patents: any[]; briefing: any };
    if (!patents?.length || !briefing) {
        return reply.code(400).send({ error: 'Patents array and briefing are required' });
    }

    try {
        const analyzed: any[] = [];
        // Analyze 5 patents per LLM call to reduce total API calls
        // 100 patents = ~20 calls instead of 100
        const batchSize = 5;

        for (let i = 0; i < patents.length; i += batchSize) {
            const batch = patents.slice(i, i + batchSize);

            const patentsBlock = batch.map((p: any, idx: number) =>
                `[PATENTE ${idx + 1}]
Número: ${p.publicationNumber || p.number || 'N/A'}
Título: ${p.title || 'Sem título'}
Resumo: ${(p.abstract || '').substring(0, 300)}
Titular: ${p.applicant || 'Desconhecido'}
IPC: ${p.classification || 'N/A'}`
            ).join('\n\n');

            const prompt = `Você é um especialista em propriedade intelectual brasileiro. Compare CADA patente abaixo com a invenção do cliente e avalie o risco de colisão.

INVENÇÃO DO CLIENTE:
Problema: ${briefing.problemaTecnico || ''}
Solução: ${briefing.solucaoProposta || ''}
Diferenciais: ${briefing.diferenciais || ''}

${patentsBlock}

Responda um JSON com array "results" contendo EXATAMENTE ${batch.length} objetos, um para cada patente, NA MESMA ORDEM:
{
  "results": [
    {
      "index": 0,
      "riskLevel": "high" ou "medium" ou "low",
      "score": número de 0 a 100,
      "justificativa": "explicação em PT-BR do risco (1-2 frases)"
    }
  ]
}`;

            try {
                const raw = await generateWithGemini(prompt, true);
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                } catch (e) {
                    const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                    parsed = JSON.parse(match ? match[1] : raw);
                }
                const results = parsed.results || parsed.patents || [];

                batch.forEach((patent: any, idx: number) => {
                    const analysis = results[idx] || {};
                    analyzed.push({
                        ...patent,
                        riskLevel: analysis.riskLevel || 'medium',
                        score: analysis.score ?? 50,
                        justificativa: analysis.justificativa || ''
                    });
                });
            } catch (err: any) {
                fastify.log.warn(`Batch analysis failed (patents ${i + 1}-${i + batch.length}): ${err.message}`);
                // Fallback: mark batch as unanalyzed
                batch.forEach((patent: any) => {
                    analyzed.push({
                        ...patent,
                        riskLevel: 'medium',
                        score: 50,
                        justificativa: 'Análise automática indisponível — avalie manualmente.'
                    });
                });
            }

            // Rate limit delay: wait 1.5s between batches to avoid Groq throttling
            if (i + batchSize < patents.length) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }

        // Sort by score descending
        analyzed.sort((a, b) => (b.score || 0) - (a.score || 0));
        return { patents: analyzed };
    } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Analysis failed', details: error.message });
    }
});

// ─── Start ─────────────────────────────────────────────────────
fastify.post('/debug/clear-cache', async (request, reply) => {
    const { secret } = request.body as { secret: string };
    if (secret !== 'leo123') return reply.code(403).send({ error: 'Unauthorized' });
    
    await prisma.searchResultCache.deleteMany({});
    return { message: 'Cache de busca limpo com sucesso' };
});

fastify.get('/debug/test-inpi', async () => {
    try {
        const { stdout, stderr } = await execInpiCurlWithRetry(
            `curl -v --http1.1 -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' 'https://busca.inpi.gov.br/pePI/' -o /dev/null`,
            1,
            10000,
            1024
        );
        return { success: true, stdout, stderr };
    } catch (err: any) {
        return { success: false, message: err.message, stderr: err.stderr };
    }
});

const start = async () => {
    try {
        const startupLog = `/tmp/server_startup.log`;
        fs.writeFileSync(startupLog, `Server starting at ${new Date().toISOString()} with PID ${process.pid}\n`);
        await ensureMonitoringTables();

        // ─── STARTUP ──────────────────────────────────────────────────
        await fastify.listen({ port: parseInt(process.env.PORT || '3001'), host: '0.0.0.0' });
        startBackgroundWorkers();
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};


// ─── UPDATED DETAIL ENDPOINT ──────────────────────────────────
fastify.get('/search/inpi/detail/:codPedido', async (request, reply) => {
    const { codPedido } = request.params as { codPedido: string };

    const dbData = await prisma.inpiPatent.findUnique({
        where: { cod_pedido: codPedido },
        include: {
            publications: true,
            petitions: true,
            annuities: true,
            document_jobs: {
                orderBy: { updated_at: 'desc' },
                take: 15
            },
            scraping_jobs: {
                orderBy: { created_at: 'desc' },
                take: 1
            }
        }
    });

    if (!dbData) {
        return reply.code(404).send({
            error: 'Patent not found in local base',
            inpiUrl: buildInpiDetailUrl(codPedido)
        });
    }
    const publicationNumber = dbData.numero_publicacao || dbData.cod_pedido;
    const inpiLookupKeys = Array.from(new Set([
        codPedido,
        dbData.cod_pedido,
        dbData.numero_publicacao,
        String(codPedido || '').replace(/[^\w.-]/g, ''),
        String(codPedido || '').replace(/[^\dA-Za-z]/g, '').toUpperCase(),
        String(dbData.numero_publicacao || '').replace(/[^\dA-Za-z]/g, '').toUpperCase()
    ].filter((item) => typeof item === 'string' && item.trim().length > 0)));
    const latestInpiJob = await prismaAny.inpiProcessingJob.findFirst({
        where: {
            status: 'completed',
            patent_number: { in: inpiLookupKeys }
        },
        orderBy: { finished_at: 'desc' },
        select: {
            result_data: true
        }
    }).catch(() => null);
    const completedDocJob = (dbData.document_jobs || []).find((item: any) => item?.status === 'completed' && item?.storage_key);
    const hasStoredDocument = Boolean(completedDocJob?.storage_key);
    const latestDocJob = dbData.document_jobs?.[0] || null;
    const latestPublicationWithBiblio = (dbData.publications || []).find((item: any) =>
        Boolean(item?.ops_title || item?.ops_applicant || item?.ops_inventor || item?.ops_ipc || item?.ops_publication_date)
    );
    const resolvedTitle = dbData.title || latestPublicationWithBiblio?.ops_title || '';
    const resolvedApplicant = dbData.applicant || latestPublicationWithBiblio?.ops_applicant || '';
    const resolvedInventors = dbData.inventors || latestPublicationWithBiblio?.ops_inventor || '';
    const resolvedFilingDate = dbData.filing_date || latestPublicationWithBiblio?.ops_publication_date || '';
    const resolvedIpc = dbData.ipc_codes || latestPublicationWithBiblio?.ops_ipc || '';
    const inpiResultData = latestInpiJob?.result_data && typeof latestInpiJob.result_data === 'object'
        ? latestInpiJob.result_data as Record<string, any>
        : null;
    const resolvedDetailedAbstract = normalizeStringField(
        dbData.abstract
        || inpiResultData?.resumoDetalhado
        || inpiResultData?.resumo
        || ''
    );
    const resolvedProcurador = normalizeStringField(inpiResultData?.procurador || '');
    const publications = (dbData.publications || [])
        .map((item: any) => ({
            ...item,
            eligible_for_doc_download: typeof item?.eligible_for_doc_download === 'boolean'
                ? item.eligible_for_doc_download
                : isEligibleForDocDownloadByCode(item?.despacho_code)
        }))
        .sort((a: any, b: any) => {
            const dateA = new Date(a?.date || 0).getTime();
            const dateB = new Date(b?.date || 0).getTime();
            if (!Number.isNaN(dateA) && !Number.isNaN(dateB) && dateA !== dateB) {
                return dateB - dateA;
            }
            return (a?.rpi || '').localeCompare(b?.rpi || '', 'pt-BR', { numeric: true });
        });
    return {
        ...dbData,
        title: resolvedTitle,
        applicant: resolvedApplicant,
        inventors: resolvedInventors,
        abstract: resolvedDetailedAbstract,
        resumo_detalhado: resolvedDetailedAbstract,
        procurador: resolvedProcurador,
        filing_date: resolvedFilingDate,
        ipc_codes: resolvedIpc,
        publications,
        scraping_status: dbData.scraping_jobs[0]?.status || 'available_for_queue',
        document_status: latestDocJob?.status || (hasStoredDocument ? 'completed' : 'not_queued'),
        document_error: latestDocJob?.error || null,
        doc_jobs: (dbData.document_jobs || []).map((job: any) => ({
            id: job.id,
            publication_number: job.publication_number,
            status: job.status,
            attempts: job.attempts,
            error: job.error,
            updated_at: job.updated_at
        })),
        inpiUrl: buildInpiDetailUrl(codPedido, publicationNumber),
        googlePatentsUrl: buildGooglePatentsUrl(publicationNumber),
        espacenetUrl: buildEspacenetUiUrl(publicationNumber),
        figures: hasStoredDocument ? [buildStorageAssetPath(publicationNumber, 'first'), buildStorageAssetPath(publicationNumber, 'drawings')] : [],
        storage: hasStoredDocument
            ? {
                hasStoredDocument: true,
                ...buildStorageAssets(publicationNumber)
            }
            : {
                hasStoredDocument: false
            }
    };
});

fastify.get('/patent/storage/:publicationNumber/:asset', async (request: any, reply) => {
    const { publicationNumber, asset } = request.params as { publicationNumber: string; asset: string };
    const decodedPublication = decodeURIComponent(publicationNumber || '');
    const normalizedAsset = asset === 'full' || asset === 'drawings' || asset === 'first'
        ? asset
        : null;
    if (!decodedPublication || !normalizedAsset) {
        return reply.code(400).send({ error: 'Parâmetros inválidos' });
    }
    if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
        return reply.code(500).send({ error: 'Storage não configurado' });
    }
    const key = buildStorageAssetKey(decodedPublication, normalizedAsset);
    const s3 = getS3Client();
    try {
        await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        const object = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        const body = object.Body as any;
        if (!body) {
            return reply.code(404).send({ error: 'Arquivo não encontrado no storage' });
        }
        reply.header('Content-Type', 'application/pdf');
        reply.header('Cache-Control', 'public, max-age=3600');
        return reply.send(body);
    } catch (error: any) {
        return reply.code(404).send({ error: 'Arquivo não encontrado no storage', details: error?.message || '' });
    }
});

// ─── Patent Base Endpoints ──────────────────────────────
fastify.get('/patents/processed', async (request: any, reply) => {
    try {
        const { page = 1, pageSize = 20, q } = request.query as any;
        const skip = (parseInt(page, 10) - 1) * parseInt(pageSize, 10);
        const take = parseInt(pageSize, 10);
        const queryText = String(q || '').trim();
        const whereClause: any = queryText
            ? {
                OR: [
                    { cod_pedido: { contains: queryText } },
                    { numero_publicacao: { contains: queryText } },
                    { title: { contains: queryText } },
                    { applicant: { contains: queryText } },
                    { inventors: { contains: queryText } }
                ]
            }
            : undefined;

        const [patents, total] = await Promise.all([
            prisma.inpiPatent.findMany({
                skip,
                take,
                orderBy: { updated_at: 'desc' },
                where: whereClause,
                include: {
                    publications: {
                        orderBy: { created_at: 'desc' },
                        take: 1
                    },
                    document_jobs: {
                        orderBy: { updated_at: 'desc' },
                        take: 1
                    },
                    _count: {
                        select: {
                            publications: true,
                            petitions: true,
                            annuities: true
                        }
                    }
                }
            }),
            prisma.inpiPatent.count({ where: whereClause })
        ]);

        return {
            patents: patents.map((patent: any) => {
                const latestPublication = patent.publications?.[0];
                const latestDocJob = patent.document_jobs?.[0];
                return {
                    ...patent,
                    title: patent.title || latestPublication?.ops_title || '',
                    applicant: patent.applicant || latestPublication?.ops_applicant || '',
                    inventors: patent.inventors || latestPublication?.ops_inventor || '',
                    filing_date: patent.filing_date || latestPublication?.ops_publication_date || '',
                    ipc_codes: patent.ipc_codes || latestPublication?.ops_ipc || '',
                    document_status: latestDocJob?.status || 'not_queued',
                    document_error: latestDocJob?.error || null,
                    has_stored_document: Boolean(latestDocJob?.status === 'completed' && latestDocJob?.storage_key)
                };
            }),
            total,
            page: parseInt(page, 10),
            pageSize: take,
            totalPages: Math.ceil(total / take)
        };
    } catch (error: any) {
        if (isMissingTableError(error)) {
            const page = parseInt(String(request.query?.page || 1), 10) || 1;
            const pageSize = parseInt(String(request.query?.pageSize || 20), 10) || 20;
            request.log.warn({ error }, 'Fallback /patents/processed por tabela ausente');
            return {
                patents: [],
                total: 0,
                page,
                pageSize,
                totalPages: 0
            };
        }
        request.log.error({ error }, 'Erro em /patents/processed');
        return reply.code(500).send({ error: 'Falha ao buscar patentes processadas' });
    }
});

fastify.get('/background-workers/queues', async (request: any, reply) => {
    try {
        const limit = Math.min(200, Math.max(20, parseInt((request.query?.limit || '100') as string, 10)));
        const [rpiProcessing, rpiSuccess, rpiErrors, docsProcessing, docsSuccess, docsErrors, opsProcessing, opsSuccess, opsErrors, inpiProcessing, inpiSuccess, inpiErrors, rpiProcessingCount, rpiSuccessCount, rpiErrorsCount, docsProcessingCount, docsSuccessCount, docsErrorsCount, opsProcessingCount, opsSuccessCount, opsErrorsCount, inpiProcessingCount, inpiSuccessCount, inpiErrorsCount] = await Promise.all([
        prisma.rpiImportJob.findMany({
            where: { status: { in: ['pending', 'running'] } },
            orderBy: [{ rpi_number: 'asc' }, { created_at: 'asc' }],
            take: limit
        }),
        prisma.rpiImportJob.findMany({
            where: { status: 'completed' },
            orderBy: { finished_at: 'desc' },
            take: limit
        }),
        prisma.rpiImportJob.findMany({
            where: { status: { in: ['failed', 'failed_permanent'] } },
            orderBy: { finished_at: 'desc' },
            take: limit
        }),
        prisma.documentDownloadJob.findMany({
            where: { status: { in: ['pending', 'running'] } },
            orderBy: { created_at: 'asc' },
            include: {
                patent: { select: { numero_publicacao: true, title: true, status: true } }
            },
            take: limit
        }),
        prisma.documentDownloadJob.findMany({
            where: { status: 'completed' },
            orderBy: { finished_at: 'desc' },
            include: {
                patent: { select: { numero_publicacao: true, title: true, status: true } }
            },
            take: limit
        }),
        prisma.documentDownloadJob.findMany({
            where: { status: { in: ['failed', 'failed_permanent', 'not_found', 'skipped_sigilo'] } },
            orderBy: { finished_at: 'desc' },
            include: {
                patent: { select: { numero_publicacao: true, title: true, status: true } }
            },
            take: limit
        }),
        prismaAny.opsBibliographicJob.findMany({
            where: { status: { in: ['pending', 'running'] } },
            orderBy: { created_at: 'asc' },
            take: limit
        }),
        prismaAny.opsBibliographicJob.findMany({
            where: { status: 'completed' },
            orderBy: { finished_at: 'desc' },
            take: limit
        }),
        prismaAny.opsBibliographicJob.findMany({
            where: { status: { in: ['failed', 'failed_permanent', 'not_found'] } },
            orderBy: { finished_at: 'desc' },
            take: limit
        }),
            prismaAny.inpiProcessingJob.findMany({
                where: { status: { in: ['pending', 'running'] } },
                orderBy: [{ priority: 'desc' }, { created_at: 'asc' }],
                take: limit
            }),
            prismaAny.inpiProcessingJob.findMany({
                where: { status: 'completed' },
                orderBy: { finished_at: 'desc' },
                take: limit
            }),
            prismaAny.inpiProcessingJob.findMany({
                where: { status: { in: ['failed', 'failed_permanent'] } },
                orderBy: { finished_at: 'desc' },
                take: limit
            }),
        prisma.rpiImportJob.count({
            where: { status: { in: ['pending', 'running'] } }
        }),
        prisma.rpiImportJob.count({
            where: { status: 'completed' }
        }),
        prisma.rpiImportJob.count({
            where: { status: { in: ['failed', 'failed_permanent'] } }
        }),
        prisma.documentDownloadJob.count({
            where: { status: { in: ['pending', 'running'] } }
        }),
        prisma.documentDownloadJob.count({
            where: { status: 'completed' }
        }),
        prisma.documentDownloadJob.count({
            where: { status: { in: ['failed', 'failed_permanent', 'not_found', 'skipped_sigilo'] } }
        }),
        prismaAny.opsBibliographicJob.count({
            where: { status: { in: ['pending', 'running'] } }
        }),
        prismaAny.opsBibliographicJob.count({
            where: { status: 'completed' }
        }),
        prismaAny.opsBibliographicJob.count({
            where: { status: { in: ['failed', 'failed_permanent', 'not_found'] } }
            }),
            prismaAny.inpiProcessingJob.count({
                where: { status: { in: ['pending', 'running'] } }
            }),
            prismaAny.inpiProcessingJob.count({
                where: { status: 'completed' }
            }),
            prismaAny.inpiProcessingJob.count({
                where: { status: { in: ['failed', 'failed_permanent'] } }
        })
    ]);

    const extractSource = (value?: string | null): string | null => {
        const text = (value || '').toLowerCase();
        const match = text.match(/source=([a-z0-9_:-]+)/i);
        if (match?.[1]) return match[1];
        if (text.includes('bigquery')) return 'google_bigquery';
        if (text.includes('google')) return 'google_patents';
        if (text.includes('espacenet')) return 'ops_api';
        if (text.includes('inpi')) return 'inpi';
        if (text.includes('bucket') || text.includes('storage')) return 'bucket';
        return null;
    };

    const mapRpi = (rows: any[]) => rows.map((row) => ({ ...row, source: 'rpi_xml' }));
    const mapDocs = (rows: any[]) => rows.map((row) => ({
        ...row,
        source: row.storage_key ? 'bucket' : (extractSource(row.error) || (row.status === 'not_found' ? 'ops_api' : null))
    }));
    const mapOps = (rows: any[]) => rows.map((row) => ({
        ...row,
        source: extractSource(row.error) || (row.docdb_id ? 'ops_api' : null)
    }));
    const mapInpi = (rows: any[]) => rows.map((row) => ({ ...row, source: 'inpi' }));

        return {
            rpi: {
                processing: mapRpi(rpiProcessing),
                success: mapRpi(rpiSuccess),
                errors: mapRpi(rpiErrors),
                counts: {
                    processing: rpiProcessingCount,
                    success: rpiSuccessCount,
                    errors: rpiErrorsCount
                }
            },
            docs: {
                processing: mapDocs(docsProcessing),
                success: mapDocs(docsSuccess),
                errors: mapDocs(docsErrors),
                counts: {
                    processing: docsProcessingCount,
                    success: docsSuccessCount,
                    errors: docsErrorsCount
                }
            },
            ops: {
                processing: mapOps(opsProcessing),
                success: mapOps(opsSuccess),
                errors: mapOps(opsErrors),
                counts: {
                    processing: opsProcessingCount,
                    success: opsSuccessCount,
                    errors: opsErrorsCount
                }
            },
            inpi: {
                processing: mapInpi(inpiProcessing),
                success: mapInpi(inpiSuccess),
                errors: mapInpi(inpiErrors),
                counts: {
                    processing: inpiProcessingCount,
                    success: inpiSuccessCount,
                    errors: inpiErrorsCount
                }
            }
        };
    } catch (error: any) {
        if (isMissingTableError(error)) {
            request.log.warn({ error }, 'Fallback /background-workers/queues por tabela ausente');
            return emptyBackgroundQueuesPayload();
        }
        request.log.error({ error }, 'Erro em /background-workers/queues');
        return reply.code(500).send({ error: 'Falha ao carregar filas de background workers' });
    }
});

fastify.post('/background-workers/rpi/bootstrap', async (_request, reply) => {
    try {
        const result = await enqueueLastFiveYearsRpi();
        return result;
    } catch (error: any) {
        return reply.code(500).send({ error: error.message || 'Falha ao enfileirar RPIs' });
    }
});

fastify.post('/background-workers/rpi/enqueue-range', async (request: any, reply) => {
    const { from, to } = request.body as { from?: number; to?: number };
    const start = Number.isFinite(from) ? Math.max(1, Math.floor(Number(from))) : 0;
    const end = Number.isFinite(to) ? Math.max(1, Math.floor(Number(to))) : 0;
    if (!start || !end || end < start) {
        return reply.code(400).send({ error: 'Intervalo inválido (from/to)' });
    }
    const rows = [];
    for (let rpi = start; rpi <= end; rpi++) {
        rows.push({
            rpi_number: rpi,
            status: 'pending',
            source_url: `https://revistas.inpi.gov.br/txt/P${rpi}.zip`
        });
    }
    const created = await prisma.rpiImportJob.createMany({
        data: rows,
        skipDuplicates: true
    });
    return { from: start, to: end, requested: rows.length, created: created.count };
});

fastify.post('/background-workers/requeue-by-filter', async (request: any) => {
    const {
        rpiFrom,
        rpiTo,
        dispatchCodes,
        target = 'all',
        maxRows = 2000
    } = request.body as {
        rpiFrom?: number;
        rpiTo?: number;
        dispatchCodes?: string;
        target?: 'docs' | 'ops' | 'all';
        maxRows?: number;
    };
    const safeMaxRows = Math.min(10000, Math.max(1, Math.floor(Number(maxRows) || 2000)));
    const where: any = {};
    if (Number.isFinite(rpiFrom) || Number.isFinite(rpiTo)) {
        where.rpi = {};
        if (Number.isFinite(rpiFrom)) where.rpi.gte = String(Math.max(1, Math.floor(Number(rpiFrom))));
        if (Number.isFinite(rpiTo)) where.rpi.lte = String(Math.max(1, Math.floor(Number(rpiTo))));
    }
    const codeFilter = (dispatchCodes || '')
        .split(',')
        .map((item) => normalizeDispatchCode(item))
        .filter(Boolean);
    const rows: any[] = await prismaAny.inpiPublication.findMany({
        where,
        orderBy: [{ created_at: 'desc' }],
        take: safeMaxRows,
        select: {
            id: true,
            patent_id: true,
            patent_number: true,
            rpi: true,
            despacho_code: true,
            eligible_for_doc_download: true
        }
    });
    const filteredRows = codeFilter.length > 0
        ? rows.filter((row) => codeFilter.includes(normalizeDispatchCode(row.despacho_code || '')))
        : rows;
    let docsQueued = 0;
    let opsQueued = 0;
    for (const row of filteredRows) {
        const normalizedCode = normalizeDispatchCode(row.despacho_code || '');
        const docEligible = row.eligible_for_doc_download || normalizedCode === '3.1' || normalizedCode === '16.1';
        if ((target === 'all' || target === 'docs') && docEligible && row.patent_id) {
            await prisma.documentDownloadJob.upsert({
                where: { patent_id: row.patent_id },
                update: {
                    status: 'pending',
                    error: null,
                    finished_at: null,
                    publication_number: row.patent_number || undefined
                },
                create: {
                    patent_id: row.patent_id,
                    status: 'pending',
                    publication_number: row.patent_number || undefined
                }
            });
            docsQueued++;
        }
        if ((target === 'all' || target === 'ops') && (!docEligible) && row.patent_number) {
            await prismaAny.opsBibliographicJob.upsert({
                where: { patent_number: row.patent_number },
                update: {
                    status: 'pending',
                    error: null,
                    finished_at: null,
                    rpi_number: Number.parseInt(row.rpi, 10) || undefined
                },
                create: {
                    patent_number: row.patent_number,
                    status: 'pending',
                    rpi_number: Number.parseInt(row.rpi, 10) || undefined
                }
            });
            opsQueued++;
        }
    }
    return {
        selectedRows: filteredRows.length,
        docsQueued,
        opsQueued,
        target
    };
});

fastify.post('/background-workers/clear-active-errors', async () => {
    const [rpiDeleted, docsDeleted, opsDeleted] = await Promise.all([
        prisma.rpiImportJob.deleteMany({
            where: {
                status: { in: ['pending', 'running', 'failed', 'failed_permanent'] }
            }
        }),
        prisma.documentDownloadJob.deleteMany({
            where: {
                status: { in: ['pending', 'running', 'failed', 'failed_permanent', 'not_found', 'skipped_sigilo'] }
            }
        }),
        prismaAny.opsBibliographicJob.deleteMany({
            where: {
                status: { in: ['pending', 'running', 'failed', 'failed_permanent', 'not_found'] }
            }
        })
    ]);
    return {
        rpiDeleted: rpiDeleted.count,
        docsDeleted: docsDeleted.count,
        opsDeleted: opsDeleted.count
    };
});

fastify.post('/background-workers/reprocess-all', async () => {
    const [rpiDeleted, docsDeleted, opsDeleted] = await Promise.all([
        prisma.rpiImportJob.deleteMany({}),
        prisma.documentDownloadJob.deleteMany({
            where: {
                status: { in: ['pending', 'running', 'failed', 'failed_permanent', 'not_found', 'skipped_sigilo'] }
            }
        }),
        prismaAny.opsBibliographicJob.deleteMany({
            where: {
                status: { in: ['pending', 'running', 'failed', 'failed_permanent', 'not_found'] }
            }
        })
    ]);
    const boot = await enqueueLastFiveYearsRpi();
    return {
        queuesCleared: {
            rpiDeleted: rpiDeleted.count,
            docsDeleted: docsDeleted.count,
            opsDeleted: opsDeleted.count
        },
        enqueued: boot
    };
});

fastify.get('/background-workers/state', async () => {
    return getBackgroundWorkerState();
});

fastify.get('/background-workers/bigquery/test', async (request: any, reply) => {
    const publication = String(request.query?.publication || '').trim();
    if (!publication) {
        return reply.code(400).send({ error: 'publication é obrigatório' });
    }
    const result = await debugBigQueryLookup(publication);
    return result;
});

fastify.get('/background-workers/inpi/test', async (request: any, reply) => {
    const patent = String(request.query?.patent || '').trim();
    if (!patent) {
        return reply.code(400).send({ error: 'patent é obrigatório' });
    }
    const result = await debugInpiLookup(patent);
    return result;
});

fastify.post('/background-workers/inpi/enqueue', async (request: any, reply) => {
    try {
        const patentNumbers = Array.isArray(request.body?.patentNumbers)
            ? request.body.patentNumbers.filter((item: any) => typeof item === 'string' && item.trim().length > 0)
            : undefined;
        const priorityRaw = Number(request.body?.priority);
        const priority = Number.isFinite(priorityRaw) ? Math.max(1, Math.min(10, Math.floor(priorityRaw))) : 10;
        const result = await enqueueInpiReprocessing(patentNumbers, priority);
        return result;
    } catch (error: any) {
        return reply.code(500).send({ error: error?.message || 'Falha ao enfileirar processamento INPI' });
    }
});

fastify.post('/background-workers/control', async (request: any, reply) => {
    const { queue, action } = request.body as { queue?: 'rpi' | 'docs' | 'ops' | 'inpi' | 'all'; action?: 'pause' | 'resume' };
    if (!queue || !action) {
        return reply.code(400).send({ error: 'queue e action são obrigatórios' });
    }
    const paused = action === 'pause';
    return setBackgroundWorkerPause(queue, paused);
});

fastify.post('/background-workers/inpi/retry/:id', async (request: any, reply) => {
    const { id } = request.params as { id: string };
    try {
        const job = await retryInpiJob(id);
        return { id: job.id, status: job.status };
    } catch (error) {
        return reply.code(404).send({ error: 'Job INPI não encontrado' });
    }
});

fastify.post('/background-workers/rpi/retry/:id', async (request: any, reply) => {
    const { id } = request.params as { id: string };
    try {
        const job = await retryRpiJob(id);
        return { id: job.id, status: job.status };
    } catch (error) {
        return reply.code(404).send({ error: 'Job RPI não encontrado' });
    }
});

fastify.post('/background-workers/docs/retry/:id', async (request: any, reply) => {
    const { id } = request.params as { id: string };
    try {
        const job = await retryDocumentJob(id);
        return { id: job.id, status: job.status };
    } catch (error) {
        return reply.code(404).send({ error: 'Job de documento não encontrado' });
    }
});

fastify.post('/background-workers/ops/retry/:id', async (request: any, reply) => {
    const { id } = request.params as { id: string };
    try {
        const preferBigQuery = request.body?.preferBigQuery === undefined ? true : Boolean(request.body?.preferBigQuery);
        const job = await retryOpsBibliographicJob(id, preferBigQuery);
        return { id: job.id, status: job.status };
    } catch (error) {
        return reply.code(404).send({ error: 'Job bibliográfico OPS não encontrado' });
    }
});

fastify.post('/background-workers/rpi/retry-errors', async (request: any, reply) => {
    try {
        const ids = Array.isArray(request.body?.ids) ? request.body.ids.filter((item: any) => typeof item === 'string') : undefined;
        const result = await retryAllRpiErrorJobs(ids);
        return result;
    } catch (error) {
        return reply.code(500).send({ error: 'Falha ao reprocessar erros da fila RPI' });
    }
});

fastify.post('/background-workers/docs/retry-errors', async (request: any, reply) => {
    try {
        const ids = Array.isArray(request.body?.ids) ? request.body.ids.filter((item: any) => typeof item === 'string') : undefined;
        const result = await retryAllDocumentErrorJobs(ids);
        return result;
    } catch (error) {
        return reply.code(500).send({ error: 'Falha ao reprocessar erros da fila de documentos' });
    }
});

fastify.post('/background-workers/ops/retry-errors', async (request: any, reply) => {
    try {
        const ids = Array.isArray(request.body?.ids) ? request.body.ids.filter((item: any) => typeof item === 'string') : undefined;
        const preferBigQuery = Boolean(request.body?.preferBigQuery);
        const result = await retryAllOpsErrorJobs(ids, preferBigQuery);
        return result;
    } catch (error) {
        return reply.code(500).send({ error: 'Falha ao reprocessar erros da fila OPS' });
    }
});

fastify.get('/monitoring/dashboard-summary', async () => {
    await ensureMonitoringTables();
    const criticalCodes = ['6.1', '7.1'];
    const normalizeKey = (value?: string | null) => String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    const parseBrDate = (value?: string | null): Date | null => {
        const text = String(value || '').trim();
        if (!text) return null;
        const brMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (brMatch) {
            const dt = new Date(Date.UTC(Number(brMatch[3]), Number(brMatch[2]) - 1, Number(brMatch[1])));
            return Number.isNaN(dt.getTime()) ? null : dt;
        }
        const iso = new Date(text);
        return Number.isNaN(iso.getTime()) ? null : iso;
    };
    const addDays = (date: Date, days: number) => new Date(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const now = new Date();
    const sevenDaysAgo = addDays(now, -7);
    const monitoredRows = await prisma.$queryRawUnsafe<any[]>(
        `select patent_number from monitored_inpi_patents where active = true`
    ).catch(() => []);
    const monitoredPatentSet = new Set<string>(
        (monitoredRows || []).map((row: any) => normalizeKey(row?.patent_number)).filter(Boolean)
    );
    const monitoredList = Array.from(monitoredPatentSet);
    const monitoredPatents = monitoredList.length;

    const [exigenciesBaseRaw, communicationsBaseRaw] = await Promise.all([
        prismaAny.inpiPublication.findMany({
            where: { despacho_code: { in: criticalCodes } },
            orderBy: { created_at: 'desc' },
            take: 400
        }).catch(() => []),
        prismaAny.inpiPublication.findMany({
            where: { despacho_code: { not: null } },
            orderBy: { created_at: 'desc' },
            take: 1000
        }).catch(() => [])
    ]);

    const shouldFilterByMonitored = true;
    const exigenciesRaw = (exigenciesBaseRaw as any[]).filter((row) => monitoredPatentSet.has(normalizeKey(row?.patent_number)));
    const communicationsRaw = (communicationsBaseRaw as any[]).filter((row) => monitoredPatentSet.has(normalizeKey(row?.patent_number)));

    const exigencies = exigenciesRaw
        .map((row: any) => {
            const eventDate = parseBrDate(row?.date) || row?.created_at || null;
            const deadline = eventDate ? addDays(new Date(eventDate), 60) : null;
            return {
                id: row?.id,
                patentNumber: row?.patent_number || '-',
                rpi: row?.rpi || '-',
                code: row?.despacho_code || '-',
                description: row?.despacho_desc || '',
                date: eventDate ? new Date(eventDate).toISOString() : null,
                deadline: deadline ? deadline.toISOString() : null,
                daysLeft: deadline ? Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : null
            };
        })
        .sort((a: any, b: any) => (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999))
        .slice(0, 20);

    const communications = communicationsRaw.map((row: any) => ({
        id: row?.id,
        patentNumber: row?.patent_number || '-',
        rpi: row?.rpi || '-',
        code: row?.despacho_code || '-',
        description: row?.despacho_desc || '',
        complement: row?.complement || '',
        date: row?.date || null,
        source: row?.ops_error?.includes('source=') ? String(row.ops_error).split('source=')[1]?.split(' ')[0] : null
    }));

    const grantsLast30d = communications.filter((row: any) => /concess/i.test(row.description || '')).length;
    const communicationsLast7d = communicationsRaw.filter((row: any) => {
        const dt = parseBrDate(row?.date) || row?.created_at;
        return dt ? new Date(dt).getTime() >= sevenDaysAgo.getTime() : false;
    }).length;
    const unreadAlertsRows = monitoredList.length > 0
        ? await prisma.$queryRawUnsafe<any[]>(
            `select count(*)::int as total
             from monitoring_alerts a
             where a.is_read=false
               and a.patent_number = any($1::text[])`,
            monitoredList
        ).catch(() => [{ total: 0 }])
        : await prisma.$queryRawUnsafe<any[]>(
            `select count(*)::int as total from monitoring_alerts where is_read=false`
        ).catch(() => [{ total: 0 }]);
    const unreadAlerts = Number(unreadAlertsRows?.[0]?.total || 0);

    const deadlines = exigencies
        .filter((item: any) => item.deadline)
        .map((item: any) => ({ patentNumber: item.patentNumber, code: item.code, deadline: item.deadline, daysLeft: item.daysLeft }))
        .slice(0, 20);

    return {
        kpis: {
            monitoredPatents,
            unreadAlerts,
            exigencyAlerts: exigencies.length,
            grantsLast30d,
            communicationsLast7d
        },
        exigencies,
        communications: communications.slice(0, 40),
        deadlines
    };
});

fastify.get('/monitoring/patents', async (request: any) => {
    await ensureMonitoringTables();
    const {
        page = 1,
        pageSize = 20,
        active,
        source,
        attorney,
        q
    } = request.query as {
        page?: string | number;
        pageSize?: string | number;
        active?: string;
        source?: string;
        attorney?: string;
        q?: string;
    };
    const currentPage = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(String(pageSize || '20'), 10) || 20));
    const offset = (currentPage - 1) * size;
    const conditions: string[] = [];
    const values: any[] = [];
    const push = (value: any) => {
        values.push(value);
        return `$${values.length}`;
    };

    if (active === 'true' || active === 'false') {
        conditions.push(`m.active = ${push(active === 'true')}`);
    }
    if (source && source !== 'all') {
        conditions.push(`m.source = ${push(source)}`);
    }
    if (attorney) {
        conditions.push(`coalesce(m.matched_attorney, '') ilike ${push(`%${attorney}%`)}`);
    }
    if (q) {
        const token = `%${q}%`;
        const p = push(token);
        const p2 = push(token);
        const p3 = push(token);
        conditions.push(`(m.patent_number ilike ${p} or coalesce(m.patent_id, '') ilike ${p2} or coalesce(p.title, '') ilike ${p3})`);
    }
    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';

    const totalRows = await prisma.$queryRawUnsafe<any[]>(
        `select count(*)::int as total
         from monitored_inpi_patents m
         left join inpi_patents p on p.cod_pedido = m.patent_id
         ${whereClause}`,
        ...values
    ).catch(() => [{ total: 0 }]);
    const total = Number(totalRows?.[0]?.total || 0);

    const pageRows = await prisma.$queryRawUnsafe<any[]>(
        `select
            m.id,
            m.patent_number,
            m.patent_id,
            m.source,
            m.matched_attorney,
            m.active,
            m.blocked_by_user,
            m.created_at,
            m.updated_at,
            m.last_seen_at,
            p.title,
            p.applicant,
            p.inventors,
            p.ipc_codes,
            p.status,
            p.last_event
         from monitored_inpi_patents m
         left join inpi_patents p on p.cod_pedido = m.patent_id
         ${whereClause}
         order by m.updated_at desc
         limit ${push(size)} offset ${push(offset)}`,
        ...values
    ).catch(() => []);

    return {
        rows: pageRows,
        total,
        page: currentPage,
        pageSize: size,
        totalPages: Math.max(1, Math.ceil(total / size))
    };
});

fastify.get('/monitoring/alerts', async (request: any) => {
    await ensureMonitoringTables();
    const { page = 1, pageSize = 30, unreadOnly } = request.query as any;
    const currentPage = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(String(pageSize || '30'), 10) || 30));
    const offset = (currentPage - 1) * size;
    const onlyUnread = String(unreadOnly || '').toLowerCase() === 'true';
    const totalRows = await prisma.$queryRawUnsafe<any[]>(
        `select count(*)::int as total
         from monitoring_alerts
         where ($1::boolean is false) or is_read=false`,
        onlyUnread
    ).catch(() => [{ total: 0 }]);
    const total = Number(totalRows?.[0]?.total || 0);
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select id, monitored_patent_id, patent_number, rpi_number, rpi_date, despacho_code, title, complement, severity, deadline, is_read, created_at, updated_at
         from monitoring_alerts
         where ($1::boolean is false) or is_read=false
         order by rpi_date desc, created_at desc
         limit $2 offset $3`,
        onlyUnread,
        size,
        offset
    ).catch(() => []);
    return { rows, total, page: currentPage, pageSize: size, totalPages: Math.max(1, Math.ceil(total / size)) };
});

fastify.post('/monitoring/alerts/:id/read', async (request: any, reply) => {
    await ensureMonitoringTables();
    const { id } = request.params as { id: string };
    const updated = await prisma.$queryRawUnsafe<any[]>(
        `update monitoring_alerts set is_read=true, updated_at=now() where id=$1 returning id, is_read`,
        id
    ).catch(() => []);
    if (!updated?.[0]) return reply.code(404).send({ error: 'Alerta não encontrado' });
    return updated[0];
});

fastify.get('/monitoring/config', async () => {
    await ensureMonitoringTables();
    const attorneys = await prisma.$queryRawUnsafe<any[]>(
        `select id, name, active, created_at, updated_at from monitoring_attorneys order by name asc`
    ).catch(() => []);
    const patents = await prisma.$queryRawUnsafe<any[]>(
        `select id, patent_number, patent_id, source, matched_attorney, active, blocked_by_user, created_at, updated_at from monitored_inpi_patents order by updated_at desc limit 500`
    ).catch(() => []);
    return {
        monitoredAttorneyNames: attorneys,
        monitoredPatents: patents
    };
});

fastify.post('/monitoring/attorneys', async (request: any, reply) => {
    await ensureMonitoringTables();
    const name = String(request.body?.name || '').trim();
    if (!name) return reply.code(400).send({ error: 'name é obrigatório' });
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
        `insert into monitoring_attorneys (id, name, active, created_at, updated_at) values ($1,$2,true,now(),now())
         on conflict (name) do update set active=true, updated_at=now()`,
        id,
        name
    );
    return { id, name, active: true };
});

fastify.post('/monitoring/attorneys/:id/toggle', async (request: any, reply) => {
    await ensureMonitoringTables();
    const { id } = request.params as { id: string };
    const active = Boolean(request.body?.active);
    const updated = await prisma.$queryRawUnsafe<any[]>(
        `update monitoring_attorneys set active=$2, updated_at=now() where id=$1 returning id, name, active`,
        id,
        active
    );
    if (!updated?.[0]) return reply.code(404).send({ error: 'Procurador não encontrado' });
    return updated[0];
});

fastify.post('/monitoring/patents/add', async (request: any, reply) => {
    await ensureMonitoringTables();
    const patentNumber = String(request.body?.patentNumber || '').trim();
    const patentId = String(request.body?.patentId || '').trim();
    if (!patentNumber) return reply.code(400).send({ error: 'patentNumber é obrigatório' });
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
        `insert into monitored_inpi_patents (id, patent_number, patent_id, source, matched_attorney, active, blocked_by_user, created_at, updated_at, last_seen_at)
         values ($1,$2,$3,'manual',null,true,false,now(),now(),now())
         on conflict (patent_number) do update
         set active=true, blocked_by_user=false, patent_id=coalesce(excluded.patent_id, monitored_inpi_patents.patent_id), source='manual', updated_at=now(), last_seen_at=now()`,
        id,
        patentNumber,
        patentId || null
    );
    return { id, patentNumber, active: true };
});

fastify.post('/monitoring/patents/:id/toggle', async (request: any, reply) => {
    await ensureMonitoringTables();
    const { id } = request.params as { id: string };
    const active = Boolean(request.body?.active);
    const blockedByUser = request.body?.blockedByUser === undefined ? !active : Boolean(request.body?.blockedByUser);
    const updated = await prisma.$queryRawUnsafe<any[]>(
        `update monitored_inpi_patents
         set active=$2, blocked_by_user=$3, updated_at=now()
         where id=$1
         returning id, patent_number, patent_id, source, matched_attorney, active, blocked_by_user`,
        id,
        active,
        blockedByUser
    );
    if (!updated?.[0]) return reply.code(404).send({ error: 'Patente monitorada não encontrada' });
    return updated[0];
});

fastify.get('/patents/queue', async (request: any, reply) => {
    try {
        const jobs = await prisma.scrapingJob.findMany({
            where: {
                status: { in: ['pending', 'running', 'failed'] }
            },
            orderBy: { created_at: 'desc' },
            include: {
                patent: {
                    select: {
                        numero_publicacao: true,
                        title: true
                    }
                }
            }
        });
        return { jobs };
    } catch (error: any) {
        if (isMissingTableError(error)) {
            request.log.warn({ error }, 'Fallback /patents/queue por tabela ausente');
            return { jobs: [] };
        }
        request.log.error({ error }, 'Erro em /patents/queue');
        return reply.code(500).send({ error: 'Falha ao carregar fila de patentes' });
    }
});

fastify.post('/patent/queue', async (request: any, reply) => {
    const { codPedido, publicationNumber, title } = request.body as {
        codPedido: string;
        publicationNumber?: string;
        title?: string;
    };

    if (!codPedido) {
        return reply.code(400).send({ error: 'codPedido é obrigatório' });
    }

    // 1. Ensure patent exists (upsert stub)
    await prisma.inpiPatent.upsert({
        where: { cod_pedido: codPedido },
        update: {
            // Keep existing data, but update numbering if provided
            numero_publicacao: publicationNumber || undefined,
            title: title || undefined
        },
        create: {
            cod_pedido: codPedido,
            numero_publicacao: publicationNumber || null,
            title: title || null
        }
    });

    // 2. Check if a job is already active/pending
    const activeJob = await prisma.scrapingJob.findFirst({
        where: {
            patent_id: codPedido,
            status: { in: ['pending', 'running'] }
        }
    });

    if (activeJob) {
        return { status: activeJob.status, message: 'Já está na fila ou sendo processado' };
    }

    // 3. Create new job
    const job = await prisma.scrapingJob.create({
        data: {
            patent_id: codPedido,
            status: 'pending'
        }
    });
    const normalize = (value?: string | null) => String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    const candidateKeys = Array.from(new Set([normalize(codPedido), normalize(publicationNumber)].filter(Boolean)));
    const publicationCandidates = await prisma.inpiPublication.findMany({
        where: {
            OR: [
                { patent_id: codPedido },
                ...(candidateKeys.length ? [{ patent_number: { in: candidateKeys } }] : [])
            ]
        },
        orderBy: { created_at: 'desc' },
        take: 300
    }).catch(() => []);
    let docJobsQueued = 0;
    for (const row of publicationCandidates) {
        const normalizedCode = String(row.despacho_code || '').replace(/\s+/g, '');
        const docEligible = row.eligible_for_doc_download || normalizedCode === '3.1' || normalizedCode === '16.1';
        const publicationForJob = row.patent_number || publicationNumber || codPedido;
        if (!docEligible || !publicationForJob) continue;
        const existingJob = await prisma.documentDownloadJob.findFirst({
            where: { patent_id: codPedido, publication_number: publicationForJob }
        });
        if (existingJob?.id) {
            await prisma.documentDownloadJob.update({
                where: { id: existingJob.id },
                data: { status: 'pending', error: null, updated_at: new Date() }
            });
            docJobsQueued += 1;
        } else {
            const created = await prisma.documentDownloadJob.create({
                data: { patent_id: codPedido, publication_number: publicationForJob, status: 'pending' }
            });
            if (created?.id) docJobsQueued += 1;
        }
    }

    return { status: job.status, jobId: job.id, docJobsQueued };
});

start();
