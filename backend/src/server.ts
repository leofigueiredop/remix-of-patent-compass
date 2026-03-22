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
    debugGooglePatentsLookup,
    debugInpiLookup,
    enqueueBigQueryFromFailedSources,
    enqueueBigQueryReprocessing,
    enqueueIncompletePatentReprocessing,
    enqueueInpiReprocessing,
    enqueueLastFiveYearsRpi,
    enqueueAllProcessedPatentsDocumentAudit,
    enqueueShortDocumentReprocessing,
    getBackgroundWorkerState,
    retryAllBigQueryErrorJobs,
    retryAllDocumentErrorJobs,
    retryAllInpiErrorJobs,
    retryInpiJob,
    retryAllOpsErrorJobs,
    retryAllRpiErrorJobs,
    retryBigQueryJob,
    retryDocumentJob,
    retryOpsBibliographicJob,
    retryRpiJob,
    setBackgroundWorkerPause,
    startBackgroundWorkers
} from './services/backgroundWorkers';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createHash, randomUUID } from 'crypto';
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
        },
        bigquery: {
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
        `create index if not exists idx_monitoring_alerts_monitored_patent on monitoring_alerts(monitored_patent_id)`,
        `create table if not exists monitoring_collision_ai_briefs (
            id text primary key,
            patent_number text not null,
            context_hash text not null,
            risk_level text not null,
            summary text not null,
            key_points jsonb not null default '[]'::jsonb,
            collision_focus text null,
            recommendation text null,
            raw_payload jsonb null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique(patent_number, context_hash)
        )`,
        `create index if not exists idx_monitoring_collision_ai_briefs_patent on monitoring_collision_ai_briefs(patent_number)`
    ];
    for (const sql of statements) {
        await prisma.$executeRawUnsafe(sql);
    }
}

async function ensureBusinessTables() {
    const statements = [
        `create table if not exists crm_demands (
            id text primary key,
            client_id text null references "Client"(id) on delete set null,
            title text not null,
            description text null,
            status text not null default 'nova',
            priority text not null default 'media',
            due_date timestamptz null,
            owner_name text null,
            patent_number text null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )`,
        `alter table if exists crm_demands add column if not exists contact_id text null`,
        `alter table if exists crm_demands add column if not exists monitoring_origin text null`,
        `alter table if exists crm_demands add column if not exists monitoring_type text null`,
        `alter table if exists crm_demands add column if not exists occurrence_id text null`,
        `alter table if exists crm_demands add column if not exists item_related text null`,
        `alter table if exists crm_demands add column if not exists ai_summary text null`,
        `alter table if exists crm_demands add column if not exists sla_due_at timestamptz null`,
        `alter table if exists crm_demands add column if not exists metadata jsonb not null default '{}'::jsonb`,
        `create index if not exists idx_crm_demands_status on crm_demands(status)`,
        `create index if not exists idx_crm_demands_client on crm_demands(client_id)`,
        `create index if not exists idx_crm_demands_occurrence on crm_demands(occurrence_id)`,
        `create table if not exists client_contacts (
            id text primary key,
            client_id text not null references "Client"(id) on delete cascade,
            name text not null,
            email text not null,
            phone text null,
            role_area text not null default 'general',
            is_primary boolean not null default false,
            active boolean not null default true,
            notes text null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )`,
        `create index if not exists idx_client_contacts_client on client_contacts(client_id)`,
        `create index if not exists idx_client_contacts_area on client_contacts(role_area)`,
        `create table if not exists client_routing_rules (
            id text primary key,
            client_id text not null references "Client"(id) on delete cascade,
            occurrence_type text not null,
            role_area text not null default 'general',
            override_contact_id text null,
            active boolean not null default true,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )`,
        `create index if not exists idx_client_routing_rules_client on client_routing_rules(client_id)`,
        `create table if not exists crm_demand_comments (
            id text primary key,
            demand_id text not null references crm_demands(id) on delete cascade,
            body text not null,
            created_by text null,
            created_at timestamptz not null default now()
        )`,
        `create index if not exists idx_crm_demand_comments_demand on crm_demand_comments(demand_id)`,
        `create table if not exists crm_demand_history (
            id text primary key,
            demand_id text not null references crm_demands(id) on delete cascade,
            action text not null,
            old_value text null,
            new_value text null,
            created_by text null,
            created_at timestamptz not null default now()
        )`,
        `create index if not exists idx_crm_demand_history_demand on crm_demand_history(demand_id)`,
        `create table if not exists crm_demand_attachments (
            id text primary key,
            demand_id text not null references crm_demands(id) on delete cascade,
            file_name text not null,
            file_url text not null,
            file_type text null,
            uploaded_by text null,
            created_at timestamptz not null default now()
        )`,
        `create index if not exists idx_crm_demand_attachments_demand on crm_demand_attachments(demand_id)`,
        `create table if not exists email_delivery_logs (
            id text primary key,
            client_id text null references "Client"(id) on delete set null,
            demand_id text null references crm_demands(id) on delete set null,
            occurrence_id text null,
            recipient_email text not null,
            recipient_name text null,
            template_key text null,
            subject text not null,
            body text not null,
            status text not null default 'queued',
            error text null,
            created_at timestamptz not null default now()
        )`,
        `create index if not exists idx_email_delivery_logs_client on email_delivery_logs(client_id)`,
        `create index if not exists idx_email_delivery_logs_demand on email_delivery_logs(demand_id)`,
        `create table if not exists monitoring_market_watchlists (
            id text primary key,
            name text not null unique,
            query text not null,
            scope text not null default 'all',
            active boolean not null default true,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )`,
        `create index if not exists idx_monitoring_market_watchlists_active on monitoring_market_watchlists(active)`,
        `create table if not exists system_settings (
            key text primary key,
            value jsonb not null,
            updated_at timestamptz not null default now()
        )`,
        `create table if not exists monitoring_profiles (
            id text primary key,
            type text not null,
            name text not null,
            client_id text null references "Client"(id) on delete set null,
            asset_patent_number text null,
            asset_title text null,
            owner_name text null,
            attorney_name text null,
            sensitivity text not null default 'equilibrado',
            score_min_alert int not null default 55,
            score_min_queue int not null default 70,
            auto_generate_demand boolean not null default false,
            send_client_after_validation boolean not null default false,
            feedback_required boolean not null default false,
            channels jsonb not null default '[]'::jsonb,
            rules jsonb not null default '{}'::jsonb,
            tags jsonb not null default '[]'::jsonb,
            notes text null,
            status text not null default 'active',
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )`,
        `create index if not exists idx_monitoring_profiles_type on monitoring_profiles(type)`,
        `create index if not exists idx_monitoring_profiles_status on monitoring_profiles(status)`,
        `create index if not exists idx_monitoring_profiles_client on monitoring_profiles(client_id)`,
        `create table if not exists monitoring_occurrences (
            id text primary key,
            profile_id text not null references monitoring_profiles(id) on delete cascade,
            monitoring_type text not null,
            client_id text null references "Client"(id) on delete set null,
            patent_number text null,
            rpi_number text null,
            publication_id text null,
            event_type text not null,
            origin_source text null,
            title text null,
            summary text null,
            detail jsonb not null default '{}'::jsonb,
            rule_score int not null default 0,
            semantic_score int not null default 0,
            legal_score int not null default 0,
            final_score int not null default 0,
            priority text not null default 'low',
            status text not null default 'pending_triage',
            ia_status text not null default 'not_requested',
            ia_payload jsonb null,
            assigned_to text null,
            crm_demand_id text null,
            client_feedback_status text not null default 'pending_send',
            client_feedback_note text null,
            sent_to_client_at timestamptz null,
            reviewed_at timestamptz null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )`,
        `create index if not exists idx_monitoring_occurrences_profile on monitoring_occurrences(profile_id)`,
        `create index if not exists idx_monitoring_occurrences_status on monitoring_occurrences(status)`,
        `create index if not exists idx_monitoring_occurrences_priority on monitoring_occurrences(priority)`,
        `create index if not exists idx_monitoring_occurrences_type on monitoring_occurrences(monitoring_type)`,
        `create index if not exists idx_monitoring_occurrences_client on monitoring_occurrences(client_id)`,
        `create table if not exists monitoring_occurrence_feedback (
            id text primary key,
            occurrence_id text not null references monitoring_occurrences(id) on delete cascade,
            source text not null,
            feedback text not null,
            note text null,
            created_by text null,
            created_at timestamptz not null default now()
        )`,
        `create index if not exists idx_monitoring_feedback_occurrence on monitoring_occurrence_feedback(occurrence_id)`,
        `create table if not exists monitoring_rpi_runs (
            id text primary key,
            rpi_number text not null,
            run_mode text not null,
            total_publications int not null default 0,
            matched_occurrences int not null default 0,
            status text not null default 'completed',
            error text null,
            created_at timestamptz not null default now()
        )`,
        `create index if not exists idx_monitoring_rpi_runs_rpi on monitoring_rpi_runs(rpi_number)`
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
    if (!normalized) return '';
    const compact = normalized.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    
    // Strip check digit for ALL Brazilian patents (BR followed by 10, 11, 12, 13)
    let finalQuery = compact;
    const brMatch = compact.match(/^BR(10|11|12|13)(\d+)$/);
    const hasHyphenCheckDigit = publicationNumber ? /-[0-9X]$/i.test(publicationNumber.trim()) : false;
    
    if (brMatch) {
        // If it was parsed from something without hyphen check digit, but has 15 chars (BR + 13 digits), strip the last digit.
        if (!hasHyphenCheckDigit && brMatch[2].length > 10) {
            finalQuery = `BR${brMatch[1]}${brMatch[2].slice(0, -1)}`;
        } else if (hasHyphenCheckDigit) {
            // It already didn't include the check digit because compact removed hyphen and everything after if we used split, 
            // wait, `compact` removed hyphens, so the check digit IS in `compact`. We need to strip it.
            finalQuery = compact.slice(0, -1);
        }
    }
    
    // Always remove 'BR' for Google Patents search to be broader, or keep it.
    // Google Patents works well with just the number.
    const noBr = finalQuery.replace(/^BR/i, '');
    const query = noBr || finalQuery;
    
    return `https://patents.google.com/patent/BR${query}/en`;
}

function buildPublicationSearchNeedles(value: string): string[] {
    const raw = normalizeStringField(value).toUpperCase();
    if (!raw) return [];
    const compact = raw.replace(/[^A-Z0-9]/g, '');
    const withoutCheckDigitRaw = raw.replace(/-([0-9X])$/, '');
    const withoutCheckDigitCompact = compact.startsWith('BR')
        ? compact.replace(/(BR(?:10|11)\d+)[0-9X]$/, '$1')
        : compact;
    return Array.from(new Set([raw, compact, withoutCheckDigitRaw, withoutCheckDigitCompact].filter(Boolean)));
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
        const numberNeedles = buildPublicationSearchNeedles(normalizedNumber);
        andClauses.push({
            OR: numberNeedles.flatMap((needle) => ([
                { numero_publicacao: { contains: needle, mode: 'insensitive' } },
                { cod_pedido: { contains: needle, mode: 'insensitive' } }
            ]))
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

function parseModelJsonResponse(raw: string): any {
    try {
        return JSON.parse(raw);
    } catch {
        const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (codeBlock?.[1]) return JSON.parse(codeBlock[1]);
        const objectMatch = raw.match(/\{[\s\S]*\}/);
        if (objectMatch?.[0]) return JSON.parse(objectMatch[0]);
        throw new Error('Resposta da IA não está em JSON válido');
    }
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
    } catch (err) {
        return reply.code(401).send({ error: 'Token inválido' });
    }
});

// ==========================================
// CLIENTS API (CRM)
// ==========================================

function normalizeOccurrenceArea(value: any): 'patents' | 'financial' | 'brands' | 'general' {
    const raw = String(value || '').toLowerCase();
    if (raw.includes('process') || raw.includes('collision') || raw.includes('patent') || raw.includes('exig') || raw.includes('anuidade')) return 'patents';
    if (raw.includes('finance') || raw.includes('invoice') || raw.includes('cobranca') || raw.includes('proposta')) return 'financial';
    if (raw.includes('brand') || raw.includes('marca')) return 'brands';
    return 'general';
}

async function resolveClientRecipient(clientId: string | null, occurrenceType: string, manualContactId?: string) {
    if (!clientId) return null;
    if (manualContactId) {
        const direct = await prisma.$queryRawUnsafe<any[]>(
            `select * from client_contacts where id=$1 and client_id=$2 and active=true limit 1`,
            manualContactId,
            clientId
        ).catch(() => []);
        if (direct?.[0]) return direct[0];
    }
    const area = normalizeOccurrenceArea(occurrenceType);
    const rule = await prisma.$queryRawUnsafe<any[]>(
        `select * from client_routing_rules
         where client_id=$1 and occurrence_type=$2 and active=true
         order by updated_at desc
         limit 1`,
        clientId,
        occurrenceType
    ).catch(() => []);
    if (rule?.[0]?.override_contact_id) {
        const byOverride = await prisma.$queryRawUnsafe<any[]>(
            `select * from client_contacts where id=$1 and client_id=$2 and active=true limit 1`,
            rule[0].override_contact_id,
            clientId
        ).catch(() => []);
        if (byOverride?.[0]) return byOverride[0];
    }
    const byArea = await prisma.$queryRawUnsafe<any[]>(
        `select * from client_contacts
         where client_id=$1 and role_area=$2 and active=true
         order by is_primary desc, updated_at desc
         limit 1`,
        clientId,
        area
    ).catch(() => []);
    if (byArea?.[0]) return byArea[0];
    const fallback = await prisma.$queryRawUnsafe<any[]>(
        `select * from client_contacts
         where client_id=$1 and active=true
         order by is_primary desc, updated_at desc
         limit 1`,
        clientId
    ).catch(() => []);
    return fallback?.[0] || null;
}

fastify.get('/clients/cnpj/:cnpj/autofill', async (request: any, reply: any) => {
    const cnpj = String(request.params?.cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) return reply.status(400).send({ error: 'CNPJ inválido' });
    try {
        const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
        if (!response.ok) return reply.status(404).send({ error: 'CNPJ não encontrado' });
        const data: any = await response.json();
        return {
            cnpj,
            legalName: data?.razao_social || data?.nome_fantasia || '',
            tradeName: data?.nome_fantasia || '',
            email: data?.email || '',
            phone: data?.ddd_telefone_1 || '',
            city: data?.municipio || '',
            state: data?.uf || '',
            mainCnae: data?.cnae_fiscal_descricao || '',
            raw: data
        };
    } catch (error: any) {
        return reply.status(503).send({ error: error?.message || 'Autofill indisponível no momento' });
    }
});

fastify.get('/clients', async (request: any, reply: any) => {
    try {
        await ensureBusinessTables();
        const clients = await prisma.client.findMany({
            include: {
                _count: {
                    select: { patents: true }
                }
            },
            orderBy: { name: 'asc' }
        });
        const ids = clients.map((client) => client.id);
        const contactCountRows = ids.length > 0
            ? await prisma.$queryRawUnsafe<any[]>(
                `select client_id, count(*)::int as total
                 from client_contacts
                 where client_id = any($1::text[]) and active=true
                 group by client_id`,
                ids
            ).catch(() => [])
            : [];
        const contactCountMap = new Map<string, number>();
        for (const row of contactCountRows) contactCountMap.set(String(row.client_id), Number(row.total || 0));
        return clients.map((client) => ({
            ...client,
            contacts_count: contactCountMap.get(client.id) || 0
        }));
    } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Erro ao buscar clientes' });
    }
});

fastify.post('/clients', async (request: any, reply: any) => {
    try {
        await ensureBusinessTables();
        const { name, email, document } = request.body;
        if (!name) {
            return reply.status(400).send({ error: 'Nome é obrigatório' });
        }
        const client = await prisma.client.create({
            data: { name, email, document }
        });
        if (String(email || '').trim()) {
            await prisma.$executeRawUnsafe(
                `insert into client_contacts (id, client_id, name, email, role_area, is_primary, active, created_at, updated_at)
                 values ($1,$2,$3,$4,'general',true,true,now(),now())`,
                randomUUID(),
                client.id,
                name,
                String(email).trim()
            ).catch(() => undefined);
        }
        return reply.status(201).send(client);
    } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Erro ao criar cliente' });
    }
});

fastify.get('/clients/:id/contacts', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const { id } = request.params as { id: string };
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select *
         from client_contacts
         where client_id=$1
         order by is_primary desc, updated_at desc`,
        id
    ).catch(() => []);
    return { rows };
});

fastify.post('/clients/:id/contacts', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const { id } = request.params as { id: string };
    const name = cleanTextValue(request.body?.name);
    const email = cleanTextValue(request.body?.email);
    if (!name || !email) return reply.status(400).send({ error: 'Nome e email são obrigatórios' });
    const roleArea = cleanTextValue(request.body?.roleArea || 'general').toLowerCase();
    const isPrimary = Boolean(request.body?.isPrimary);
    if (isPrimary) {
        await prisma.$executeRawUnsafe(`update client_contacts set is_primary=false, updated_at=now() where client_id=$1`, id).catch(() => undefined);
    }
    const contactId = randomUUID();
    await prisma.$executeRawUnsafe(
        `insert into client_contacts (id, client_id, name, email, phone, role_area, is_primary, active, notes, created_at, updated_at)
         values ($1,$2,$3,$4,nullif($5,''),$6,$7,true,nullif($8,''),now(),now())`,
        contactId,
        id,
        name,
        email,
        cleanTextValue(request.body?.phone),
        ['patents', 'financial', 'brands', 'general'].includes(roleArea) ? roleArea : 'general',
        isPrimary,
        cleanTextValue(request.body?.notes)
    );
    return reply.status(201).send({ id: contactId });
});

fastify.patch('/clients/:clientId/contacts/:contactId', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const { clientId, contactId } = request.params as { clientId: string; contactId: string };
    const isPrimary = request.body?.isPrimary === undefined ? undefined : Boolean(request.body?.isPrimary);
    if (isPrimary) {
        await prisma.$executeRawUnsafe(`update client_contacts set is_primary=false, updated_at=now() where client_id=$1`, clientId).catch(() => undefined);
    }
    const updated = await prisma.$queryRawUnsafe<any[]>(
        `update client_contacts
         set
            name = coalesce(nullif($3,''), name),
            email = coalesce(nullif($4,''), email),
            phone = case when $5 is null then phone else nullif($5,'') end,
            role_area = coalesce(nullif($6,''), role_area),
            is_primary = coalesce($7, is_primary),
            active = coalesce($8, active),
            notes = case when $9 is null then notes else nullif($9,'') end,
            updated_at = now()
         where id=$1 and client_id=$2
         returning id`,
        contactId,
        clientId,
        typeof request.body?.name === 'string' ? request.body.name : null,
        typeof request.body?.email === 'string' ? request.body.email : null,
        typeof request.body?.phone === 'string' ? request.body.phone : null,
        typeof request.body?.roleArea === 'string' ? request.body.roleArea.toLowerCase() : null,
        isPrimary === undefined ? null : isPrimary,
        typeof request.body?.active === 'boolean' ? request.body.active : null,
        typeof request.body?.notes === 'string' ? request.body.notes : null
    ).catch(() => []);
    if (!updated?.[0]) return reply.status(404).send({ error: 'Contato não encontrado' });
    return { id: contactId };
});

fastify.get('/clients/:id/routing-rules', async (request: any) => {
    await ensureBusinessTables();
    const { id } = request.params as { id: string };
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select r.*, c.name as override_contact_name, c.email as override_contact_email
         from client_routing_rules r
         left join client_contacts c on c.id=r.override_contact_id
         where r.client_id=$1
         order by r.updated_at desc`,
        id
    ).catch(() => []);
    return { rows };
});

fastify.put('/clients/:id/routing-rules', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const { id } = request.params as { id: string };
    const rules = Array.isArray(request.body?.rules) ? request.body.rules : [];
    if (!Array.isArray(rules)) return reply.status(400).send({ error: 'rules inválido' });
    await prisma.$executeRawUnsafe(`delete from client_routing_rules where client_id=$1`, id).catch(() => undefined);
    for (const rule of rules) {
        const occurrenceType = cleanTextValue(rule?.occurrenceType).toLowerCase();
        const roleArea = cleanTextValue(rule?.roleArea || 'general').toLowerCase();
        if (!occurrenceType) continue;
        await prisma.$executeRawUnsafe(
            `insert into client_routing_rules (id, client_id, occurrence_type, role_area, override_contact_id, active, created_at, updated_at)
             values ($1,$2,$3,$4,nullif($5,''),$6,now(),now())`,
            randomUUID(),
            id,
            occurrenceType,
            ['patents', 'financial', 'brands', 'general'].includes(roleArea) ? roleArea : 'general',
            cleanTextValue(rule?.overrideContactId),
            rule?.active === undefined ? true : Boolean(rule.active)
        );
    }
    return { ok: true };
});

fastify.get('/demands', async (request: any, reply) => {
    try {
        await ensureBusinessTables();
        const q = String(request.query?.q || '').trim();
        const status = String(request.query?.status || '').trim();
        const priority = String(request.query?.priority || '').trim();
        const view = String(request.query?.view || 'list').trim().toLowerCase();
        const values: any[] = [];
        const conditions: string[] = [];
        const push = (value: any) => {
            values.push(value);
            return `$${values.length}`;
        };
        if (q) {
            const token = `%${q}%`;
            conditions.push(`(d.title ilike ${push(token)} or coalesce(d.description,'') ilike ${push(token)} or coalesce(c.name,'') ilike ${push(token)} or coalesce(d.patent_number,'') ilike ${push(token)})`);
        }
        if (status && status !== 'all') {
            conditions.push(`d.status = ${push(status)}`);
        }
        if (priority && priority !== 'all') {
            conditions.push(`d.priority = ${push(priority)}`);
        }
        const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
        const rows = await prisma.$queryRawUnsafe<any[]>(
            `select d.id, d.client_id, c.name as client_name, d.contact_id, cc.name as contact_name, cc.email as contact_email,
                    d.monitoring_origin, d.monitoring_type, d.occurrence_id, d.item_related, d.ai_summary, d.sla_due_at, d.metadata,
                    d.title, d.description, d.status, d.priority, d.due_date, d.owner_name, d.patent_number, d.created_at, d.updated_at
             from crm_demands d
             left join "Client" c on c.id = d.client_id
             left join client_contacts cc on cc.id = d.contact_id
             ${whereClause}
             order by d.updated_at desc`,
            ...values
        );
        const demandIds = rows.map((row: any) => row.id);
        const commentsByDemand = demandIds.length > 0
            ? await prisma.$queryRawUnsafe<any[]>(
                `select demand_id, count(*)::int as total from crm_demand_comments where demand_id = any($1::text[]) group by demand_id`,
                demandIds
            ).catch(() => [])
            : [];
        const emailByDemand = demandIds.length > 0
            ? await prisma.$queryRawUnsafe<any[]>(
                `select demand_id, count(*)::int as total from email_delivery_logs where demand_id = any($1::text[]) group by demand_id`,
                demandIds
            ).catch(() => [])
            : [];
        const commentMap = new Map<string, number>();
        for (const row of commentsByDemand) commentMap.set(String(row.demand_id), Number(row.total || 0));
        const emailMap = new Map<string, number>();
        for (const row of emailByDemand) emailMap.set(String(row.demand_id), Number(row.total || 0));
        if (view === 'kanban') {
            const columns = ['nova', 'triagem', 'andamento', 'cliente', 'concluida'];
            const board: Record<string, any[]> = {};
            for (const col of columns) board[col] = [];
            for (const row of rows) {
                const enriched = {
                    ...row,
                    metadata: parseJsonObject(row.metadata, {}),
                    comments_count: commentMap.get(row.id) || 0,
                    emails_count: emailMap.get(row.id) || 0
                };
                const bucket = columns.includes(String(row.status)) ? String(row.status) : 'nova';
                board[bucket].push(enriched);
            }
            return { view: 'kanban', board, rows: [] };
        }
        return {
            view: 'list',
            rows: rows.map((row: any) => ({
                ...row,
                metadata: parseJsonObject(row.metadata, {}),
                comments_count: commentMap.get(row.id) || 0,
                emails_count: emailMap.get(row.id) || 0
            }))
        };
    } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Erro ao buscar demandas' });
    }
});

fastify.post('/demands', async (request: any, reply) => {
    try {
        await ensureBusinessTables();
        const title = String(request.body?.title || '').trim();
        const description = String(request.body?.description || '').trim();
        const clientId = String(request.body?.clientId || '').trim();
        const priority = String(request.body?.priority || 'media').trim().toLowerCase();
        const dueDate = request.body?.dueDate ? new Date(request.body?.dueDate) : null;
        const slaDueAt = request.body?.slaDueAt ? new Date(request.body?.slaDueAt) : null;
        const ownerName = String(request.body?.ownerName || '').trim();
        const patentNumber = String(request.body?.patentNumber || '').trim();
        const monitoringOrigin = cleanTextValue(request.body?.monitoringOrigin);
        const monitoringType = cleanTextValue(request.body?.monitoringType);
        const occurrenceId = cleanTextValue(request.body?.occurrenceId);
        const itemRelated = cleanTextValue(request.body?.itemRelated);
        const aiSummary = cleanTextValue(request.body?.aiSummary);
        const contactId = cleanTextValue(request.body?.contactId);
        const metadata = request.body?.metadata || {};
        if (!title) return reply.status(400).send({ error: 'Título é obrigatório' });
        const id = randomUUID();
        await prisma.$executeRawUnsafe(
            `insert into crm_demands (
                id, client_id, contact_id, monitoring_origin, monitoring_type, occurrence_id, item_related, ai_summary,
                title, description, status, priority, due_date, sla_due_at, owner_name, patent_number, metadata, created_at, updated_at
             )
             values (
                $1, $2, nullif($3,''), nullif($4,''), nullif($5,''), nullif($6,''), nullif($7,''), nullif($8,''),
                $9, nullif($10,''), 'nova', $11, $12, $13, nullif($14,''), nullif($15,''), $16::jsonb, now(), now()
             )`,
            id,
            clientId || null,
            contactId,
            monitoringOrigin,
            monitoringType,
            occurrenceId,
            itemRelated,
            aiSummary,
            title,
            description || null,
            ['baixa', 'media', 'alta', 'critica'].includes(priority) ? priority : 'media',
            dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.toISOString() : null,
            slaDueAt && !Number.isNaN(slaDueAt.getTime()) ? slaDueAt.toISOString() : null,
            ownerName,
            patentNumber,
            JSON.stringify(metadata || {})
        );
        await prisma.$executeRawUnsafe(
            `insert into crm_demand_history (id, demand_id, action, old_value, new_value, created_by, created_at)
             values ($1,$2,'created',null,$3,null,now())`,
            randomUUID(),
            id,
            'nova'
        ).catch(() => undefined);
        return reply.status(201).send({ id });
    } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Erro ao criar demanda' });
    }
});

fastify.patch('/demands/:id', async (request: any, reply) => {
    try {
        await ensureBusinessTables();
        const { id } = request.params as { id: string };
        const updates: string[] = [];
        const values: any[] = [];
        const push = (value: any) => {
            values.push(value);
            return `$${values.length}`;
        };
        if (request.body?.status) updates.push(`status = ${push(String(request.body.status))}`);
        if (request.body?.priority) updates.push(`priority = ${push(String(request.body.priority))}`);
        if (typeof request.body?.ownerName === 'string') updates.push(`owner_name = nullif(${push(request.body.ownerName)}, '')`);
        if (typeof request.body?.description === 'string') updates.push(`description = nullif(${push(request.body.description)}, '')`);
        if (typeof request.body?.title === 'string') updates.push(`title = nullif(${push(request.body.title)}, '')`);
        if (typeof request.body?.contactId === 'string') updates.push(`contact_id = nullif(${push(request.body.contactId)}, '')`);
        if (typeof request.body?.dueDate === 'string') updates.push(`due_date = ${push(request.body.dueDate)}`);
        if (typeof request.body?.slaDueAt === 'string') updates.push(`sla_due_at = ${push(request.body.slaDueAt)}`);
        if (typeof request.body?.metadata !== 'undefined') updates.push(`metadata = ${push(JSON.stringify(request.body.metadata || {}))}::jsonb`);
        if (!updates.length) return reply.status(400).send({ error: 'Nenhum campo para atualizar' });
        const before = await prisma.$queryRawUnsafe<any[]>(`select status, priority from crm_demands where id=$1 limit 1`, id).catch(() => []);
        updates.push(`updated_at = now()`);
        const updated = await prisma.$queryRawUnsafe<any[]>(
            `update crm_demands set ${updates.join(', ')} where id = ${push(id)} returning id, status, priority, owner_name, updated_at`
        );
        if (!updated?.[0]) return reply.status(404).send({ error: 'Demanda não encontrada' });
        if (before?.[0]?.status !== updated[0].status) {
            await prisma.$executeRawUnsafe(
                `insert into crm_demand_history (id, demand_id, action, old_value, new_value, created_by, created_at)
                 values ($1,$2,'status_change',$3,$4,null,now())`,
                randomUUID(),
                id,
                String(before[0]?.status || ''),
                String(updated[0]?.status || '')
            ).catch(() => undefined);
        }
        return updated[0];
    } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Erro ao atualizar demanda' });
    }
});

fastify.get('/demands/:id', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const { id } = request.params as { id: string };
    const demandRows = await prisma.$queryRawUnsafe<any[]>(
        `select d.*, c.name as client_name, cc.name as contact_name, cc.email as contact_email
         from crm_demands d
         left join "Client" c on c.id=d.client_id
         left join client_contacts cc on cc.id=d.contact_id
         where d.id=$1
         limit 1`,
        id
    ).catch(() => []);
    if (!demandRows?.[0]) return reply.status(404).send({ error: 'Demanda não encontrada' });
    const [comments, history, attachments, emails] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(`select * from crm_demand_comments where demand_id=$1 order by created_at desc`, id).catch(() => []),
        prisma.$queryRawUnsafe<any[]>(`select * from crm_demand_history where demand_id=$1 order by created_at desc`, id).catch(() => []),
        prisma.$queryRawUnsafe<any[]>(`select * from crm_demand_attachments where demand_id=$1 order by created_at desc`, id).catch(() => []),
        prisma.$queryRawUnsafe<any[]>(`select * from email_delivery_logs where demand_id=$1 order by created_at desc`, id).catch(() => [])
    ]);
    return {
        demand: {
            ...demandRows[0],
            metadata: parseJsonObject(demandRows[0].metadata, {})
        },
        comments,
        history,
        attachments,
        emails
    };
});

fastify.post('/demands/:id/comments', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const { id } = request.params as { id: string };
    const body = cleanTextValue(request.body?.body);
    const createdBy = cleanTextValue(request.body?.createdBy);
    if (!body) return reply.status(400).send({ error: 'Comentário vazio' });
    const commentId = randomUUID();
    await prisma.$executeRawUnsafe(
        `insert into crm_demand_comments (id, demand_id, body, created_by, created_at)
         values ($1,$2,$3,nullif($4,''),now())`,
        commentId,
        id,
        body,
        createdBy
    );
    return reply.status(201).send({ id: commentId });
});

fastify.post('/demands/bulk-convert', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const occurrenceIds = Array.isArray(request.body?.occurrenceIds) ? request.body.occurrenceIds.map((item: any) => cleanTextValue(item)).filter(Boolean) : [];
    if (occurrenceIds.length === 0) return reply.status(400).send({ error: 'occurrenceIds é obrigatório' });
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select o.*, p.name as monitoring_name
         from monitoring_occurrences o
         left join monitoring_profiles p on p.id=o.profile_id
         where o.id = any($1::text[])`,
        occurrenceIds
    ).catch(() => []);
    const createdIds: string[] = [];
    for (const occurrence of rows) {
        const demandId = randomUUID();
        await prisma.$executeRawUnsafe(
            `insert into crm_demands (
                id, client_id, monitoring_origin, monitoring_type, occurrence_id, item_related, ai_summary,
                title, description, status, priority, owner_name, patent_number, metadata, created_at, updated_at
             ) values (
                $1,$2,'monitoring',$3,$4,$5,$6,
                $7,$8,'nova',$9,$10,$11,$12::jsonb,now(),now()
             )`,
            demandId,
            occurrence.client_id || null,
            occurrence.monitoring_type || null,
            occurrence.id,
            occurrence.event_type || null,
            cleanTextValue(parseJsonObject(occurrence.ia_payload, {})?.reasoning_summary || occurrence.summary),
            `[Monitoramento] ${occurrence.monitoring_name || occurrence.event_type || 'Ocorrência'}`,
            cleanTextValue(occurrence.summary),
            occurrence.priority === 'critical' ? 'critica' : occurrence.priority === 'high' ? 'alta' : occurrence.priority === 'low' ? 'baixa' : 'media',
            cleanTextValue(occurrence.assigned_to),
            cleanTextValue(occurrence.patent_number),
            JSON.stringify({ fromOccurrence: occurrence.id, score: occurrence.final_score })
        );
        await prisma.$executeRawUnsafe(
            `update monitoring_occurrences set crm_demand_id=$2, status='converted_to_demand', reviewed_at=now(), updated_at=now() where id=$1`,
            occurrence.id,
            demandId
        ).catch(() => undefined);
        createdIds.push(demandId);
    }
    return { created: createdIds.length, ids: createdIds };
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

fastify.get('/system-health', async () => {
    await ensureMonitoringTables();
    await ensureBusinessTables();
    const dbOk = await prisma.$queryRawUnsafe<any[]>(`select 1 as ok`).then(() => true).catch(() => false);
    const monitored = await prisma.$queryRawUnsafe<any[]>(`select count(*)::int as total from monitored_inpi_patents`).catch(() => [{ total: 0 }]);
    const unread = await prisma.$queryRawUnsafe<any[]>(`select count(*)::int as total from monitoring_alerts where is_read=false`).catch(() => [{ total: 0 }]);
    const lastRpi = await prisma.$queryRawUnsafe<any[]>(
        `select rpi_number, status, finished_at, updated_at from rpiimportjob order by coalesce(finished_at, updated_at) desc limit 1`
    ).catch(() => []);
    const lastDoc = await prisma.$queryRawUnsafe<any[]>(
        `select status, finished_at, updated_at from documentdownloadjob order by coalesce(finished_at, updated_at) desc limit 1`
    ).catch(() => []);
    return {
        services: {
            inpiWeb: { status: 'online' as const },
            epoOps: { status: OPS_CONSUMER_KEY ? 'online' as const : 'degraded' as const },
            database: { status: dbOk ? 'online' as const : 'offline' as const },
            groq: { status: GROQ_API_KEY ? 'online' as const : 'degraded' as const }
        },
        metrics: {
            monitoredPatents: Number(monitored?.[0]?.total || 0),
            unreadAlerts: Number(unread?.[0]?.total || 0)
        },
        syncs: [
            {
                name: 'Importação RPI',
                status: lastRpi?.[0]?.status || 'unknown',
                reference: lastRpi?.[0]?.rpi_number ? `RPI ${lastRpi[0].rpi_number}` : null,
                at: lastRpi?.[0]?.finished_at || lastRpi?.[0]?.updated_at || null
            },
            {
                name: 'Downloads de Documentos',
                status: lastDoc?.[0]?.status || 'unknown',
                reference: null,
                at: lastDoc?.[0]?.finished_at || lastDoc?.[0]?.updated_at || null
            }
        ]
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
    'register.epo.org',
    'patents.google.com',
    'patentimages.storage.googleapis.com'
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
    let baseHost = '';
    try {
        baseHost = new URL(baseUrl).hostname;
    } catch {
        baseHost = '';
    }
    const googleHost = baseHost === 'patents.google.com' || baseHost.endsWith('.patents.google.com');

    const addCandidate = (rawValue?: string) => {
        if (!rawValue) return;
        try {
            const normalized = new URL(rawValue.trim(), baseUrl).toString();
            if (!isAllowedPatentDocumentUrl(normalized)) return;
            const lower = normalized.toLowerCase();
            if (!lower.includes('.pdf') && !lower.includes('pdf') && !(googleHost && lower.includes('/patent/'))) return;
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
    $('a[href], button[data-href], button[href]').each((_, el) => {
        const text = String($(el).text() || '').toLowerCase();
        const aria = String($(el).attr('aria-label') || '').toLowerCase();
        if (text.includes('download pdf') || aria.includes('download pdf')) {
            addCandidate($(el).attr('href'));
            addCandidate($(el).attr('data-href'));
        }
    });
    if (googleHost) {
        addCandidate(`${baseUrl}?download=pdf`);
    }

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

async function resolveGooglePdfCandidatesViaBrowser(seedUrl: string, publicationNumber?: string): Promise<string[]> {
    const { default: puppeteer } = await import('puppeteer');
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    try {
        const targetRaw = String(publicationNumber || '').trim().toUpperCase();
        const targetNumber = (targetRaw.split('-')[0] || targetRaw).replace(/[^A-Z0-9]/g, '');
        await page.goto('https://patents.google.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
        if (targetNumber) {
            await page.evaluate((value) => {
                const input = document.querySelector<HTMLInputElement>('input[type="search"], input[aria-label*="Search"], input[name="q"]');
                if (input) {
                    input.focus();
                    input.value = value;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }, targetNumber);
            await page.keyboard.press('Enter');
            await new Promise((resolve) => setTimeout(resolve, 1800));
        } else {
            await page.goto(seedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        }
        let currentUrl = page.url();
        if (!currentUrl.includes('/patent/')) {
            const found = await page.evaluate(() => {
                const link = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/patent/"]')).find((item) => Boolean(item.href));
                if (!link) return '';
                link.click();
                return link.href;
            });
            if (found) {
                await new Promise((resolve) => setTimeout(resolve, 1800));
                currentUrl = page.url();
            }
        }
        await page.evaluate(() => {
            const langLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).find((item) => /portuguese|português/i.test((item.textContent || '').toLowerCase()));
            if (langLink) langLink.click();
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        currentUrl = page.url();
        const links = await page.evaluate(() => {
            const out: string[] = [];
            const add = (value?: string | null) => {
                if (!value) return;
                out.push(value);
            };
            const nodes = Array.from(document.querySelectorAll<HTMLElement>('a[href], button[data-href], button[href]'));
            for (const node of nodes) {
                const text = (node.textContent || '').toLowerCase();
                const aria = (node.getAttribute('aria-label') || '').toLowerCase();
                const href = node.getAttribute('href') || node.getAttribute('data-href') || '';
                if (text.includes('download pdf') || aria.includes('download pdf')) add(href);
                if (/pdf|download/i.test(href)) add(href);
            }
            return out;
        });
        const normalized = new Set<string>();
        for (const link of links) {
            try {
                const absolute = new URL(link, currentUrl).toString();
                if (isAllowedPatentDocumentUrl(absolute)) normalized.add(absolute);
            } catch {
                continue;
            }
        }
        normalized.add(`${currentUrl}${currentUrl.includes('?') ? '&' : '?'}download=pdf`);
        return Array.from(normalized);
    } finally {
        await page.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
    }
}

async function fetchPatentPdf(url: string, fallbackName: string, publicationNumber?: string): Promise<{ buffer: Buffer; filename: string }> {
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
    const browserCandidates = url.includes('patents.google.com')
        ? await resolveGooglePdfCandidatesViaBrowser(url, publicationNumber).catch(() => [])
        : [];
    for (const candidate of browserCandidates) {
        const response = await axios.get(candidate, {
            responseType: 'arraybuffer',
            timeout: 45000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/pdf,text/html;q=0.9,*/*;q=0.8'
            },
            validateStatus: (status) => status >= 200 && status < 400
        });
        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        const contentDisposition = response.headers['content-disposition'] as string | undefined;
        const buffer = Buffer.from(response.data);
        if (contentType.includes('application/pdf') || buffer.slice(0, 4).toString() === '%PDF') {
            return {
                buffer,
                filename: getFilenameFromHeaders(contentDisposition, fallbackName)
            };
        }
    }

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
        const buffer = Buffer.from(pdfResponse.data);
        const magic = buffer.slice(0, 4).toString();
        if (contentType.includes('application/pdf') || magic === '%PDF') {
            return {
                buffer,
                filename: getFilenameFromHeaders(contentDisposition, fallbackName)
            };
        }
        if (!contentType.includes('html')) continue;
        const nestedHtml = buffer.toString('utf8');
        const nestedCandidates = extractPdfCandidatesFromHtml(nestedHtml, candidate);
        for (const nested of nestedCandidates) {
            const nestedResponse = await axios.get(nested, {
                responseType: 'arraybuffer',
                timeout: 30000,
                maxRedirects: 5,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'application/pdf,*/*;q=0.8'
                },
                validateStatus: (status) => status >= 200 && status < 400
            });
            const nestedType = String(nestedResponse.headers['content-type'] || '').toLowerCase();
            const nestedDisposition = nestedResponse.headers['content-disposition'] as string | undefined;
            const nestedBuffer = Buffer.from(nestedResponse.data);
            const nestedMagic = nestedBuffer.slice(0, 4).toString();
            if (nestedType.includes('application/pdf') || nestedMagic === '%PDF') {
                return {
                    buffer: nestedBuffer,
                    filename: getFilenameFromHeaders(nestedDisposition, fallbackName)
                };
            }
        }
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
        const { buffer, filename } = await fetchPatentPdf(url, fallbackName, publicationNumber);
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
        await fastify.listen({ port: parseInt(process.env.PORT || '3001'), host: '0.0.0.0' });
        try {
            await ensureMonitoringTables();
        } catch (error) {
            fastify.log.error(error, 'Falha ao inicializar tabelas de monitoramento. API seguirá no ar e tentará novamente nas rotas.');
        }
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
        dbData.resumo_detalhado
        || dbData.abstract
        || inpiResultData?.resumoDetalhado
        || inpiResultData?.resumo
        || ''
    );
    const resolvedProcurador = normalizeStringField(dbData.procurador || inpiResultData?.procurador || '');
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
        const queryNeedles = queryText ? buildPublicationSearchNeedles(queryText) : [];
        const whereClause: any = queryText
            ? {
                OR: [
                    ...queryNeedles.flatMap((needle) => ([
                        { cod_pedido: { contains: needle } },
                        { numero_publicacao: { contains: needle } }
                    ])),
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
        const [rpiProcessing, rpiSuccess, rpiErrors, docsProcessing, docsSuccess, docsErrors, opsProcessing, opsSuccess, opsErrors, inpiProcessing, inpiSuccess, inpiErrors, bqProcessing, bqSuccess, bqErrors, rpiProcessingCount, rpiSuccessCount, rpiErrorsCount, docsProcessingCount, docsSuccessCount, docsErrorsCount, opsProcessingCount, opsSuccessCount, opsErrorsCount, inpiProcessingCount, inpiSuccessCount, inpiErrorsCount, bqProcessingCount, bqSuccessCount, bqErrorsCount] = await Promise.all([
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
            prismaAny.bigQueryBibliographicJob.findMany({
                where: { status: { in: ['pending', 'running'] } },
                orderBy: { created_at: 'asc' },
                take: limit
            }),
            prismaAny.bigQueryBibliographicJob.findMany({
                where: { status: 'completed' },
                orderBy: { finished_at: 'desc' },
                take: limit
            }),
            prismaAny.bigQueryBibliographicJob.findMany({
                where: { status: { in: ['failed', 'failed_permanent', 'not_found', 'waiting_indexing'] } },
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
        }),
            prismaAny.bigQueryBibliographicJob.count({
                where: { status: { in: ['pending', 'running'] } }
            }),
            prismaAny.bigQueryBibliographicJob.count({
                where: { status: 'completed' }
            }),
            prismaAny.bigQueryBibliographicJob.count({
                where: { status: { in: ['failed', 'failed_permanent', 'not_found', 'waiting_indexing'] } }
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
        source: row.storage_key ? 'bucket' : (extractSource(row.error) || (row.status === 'not_found' ? 'google_patents' : null))
    }));
    const mapOps = (rows: any[]) => rows.map((row) => ({
        ...row,
        source: extractSource(row.error) || (row.docdb_id ? 'ops_api' : null)
    }));
    const mapInpi = (rows: any[]) => rows.map((row) => ({ ...row, source: 'inpi' }));
    const mapBigQuery = (rows: any[]) => rows.map((row) => ({ ...row, source: extractSource(row.error) || 'google_patents' }));

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
            },
            bigquery: {
                processing: mapBigQuery(bqProcessing),
                success: mapBigQuery(bqSuccess),
                errors: mapBigQuery(bqErrors),
                counts: {
                    processing: bqProcessingCount,
                    success: bqSuccessCount,
                    errors: bqErrorsCount
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
    const rows: Array<{ rpi_number: number; status: 'pending'; source_url: string }> = [];
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

fastify.get('/background-workers/google-patents/test', async (request: any, reply) => {
    const publication = String(request.query?.publication || '').trim();
    if (!publication) {
        return reply.code(400).send({ error: 'publication é obrigatório' });
    }
    const result = await debugGooglePatentsLookup(publication);
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
    const { queue, action } = request.body as { queue?: 'rpi' | 'docs' | 'ops' | 'inpi' | 'bigquery' | 'all'; action?: 'pause' | 'resume' };
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

fastify.post('/background-workers/inpi/retry-errors', async (request: any, reply) => {
    try {
        const ids = Array.isArray(request.body?.ids) ? request.body.ids.filter((item: any) => typeof item === 'string') : undefined;
        const result = await retryAllInpiErrorJobs(ids);
        return result;
    } catch (error) {
        return reply.code(500).send({ error: 'Falha ao reprocessar erros da fila INPI' });
    }
});

fastify.post('/background-workers/bigquery/enqueue', async (request: any, reply) => {
    try {
        const patentNumbers = Array.isArray(request.body?.patentNumbers)
            ? request.body.patentNumbers.filter((item: any) => typeof item === 'string' && item.trim().length > 0)
            : [];
        const sourceJobType = typeof request.body?.source === 'string' ? request.body.source : undefined;
        const result = await enqueueBigQueryReprocessing(patentNumbers, sourceJobType);
        return result;
    } catch (error) {
        return reply.code(500).send({ error: 'Falha ao enfileirar BigQuery' });
    }
});

fastify.post('/background-workers/google-patents/enqueue', async (request: any, reply) => {
    try {
        const patentNumbers = Array.isArray(request.body?.patentNumbers)
            ? request.body.patentNumbers.filter((item: any) => typeof item === 'string' && item.trim().length > 0)
            : [];
        const sourceJobType = typeof request.body?.source === 'string' ? request.body.source : undefined;
        const result = await enqueueBigQueryReprocessing(patentNumbers, sourceJobType);
        return result;
    } catch (error) {
        return reply.code(500).send({ error: 'Falha ao enfileirar Google Patents' });
    }
});

fastify.post('/background-workers/bigquery/enqueue-from-errors', async (request: any, reply) => {
    try {
        const source = (request.body?.source || 'all') as 'docs' | 'ops' | 'inpi' | 'all';
        const result = await enqueueBigQueryFromFailedSources(source);
        return result;
    } catch (error) {
        return reply.code(500).send({ error: 'Falha ao enfileirar BigQuery a partir de erros' });
    }
});

fastify.post('/background-workers/google-patents/enqueue-from-errors', async (request: any, reply) => {
    try {
        const source = (request.body?.source || 'all') as 'docs' | 'ops' | 'inpi' | 'all';
        const result = await enqueueBigQueryFromFailedSources(source);
        return result;
    } catch (error) {
        return reply.code(500).send({ error: 'Falha ao enfileirar Google Patents a partir de erros' });
    }
});

fastify.post('/background-workers/google-patents/enqueue-incomplete', async (request: any, reply) => {
    try {
        const limitRaw = Number(request.body?.limit);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.floor(limitRaw))) : 500;
        const result = await enqueueIncompletePatentReprocessing(limit);
        return result;
    } catch (error: any) {
        return reply.code(500).send({ error: error?.message || 'Falha ao enfileirar patentes incompletas para Google Patents' });
    }
});

fastify.post('/background-workers/google-patents/reprocess-short-docs', async (request: any, reply) => {
    try {
        const limitRaw = Number(request.body?.limit);
        const maxPagesRaw = Number(request.body?.maxPages);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.floor(limitRaw))) : 500;
        const maxPages = Number.isFinite(maxPagesRaw) ? Math.max(1, Math.min(3, Math.floor(maxPagesRaw))) : 1;
        const result = await enqueueShortDocumentReprocessing(limit, maxPages);
        return result;
    } catch (error: any) {
        return reply.code(500).send({ error: error?.message || 'Falha ao reprocessar documentos curtos' });
    }
});

fastify.post('/background-workers/google-patents/enqueue-all-processed', async (request: any, reply) => {
    try {
        const batchSizeRaw = Number(request.body?.batchSize);
        const batchSize = Number.isFinite(batchSizeRaw) ? Math.max(100, Math.min(5000, Math.floor(batchSizeRaw))) : 1000;
        const result = await enqueueAllProcessedPatentsDocumentAudit(batchSize);
        return result;
    } catch (error: any) {
        return reply.code(500).send({ error: error?.message || 'Falha ao enfileirar todas as patentes processadas' });
    }
});

fastify.post('/background-workers/bigquery/retry/:id', async (request: any, reply) => {
    const { id } = request.params as { id: string };
    try {
        const job = await retryBigQueryJob(id);
        return { id: job.id, status: job.status };
    } catch (error) {
        return reply.code(404).send({ error: 'Job BigQuery não encontrado' });
    }
});

fastify.post('/background-workers/google-patents/retry/:id', async (request: any, reply) => {
    const { id } = request.params as { id: string };
    try {
        const job = await retryBigQueryJob(id);
        return { id: job.id, status: job.status };
    } catch (error) {
        return reply.code(404).send({ error: 'Job Google Patents não encontrado' });
    }
});

fastify.post('/background-workers/bigquery/retry-errors', async (request: any, reply) => {
    try {
        const ids = Array.isArray(request.body?.ids) ? request.body.ids.filter((item: any) => typeof item === 'string') : undefined;
        const result = await retryAllBigQueryErrorJobs(ids);
        return result;
    } catch (error) {
        return reply.code(500).send({ error: 'Falha ao reprocessar erros da fila BigQuery' });
    }
});

fastify.post('/background-workers/google-patents/retry-errors', async (request: any, reply) => {
    try {
        const ids = Array.isArray(request.body?.ids) ? request.body.ids.filter((item: any) => typeof item === 'string') : undefined;
        const result = await retryAllBigQueryErrorJobs(ids);
        return result;
    } catch (error) {
        return reply.code(500).send({ error: 'Falha ao reprocessar erros da fila Google Patents' });
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
        const preferBigQuery = request.body?.preferBigQuery === undefined ? false : Boolean(request.body?.preferBigQuery);
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

type MonitoringType = 'process' | 'collision' | 'market' | 'assets';

function normalizeMonitoringType(value: any): MonitoringType {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'process' || raw === 'collision' || raw === 'market' || raw === 'assets') return raw;
    return 'process';
}

function toJsonString(value: any, fallback: any) {
    if (value === undefined || value === null) return JSON.stringify(fallback);
    if (typeof value === 'string') {
        try {
            JSON.parse(value);
            return value;
        } catch {
            return JSON.stringify(fallback);
        }
    }
    return JSON.stringify(value);
}

function clampScore(value: any, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(100, Math.round(parsed)));
}

function scoreToPriority(score: number): 'critical' | 'high' | 'medium' | 'low' {
    if (score >= 86) return 'critical';
    if (score >= 70) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
}

function cleanTextValue(value: any): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeCompareValue(value: any): string {
    return cleanTextValue(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function normalizePatentValue(value: any): string {
    return String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function safeArrayString(value: any): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => cleanTextValue(item))
        .filter(Boolean)
        .slice(0, 40);
}

function parseJsonObject(value: any, fallback: Record<string, any> = {}): Record<string, any> {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        const parsed = JSON.parse(String(value));
        if (parsed && typeof parsed === 'object') return parsed;
        return fallback;
    } catch {
        return fallback;
    }
}

function parseJsonArray(value: any): any[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function computeRuleScore(profile: any, publication: any) {
    const rules = parseJsonObject(profile?.rules, {});
    const normalizedPatent = normalizePatentValue(publication?.patent_number);
    const normalizedTitle = normalizeCompareValue(publication?.ops_title || publication?.despacho_desc || '');
    const normalizedComplement = normalizeCompareValue(publication?.complement || '');
    const normalizedText = `${normalizedTitle} ${normalizedComplement}`;
    const normalizedApplicant = normalizeCompareValue(publication?.ops_applicant || '');
    const normalizedInventor = normalizeCompareValue(publication?.ops_inventor || '');
    const normalizedIpc = normalizeCompareValue(publication?.ops_ipc || '');
    const normalizedAttorney = normalizeCompareValue(publication?.ops_error || '');
    let score = 0;
    let matched = false;

    const patentCandidates = safeArrayString([
        ...(safeArrayString(rules?.processNumbers || [])),
        ...(safeArrayString(rules?.publicationNumbers || [])),
        ...(safeArrayString(rules?.patentNumbers || []))
    ]).map(normalizePatentValue);
    if (patentCandidates.length > 0) {
        const numberMatch = patentCandidates.some((item) => item && item === normalizedPatent);
        if (numberMatch) {
            score += 58;
            matched = true;
        } else if (profile?.type === 'process' || profile?.type === 'assets') {
            return { matched: false, score: 0 };
        }
    }

    const keywords = safeArrayString(rules?.keywords || []).map(normalizeCompareValue).filter((token) => token.length >= 3);
    const keywordHits = keywords.filter((token) => normalizedText.includes(token)).length;
    if (keywordHits > 0) {
        score += Math.min(28, keywordHits * 8);
        matched = true;
    }

    const holders = safeArrayString(rules?.holders || []).map(normalizeCompareValue).filter(Boolean);
    if (holders.some((holder) => normalizedApplicant.includes(holder))) {
        score += 18;
        matched = true;
    }

    const inventors = safeArrayString(rules?.inventors || []).map(normalizeCompareValue).filter(Boolean);
    if (inventors.some((inventor) => normalizedInventor.includes(inventor))) {
        score += 12;
        matched = true;
    }

    const attorneys = safeArrayString(rules?.attorneys || []).map(normalizeCompareValue).filter(Boolean);
    if (attorneys.some((attorney) => normalizedAttorney.includes(attorney))) {
        score += 10;
        matched = true;
    }

    const ipcCodes = safeArrayString(rules?.ipcCodes || []).map(normalizeCompareValue).filter(Boolean);
    if (ipcCodes.some((code) => normalizedIpc.includes(code))) {
        score += 16;
        matched = true;
    }

    if (!matched) return { matched: false, score: 0 };
    return { matched: true, score: Math.max(0, Math.min(100, score)) };
}

function buildMonitoringOccurrenceSummary(type: MonitoringType, publication: any) {
    const code = cleanTextValue(publication?.despacho_code || '');
    const title = cleanTextValue(publication?.ops_title || publication?.despacho_desc || publication?.patent_number || '');
    if (type === 'process') {
        return `Evento processual ${code || '-'} detectado para ${publication?.patent_number || '-'}.`;
    }
    if (type === 'collision') {
        return `Nova publicação potencialmente colidente com ativo monitorado (${publication?.patent_number || '-'}).`;
    }
    if (type === 'market') {
        return `Movimentação de mercado detectada para critérios monitorados (${publication?.patent_number || '-'}).`;
    }
    return `Ativo monitorado com nova movimentação na RPI (${publication?.patent_number || '-'})`;
}

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

fastify.get('/monitoring/collision/overview', async () => {
    await ensureMonitoringTables();
    const [totalsRows, riskRows, unreadRows, dueRows, aiCoverageRows] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(
            `select
                count(*)::int as total,
                sum(case when active then 1 else 0 end)::int as active,
                sum(case when blocked_by_user then 1 else 0 end)::int as blocked
             from monitored_inpi_patents`
        ).catch(() => [{ total: 0, active: 0, blocked: 0 }]),
        prisma.$queryRawUnsafe<any[]>(
            `with latest as (
                select distinct on (patent_number) patent_number, risk_level, updated_at
                from monitoring_collision_ai_briefs
                order by patent_number, updated_at desc
             )
             select
                sum(case when risk_level='critico' then 1 else 0 end)::int as critico,
                sum(case when risk_level='alto' then 1 else 0 end)::int as alto,
                sum(case when risk_level='medio' then 1 else 0 end)::int as medio,
                sum(case when risk_level='baixo' then 1 else 0 end)::int as baixo
             from latest`
        ).catch(() => [{ critico: 0, alto: 0, medio: 0, baixo: 0 }]),
        prisma.$queryRawUnsafe<any[]>(
            `select count(*)::int as total from monitoring_alerts where is_read=false`
        ).catch(() => [{ total: 0 }]),
        prisma.$queryRawUnsafe<any[]>(
            `select count(*)::int as total from monitoring_alerts where is_read=false and deadline is not null and deadline <= (now() + interval '7 days')`
        ).catch(() => [{ total: 0 }]),
        prisma.$queryRawUnsafe<any[]>(
            `with latest as (
                select distinct on (patent_number) patent_number
                from monitoring_collision_ai_briefs
                order by patent_number, updated_at desc
            )
            select count(*)::int as total from latest`
        ).catch(() => [{ total: 0 }])
    ]);

    const totals = totalsRows?.[0] || {};
    const risk = riskRows?.[0] || {};
    const aiCoverage = Number(aiCoverageRows?.[0]?.total || 0);
    const monitoredTotal = Number(totals?.total || 0);
    return {
        monitored: {
            total: monitoredTotal,
            active: Number(totals?.active || 0),
            blocked: Number(totals?.blocked || 0),
            aiCoverage,
            aiCoveragePct: monitoredTotal > 0 ? Math.round((aiCoverage / monitoredTotal) * 100) : 0
        },
        alerts: {
            unread: Number(unreadRows?.[0]?.total || 0),
            due7d: Number(dueRows?.[0]?.total || 0)
        },
        risk: {
            critico: Number(risk?.critico || 0),
            alto: Number(risk?.alto || 0),
            medio: Number(risk?.medio || 0),
            baixo: Number(risk?.baixo || 0)
        }
    };
});

fastify.get('/monitoring/process/overview', async () => {
    await ensureMonitoringTables();
    const [criticalOpen, deadlinesSoon, dispatches, activeMonitored] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(
            `select count(*)::int as total from monitoring_alerts where is_read=false and coalesce(despacho_code,'') in ('6.1','7.1')`
        ).catch(() => [{ total: 0 }]),
        prisma.$queryRawUnsafe<any[]>(
            `select count(*)::int as total from monitoring_alerts where is_read=false and deadline is not null and deadline <= (now() + interval '7 days')`
        ).catch(() => [{ total: 0 }]),
        prisma.$queryRawUnsafe<any[]>(
            `select count(*)::int as total from inpi_publication where created_at >= (now() - interval '7 days')`
        ).catch(() => [{ total: 0 }]),
        prisma.$queryRawUnsafe<any[]>(
            `select count(*)::int as total from monitored_inpi_patents where active=true`
        ).catch(() => [{ total: 0 }])
    ]);
    return {
        kpis: {
            openExigencies: Number(criticalOpen?.[0]?.total || 0),
            deadlines7d: Number(deadlinesSoon?.[0]?.total || 0),
            newDispatches7d: Number(dispatches?.[0]?.total || 0),
            regularProcesses: Number(activeMonitored?.[0]?.total || 0)
        }
    };
});

fastify.get('/monitoring/process/events', async (request: any) => {
    await ensureMonitoringTables();
    const q = String(request.query?.q || '').trim();
    const values: any[] = [];
    const filters: string[] = [];
    const push = (value: any) => {
        values.push(value);
        return `$${values.length}`;
    };
    if (q) {
        const token = `%${q}%`;
        filters.push(`(coalesce(a.patent_number,'') ilike ${push(token)} or coalesce(a.title,'') ilike ${push(token)} or coalesce(a.complement,'') ilike ${push(token)} or coalesce(a.despacho_code,'') ilike ${push(token)})`);
    }
    const whereClause = filters.length ? `where ${filters.join(' and ')}` : '';
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select a.id, a.patent_number, a.rpi_number, a.rpi_date, a.despacho_code, a.title, a.complement, a.severity, a.deadline, a.is_read, a.updated_at
         from monitoring_alerts a
         ${whereClause}
         order by coalesce(a.deadline, a.rpi_date) asc, a.created_at desc
         limit 250`,
        ...values
    ).catch(() => []);
    return { rows };
});

fastify.get('/monitoring/market/overview', async () => {
    await ensureBusinessTables();
    const [topHoldersRows, topClassesRows, filingsRows] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(
            `select applicant as label, count(*)::int as total
             from inpi_patents
             where applicant is not null and trim(applicant) <> ''
             group by applicant
             order by total desc
             limit 5`
        ).catch(() => []),
        prisma.$queryRawUnsafe<any[]>(
            `select split_part(ipc_codes, ';', 1) as label, count(*)::int as total
             from inpi_patents
             where ipc_codes is not null and trim(ipc_codes) <> ''
             group by split_part(ipc_codes, ';', 1)
             order by total desc
             limit 5`
        ).catch(() => []),
        prisma.$queryRawUnsafe<any[]>(
            `select count(*)::int as total
             from inpi_patents
             where created_at >= (now() - interval '30 days')`
        ).catch(() => [{ total: 0 }])
    ]);
    return {
        topHolders: topHoldersRows,
        topClasses: topClassesRows,
        filingsLast30d: Number(filingsRows?.[0]?.total || 0)
    };
});

fastify.get('/monitoring/market/watchlists', async () => {
    await ensureBusinessTables();
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select id, name, query, scope, active, created_at, updated_at
         from monitoring_market_watchlists
         order by updated_at desc`
    ).catch(() => []);
    return { rows };
});

fastify.post('/monitoring/market/watchlists', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const name = String(request.body?.name || '').trim();
    const query = String(request.body?.query || '').trim();
    const scope = String(request.body?.scope || 'all').trim();
    if (!name || !query) return reply.code(400).send({ error: 'name e query são obrigatórios' });
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
        `insert into monitoring_market_watchlists (id, name, query, scope, active, created_at, updated_at)
         values ($1,$2,$3,$4,true,now(),now())
         on conflict (name) do update set query=excluded.query, scope=excluded.scope, active=true, updated_at=now()`,
        id,
        name,
        query,
        scope
    );
    return { id, name, query, scope, active: true };
});

fastify.patch('/monitoring/market/watchlists/:id', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const { id } = request.params as { id: string };
    const active = request.body?.active === undefined ? true : Boolean(request.body?.active);
    const updated = await prisma.$queryRawUnsafe<any[]>(
        `update monitoring_market_watchlists
         set active=$2, updated_at=now()
         where id=$1
         returning id, name, query, scope, active, updated_at`,
        id,
        active
    ).catch(() => []);
    if (!updated?.[0]) return reply.code(404).send({ error: 'Vigília não encontrada' });
    return updated[0];
});

fastify.get('/monitoring/center/dashboard', async () => {
    await ensureBusinessTables();
    const [profilesByType, occurrencesSummary, triageSummary, topClients, topAttorneys, eventsByRpi, pendingFeedbackRows, withErrorsRows] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>(
            `select type, count(*)::int as total
             from monitoring_profiles
             where status='active'
             group by type`
        ).catch(() => []),
        prisma.$queryRawUnsafe<any[]>(
            `select
                count(*)::int as total,
                sum(case when priority='critical' then 1 else 0 end)::int as critical,
                sum(case when status='pending_triage' then 1 else 0 end)::int as pending_triage,
                sum(case when status='converted_to_demand' then 1 else 0 end)::int as converted_to_demand,
                sum(case when client_feedback_status='sent' then 1 else 0 end)::int as sent_to_client,
                sum(case when status='discarded' then 1 else 0 end)::int as discarded
             from monitoring_occurrences`
        ).catch(() => [{ total: 0, critical: 0, pending_triage: 0, converted_to_demand: 0, sent_to_client: 0, discarded: 0 }]),
        prisma.$queryRawUnsafe<any[]>(
            `select status, count(*)::int as total
             from monitoring_occurrences
             group by status`
        ).catch(() => []),
        prisma.$queryRawUnsafe<any[]>(
            `select coalesce(c.name, 'Sem cliente') as label, count(*)::int as total
             from monitoring_occurrences o
             left join "Client" c on c.id=o.client_id
             group by coalesce(c.name, 'Sem cliente')
             order by total desc
             limit 8`
        ).catch(() => []),
        prisma.$queryRawUnsafe<any[]>(
            `select coalesce(attorney_name, 'Sem procurador') as label, count(*)::int as total
             from monitoring_profiles
             where status='active'
             group by coalesce(attorney_name, 'Sem procurador')
             order by total desc
             limit 8`
        ).catch(() => []),
        prisma.$queryRawUnsafe<any[]>(
            `select coalesce(rpi_number, 'sem_rpi') as label, count(*)::int as total
             from monitoring_occurrences
             group by coalesce(rpi_number, 'sem_rpi')
             order by label desc
             limit 12`
        ).catch(() => []),
        prisma.$queryRawUnsafe<any[]>(
            `select count(*)::int as total
             from monitoring_occurrences
             where client_feedback_status in ('pending_send','sent','requested_revision')`
        ).catch(() => [{ total: 0 }]),
        prisma.$queryRawUnsafe<any[]>(
            `select count(*)::int as total
             from monitoring_occurrences
             where ia_status='error'`
        ).catch(() => [{ total: 0 }])
    ]);

    const typeMap = new Map<string, number>();
    for (const row of profilesByType) typeMap.set(String(row.type), Number(row.total || 0));
    return {
        profiles: {
            totalActive: Array.from(typeMap.values()).reduce((acc, cur) => acc + cur, 0),
            process: typeMap.get('process') || 0,
            collision: typeMap.get('collision') || 0,
            market: typeMap.get('market') || 0,
            assets: typeMap.get('assets') || 0
        },
        occurrences: {
            total: Number(occurrencesSummary?.[0]?.total || 0),
            critical: Number(occurrencesSummary?.[0]?.critical || 0),
            pendingTriage: Number(occurrencesSummary?.[0]?.pending_triage || 0),
            convertedToDemand: Number(occurrencesSummary?.[0]?.converted_to_demand || 0),
            sentToClient: Number(occurrencesSummary?.[0]?.sent_to_client || 0),
            discarded: Number(occurrencesSummary?.[0]?.discarded || 0),
            waitingClientFeedback: Number(pendingFeedbackRows?.[0]?.total || 0),
            processingErrors: Number(withErrorsRows?.[0]?.total || 0)
        },
        triageByStatus: triageSummary,
        topClients,
        topAttorneys,
        eventsByRpi
    };
});

fastify.get('/monitoring/center/profiles', async (request: any) => {
    await ensureBusinessTables();
    const type = cleanTextValue(request.query?.type || '').toLowerCase();
    const status = cleanTextValue(request.query?.status || '').toLowerCase();
    const q = cleanTextValue(request.query?.q || '');
    const values: any[] = [];
    const conditions: string[] = [];
    const push = (value: any) => {
        values.push(value);
        return `$${values.length}`;
    };
    if (type) conditions.push(`p.type = ${push(type)}`);
    if (status) conditions.push(`p.status = ${push(status)}`);
    if (q) {
        const token = `%${q}%`;
        conditions.push(`(p.name ilike ${push(token)} or coalesce(p.asset_patent_number,'') ilike ${push(token)} or coalesce(p.attorney_name,'') ilike ${push(token)} or coalesce(c.name,'') ilike ${push(token)})`);
    }
    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select p.*, c.name as client_name
         from monitoring_profiles p
         left join "Client" c on c.id=p.client_id
         ${whereClause}
         order by p.updated_at desc
         limit 400`,
        ...values
    ).catch(() => []);
    return {
        rows: rows.map((row: any) => ({
            ...row,
            channels: parseJsonArray(row.channels),
            tags: parseJsonArray(row.tags),
            rules: parseJsonObject(row.rules, {})
        }))
    };
});

fastify.post('/monitoring/center/profiles', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const type = normalizeMonitoringType(request.body?.type);
    const name = cleanTextValue(request.body?.name);
    const clientId = cleanTextValue(request.body?.clientId) || null;
    if (!name) return reply.code(400).send({ error: 'name é obrigatório' });
    const id = randomUUID();
    const sensitivity = cleanTextValue(request.body?.sensitivity || 'equilibrado') || 'equilibrado';
    const scoreMinAlert = clampScore(request.body?.scoreMinAlert, 55);
    const scoreMinQueue = clampScore(request.body?.scoreMinQueue, 70);
    await prisma.$executeRawUnsafe(
        `insert into monitoring_profiles (
            id, type, name, client_id, asset_patent_number, asset_title, owner_name, attorney_name,
            sensitivity, score_min_alert, score_min_queue, auto_generate_demand, send_client_after_validation,
            feedback_required, channels, rules, tags, notes, status, created_at, updated_at
        ) values (
            $1,$2,$3,$4,nullif($5,''),nullif($6,''),nullif($7,''),nullif($8,''),
            $9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,nullif($18,''),'active',now(),now()
        )`,
        id,
        type,
        name,
        clientId,
        cleanTextValue(request.body?.assetPatentNumber),
        cleanTextValue(request.body?.assetTitle),
        cleanTextValue(request.body?.ownerName),
        cleanTextValue(request.body?.attorneyName),
        sensitivity,
        scoreMinAlert,
        scoreMinQueue,
        Boolean(request.body?.autoGenerateDemand),
        Boolean(request.body?.sendClientAfterValidation),
        Boolean(request.body?.feedbackRequired),
        toJsonString(request.body?.channels, []),
        toJsonString(request.body?.rules, {}),
        toJsonString(request.body?.tags, []),
        cleanTextValue(request.body?.notes)
    );
    return reply.code(201).send({ id });
});

fastify.patch('/monitoring/center/profiles/:id', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const { id } = request.params as { id: string };
    const name = cleanTextValue(request.body?.name);
    if (!name) return reply.code(400).send({ error: 'name é obrigatório' });
    const updated = await prisma.$queryRawUnsafe<any[]>(
        `update monitoring_profiles
         set
            name=$2,
            client_id=$3,
            asset_patent_number=nullif($4,''),
            asset_title=nullif($5,''),
            owner_name=nullif($6,''),
            attorney_name=nullif($7,''),
            sensitivity=$8,
            score_min_alert=$9,
            score_min_queue=$10,
            auto_generate_demand=$11,
            send_client_after_validation=$12,
            feedback_required=$13,
            channels=$14::jsonb,
            rules=$15::jsonb,
            tags=$16::jsonb,
            notes=nullif($17,''),
            updated_at=now()
         where id=$1
         returning id`,
        id,
        name,
        cleanTextValue(request.body?.clientId) || null,
        cleanTextValue(request.body?.assetPatentNumber),
        cleanTextValue(request.body?.assetTitle),
        cleanTextValue(request.body?.ownerName),
        cleanTextValue(request.body?.attorneyName),
        cleanTextValue(request.body?.sensitivity || 'equilibrado') || 'equilibrado',
        clampScore(request.body?.scoreMinAlert, 55),
        clampScore(request.body?.scoreMinQueue, 70),
        Boolean(request.body?.autoGenerateDemand),
        Boolean(request.body?.sendClientAfterValidation),
        Boolean(request.body?.feedbackRequired),
        toJsonString(request.body?.channels, []),
        toJsonString(request.body?.rules, {}),
        toJsonString(request.body?.tags, []),
        cleanTextValue(request.body?.notes)
    ).catch(() => []);
    if (!updated?.[0]) return reply.code(404).send({ error: 'Monitoramento não encontrado' });
    return { id };
});

fastify.post('/monitoring/center/profiles/:id/toggle', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const { id } = request.params as { id: string };
    const active = request.body?.active === undefined ? true : Boolean(request.body?.active);
    const status = active ? 'active' : 'paused';
    const updated = await prisma.$queryRawUnsafe<any[]>(
        `update monitoring_profiles set status=$2, updated_at=now() where id=$1 returning id, status`,
        id,
        status
    ).catch(() => []);
    if (!updated?.[0]) return reply.code(404).send({ error: 'Monitoramento não encontrado' });
    return updated[0];
});

fastify.post('/monitoring/center/rpi/process', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const rpiNumber = cleanTextValue(request.body?.rpiNumber);
    if (!rpiNumber) return reply.code(400).send({ error: 'rpiNumber é obrigatório' });
    const profiles = await prisma.$queryRawUnsafe<any[]>(
        `select * from monitoring_profiles where status='active' order by updated_at desc limit 1000`
    ).catch(() => []);
    if (profiles.length === 0) return { runId: null, rpiNumber, totalPublications: 0, createdOccurrences: 0 };

    const publications = await prisma.$queryRawUnsafe<any[]>(
        `select id, patent_number, rpi, date, despacho_code, despacho_desc, complement, ops_title, ops_applicant, ops_inventor, ops_ipc
         from inpi_publication
         where rpi=$1
         order by created_at desc
         limit 6000`,
        rpiNumber
    ).catch(() => []);
    const runId = randomUUID();
    let createdOccurrences = 0;

    for (const publication of publications) {
        for (const profile of profiles) {
            const match = computeRuleScore(profile, publication);
            if (!match.matched) continue;
            const minAlert = Number(profile.score_min_alert || 55);
            if (match.score < minAlert) continue;
            const semanticScore = Math.max(0, Math.min(100, Math.round(match.score * 0.9)));
            const legalScore = profile.type === 'process' ? Math.max(0, Math.min(100, match.score + 10)) : Math.max(0, Math.min(100, Math.round(match.score * 0.8)));
            const finalScore = Math.max(0, Math.min(100, Math.round((match.score * 0.45) + (semanticScore * 0.35) + (legalScore * 0.20))));
            const priority = scoreToPriority(finalScore);
            const eventType = profile.type === 'process'
                ? `process_dispatch_${cleanTextValue(publication?.despacho_code || '').replace(/\s+/g, '') || 'general'}`
                : profile.type === 'collision'
                    ? 'collision_candidate'
                    : profile.type === 'market'
                        ? 'market_signal'
                        : 'asset_update';
            const detail = {
                publication,
                profileName: profile.name,
                matchingRules: parseJsonObject(profile.rules, {}),
                layers: {
                    bibliographicAvailable: Boolean(cleanTextValue(publication?.ops_title) || cleanTextValue(publication?.complement)),
                    claimsAvailable: false
                },
                scoreBreakdown: {
                    rule: match.score,
                    semantic: semanticScore,
                    legal: legalScore,
                    final: finalScore
                }
            };
            const occurrenceId = randomUUID();
            await prisma.$executeRawUnsafe(
                `insert into monitoring_occurrences (
                    id, profile_id, monitoring_type, client_id, patent_number, rpi_number, publication_id, event_type,
                    origin_source, title, summary, detail, rule_score, semantic_score, legal_score, final_score,
                    priority, status, ia_status, client_feedback_status, created_at, updated_at
                ) values (
                    $1,$2,$3,$4,$5,$6,$7,$8,
                    'rpi',$9,$10,$11::jsonb,$12,$13,$14,$15,
                    $16,'pending_triage','not_requested','pending_send',now(),now()
                )
                on conflict do nothing`,
                occurrenceId,
                profile.id,
                profile.type,
                profile.client_id || null,
                publication.patent_number || null,
                publication.rpi || null,
                publication.id || null,
                eventType,
                cleanTextValue(publication?.ops_title || publication?.despacho_desc || publication?.patent_number || ''),
                buildMonitoringOccurrenceSummary(profile.type, publication),
                JSON.stringify(detail),
                match.score,
                semanticScore,
                legalScore,
                finalScore,
                priority
            );
            createdOccurrences += 1;
        }
    }

    await prisma.$executeRawUnsafe(
        `insert into monitoring_rpi_runs (id, rpi_number, run_mode, total_publications, matched_occurrences, status, created_at)
         values ($1, $2, 'manual', $3, $4, 'completed', now())`,
        runId,
        rpiNumber,
        publications.length,
        createdOccurrences
    );
    return { runId, rpiNumber, totalPublications: publications.length, createdOccurrences };
});

fastify.post('/monitoring/center/rpi/process-latest', async () => {
    await ensureBusinessTables();
    const latest = await prisma.$queryRawUnsafe<any[]>(
        `select rpi from inpi_publication where rpi is not null order by created_at desc limit 1`
    ).catch(() => []);
    const rpiNumber = cleanTextValue(latest?.[0]?.rpi);
    if (!rpiNumber) {
        return { runId: null, rpiNumber: null, totalPublications: 0, createdOccurrences: 0 };
    }
    const profiles = await prisma.$queryRawUnsafe<any[]>(
        `select * from monitoring_profiles where status='active' order by updated_at desc limit 1000`
    ).catch(() => []);
    if (profiles.length === 0) return { runId: null, rpiNumber, totalPublications: 0, createdOccurrences: 0 };

    const publications = await prisma.$queryRawUnsafe<any[]>(
        `select id, patent_number, rpi, date, despacho_code, despacho_desc, complement, ops_title, ops_applicant, ops_inventor, ops_ipc
         from inpi_publication
         where rpi=$1
         order by created_at desc
         limit 6000`,
        rpiNumber
    ).catch(() => []);
    const runId = randomUUID();
    let createdOccurrences = 0;
    for (const publication of publications) {
        for (const profile of profiles) {
            const match = computeRuleScore(profile, publication);
            if (!match.matched) continue;
            const minAlert = Number(profile.score_min_alert || 55);
            if (match.score < minAlert) continue;
            const semanticScore = Math.max(0, Math.min(100, Math.round(match.score * 0.9)));
            const legalScore = profile.type === 'process' ? Math.max(0, Math.min(100, match.score + 10)) : Math.max(0, Math.min(100, Math.round(match.score * 0.8)));
            const finalScore = Math.max(0, Math.min(100, Math.round((match.score * 0.45) + (semanticScore * 0.35) + (legalScore * 0.20))));
            const priority = scoreToPriority(finalScore);
            const eventType = profile.type === 'process'
                ? `process_dispatch_${cleanTextValue(publication?.despacho_code || '').replace(/\s+/g, '') || 'general'}`
                : profile.type === 'collision'
                    ? 'collision_candidate'
                    : profile.type === 'market'
                        ? 'market_signal'
                        : 'asset_update';
            const detail = {
                publication,
                profileName: profile.name,
                matchingRules: parseJsonObject(profile.rules, {}),
                layers: {
                    bibliographicAvailable: Boolean(cleanTextValue(publication?.ops_title) || cleanTextValue(publication?.complement)),
                    claimsAvailable: false
                },
                scoreBreakdown: {
                    rule: match.score,
                    semantic: semanticScore,
                    legal: legalScore,
                    final: finalScore
                }
            };
            await prisma.$executeRawUnsafe(
                `insert into monitoring_occurrences (
                    id, profile_id, monitoring_type, client_id, patent_number, rpi_number, publication_id, event_type,
                    origin_source, title, summary, detail, rule_score, semantic_score, legal_score, final_score,
                    priority, status, ia_status, client_feedback_status, created_at, updated_at
                ) values (
                    $1,$2,$3,$4,$5,$6,$7,$8,
                    'rpi',$9,$10,$11::jsonb,$12,$13,$14,$15,
                    $16,'pending_triage','not_requested','pending_send',now(),now()
                )
                on conflict do nothing`,
                randomUUID(),
                profile.id,
                profile.type,
                profile.client_id || null,
                publication.patent_number || null,
                publication.rpi || null,
                publication.id || null,
                eventType,
                cleanTextValue(publication?.ops_title || publication?.despacho_desc || publication?.patent_number || ''),
                buildMonitoringOccurrenceSummary(profile.type, publication),
                JSON.stringify(detail),
                match.score,
                semanticScore,
                legalScore,
                finalScore,
                priority
            );
            createdOccurrences += 1;
        }
    }
    await prisma.$executeRawUnsafe(
        `insert into monitoring_rpi_runs (id, rpi_number, run_mode, total_publications, matched_occurrences, status, created_at)
         values ($1, $2, 'latest', $3, $4, 'completed', now())`,
        runId,
        rpiNumber,
        publications.length,
        createdOccurrences
    );
    return { runId, rpiNumber, totalPublications: publications.length, createdOccurrences };
});

fastify.get('/monitoring/center/occurrences', async (request: any) => {
    await ensureBusinessTables();
    const query = request.query || {};
    const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(query.pageSize || '30'), 10) || 30));
    const offset = (page - 1) * pageSize;
    const values: any[] = [];
    const conditions: string[] = [];
    const push = (value: any) => {
        values.push(value);
        return `$${values.length}`;
    };
    if (query.type) conditions.push(`o.monitoring_type = ${push(cleanTextValue(query.type).toLowerCase())}`);
    if (query.status) conditions.push(`o.status = ${push(cleanTextValue(query.status).toLowerCase())}`);
    if (query.priority) conditions.push(`o.priority = ${push(cleanTextValue(query.priority).toLowerCase())}`);
    if (query.clientId) conditions.push(`o.client_id = ${push(cleanTextValue(query.clientId))}`);
    if (query.owner) conditions.push(`coalesce(p.owner_name,'') ilike ${push(`%${cleanTextValue(query.owner)}%`)}`);
    if (query.withIa === 'true') conditions.push(`o.ia_status in ('completed','partial')`);
    if (query.waitingClientFeedback === 'true') conditions.push(`o.client_feedback_status in ('sent','requested_revision')`);
    if (query.q) {
        const token = `%${cleanTextValue(query.q)}%`;
        conditions.push(`(coalesce(o.title,'') ilike ${push(token)} or coalesce(o.summary,'') ilike ${push(token)} or coalesce(o.patent_number,'') ilike ${push(token)} or coalesce(c.name,'') ilike ${push(token)} or coalesce(p.name,'') ilike ${push(token)})`);
    }
    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const totalRows = await prisma.$queryRawUnsafe<any[]>(
        `select count(*)::int as total
         from monitoring_occurrences o
         left join monitoring_profiles p on p.id=o.profile_id
         left join "Client" c on c.id=o.client_id
         ${whereClause}`,
        ...values
    ).catch(() => [{ total: 0 }]);
    const total = Number(totalRows?.[0]?.total || 0);
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select
            o.*,
            p.name as monitoring_name,
            p.owner_name as monitoring_owner,
            p.attorney_name as monitoring_attorney,
            p.sensitivity as monitoring_sensitivity,
            p.asset_patent_number as reference_patent_number,
            c.name as client_name
         from monitoring_occurrences o
         left join monitoring_profiles p on p.id=o.profile_id
         left join "Client" c on c.id=o.client_id
         ${whereClause}
         order by o.created_at desc
         limit ${push(pageSize)} offset ${push(offset)}`,
        ...values
    ).catch(() => []);
    return {
        rows: rows.map((row: any) => ({
            ...row,
            detail: parseJsonObject(row.detail, {}),
            ia_payload: parseJsonObject(row.ia_payload, {})
        })),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
});

fastify.post('/monitoring/center/occurrences/:id/analyze-ai', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const { id } = request.params as { id: string };
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select o.*, p.name as monitoring_name, p.type as monitoring_type, p.rules, p.asset_title, p.asset_patent_number
         from monitoring_occurrences o
         join monitoring_profiles p on p.id=o.profile_id
         where o.id=$1
         limit 1`,
        id
    ).catch(() => []);
    const occurrence = rows?.[0];
    if (!occurrence) return reply.code(404).send({ error: 'Ocorrência não encontrada' });
    if (!GROQ_API_KEY) return reply.code(503).send({ error: 'Groq Cloud não configurado' });

    const detail = parseJsonObject(occurrence.detail, {});
    const profileType = normalizeMonitoringType(occurrence.monitoring_type);
    const promptPayload = {
        monitoringType: profileType,
        monitoringName: occurrence.monitoring_name,
        referencePatent: occurrence.asset_patent_number || occurrence.patent_number,
        referenceTitle: occurrence.asset_title || '',
        candidateTitle: occurrence.title || '',
        candidateSummary: occurrence.summary || '',
        eventType: occurrence.event_type,
        eventDetail: detail
    };
    let prompt = '';
    if (profileType === 'collision') {
        prompt = `Analise a colidência de patentes com base no JSON abaixo e retorne JSON válido com: relevance_score_0_100, novelty_overlap_score_0_100, claims_overlap_score_0_100, confidence_level, reasoning_summary, key_matching_terms, key_differentiators, recommended_action.\nJSON:\n${JSON.stringify(promptPayload)}`;
    } else if (profileType === 'process') {
        prompt = `Analise o evento processual e retorne JSON válido com: event_summary, urgency_score, recommended_internal_action, recommended_client_action, plain_language_explanation.\nJSON:\n${JSON.stringify(promptPayload)}`;
    } else if (profileType === 'market') {
        prompt = `Analise o sinal de mercado e retorne JSON válido com: market_signal_type, importance_score, cluster_summary, emerging_entities, why_it_matters, recommended_followup.\nJSON:\n${JSON.stringify(promptPayload)}`;
    } else {
        prompt = `Analise atualização de ativo e retorne JSON válido com: relevance_score_0_100, confidence_level, reasoning_summary, recommended_action.\nJSON:\n${JSON.stringify(promptPayload)}`;
    }
    try {
        const raw = await generateWithGemini(prompt, true);
        const parsed = parseModelJsonResponse(raw);
        const relevance = clampScore(
            parsed?.relevance_score_0_100
            ?? parsed?.importance_score
            ?? parsed?.urgency_score
            ?? occurrence.final_score,
            Number(occurrence.final_score || 0)
        );
        const semantic = clampScore(
            parsed?.novelty_overlap_score_0_100
            ?? parsed?.importance_score
            ?? occurrence.semantic_score,
            Number(occurrence.semantic_score || 0)
        );
        const legal = clampScore(
            parsed?.claims_overlap_score_0_100
            ?? parsed?.urgency_score
            ?? occurrence.legal_score,
            Number(occurrence.legal_score || 0)
        );
        const finalScore = clampScore(Math.round((Number(occurrence.rule_score || 0) * 0.40) + (semantic * 0.35) + (legal * 0.25)), Number(occurrence.final_score || 0));
        const priority = scoreToPriority(finalScore);
        await prisma.$executeRawUnsafe(
            `update monitoring_occurrences
             set
                semantic_score=$2,
                legal_score=$3,
                final_score=$4,
                priority=$5,
                ia_status='completed',
                ia_payload=$6::jsonb,
                updated_at=now()
             where id=$1`,
            id,
            semantic,
            legal,
            finalScore,
            priority,
            JSON.stringify(parsed || {})
        );
        return { id, ia: parsed, finalScore, priority };
    } catch (error: any) {
        await prisma.$executeRawUnsafe(
            `update monitoring_occurrences set ia_status='error', ia_payload=$2::jsonb, updated_at=now() where id=$1`,
            id,
            JSON.stringify({ error: error?.message || 'Falha na análise IA' })
        ).catch(() => undefined);
        return reply.code(500).send({ error: error?.message || 'Falha ao executar análise IA' });
    }
});

fastify.post('/monitoring/center/occurrences/:id/action', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const { id } = request.params as { id: string };
    const action = cleanTextValue(request.body?.action).toLowerCase();
    const note = cleanTextValue(request.body?.note);
    const assignee = cleanTextValue(request.body?.assignee);
    const feedback = cleanTextValue(request.body?.feedback);
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select o.*, p.name as monitoring_name, c.name as client_name
         from monitoring_occurrences o
         left join monitoring_profiles p on p.id=o.profile_id
         left join "Client" c on c.id=o.client_id
         where o.id=$1
         limit 1`,
        id
    ).catch(() => []);
    const occurrence = rows?.[0];
    if (!occurrence) return reply.code(404).send({ error: 'Ocorrência não encontrada' });

    if (action === 'create_demand') {
        await ensureBusinessTables();
        const demandId = randomUUID();
        const priorityMap: Record<string, string> = { critical: 'critica', high: 'alta', medium: 'media', low: 'baixa' };
        const recipient = await resolveClientRecipient(occurrence.client_id || null, occurrence.event_type, cleanTextValue(request.body?.contactId));
        await prisma.$executeRawUnsafe(
            `insert into crm_demands (
                id, client_id, contact_id, monitoring_origin, monitoring_type, occurrence_id, item_related, ai_summary,
                title, description, status, priority, due_date, owner_name, patent_number, metadata, created_at, updated_at
             ) values (
                $1,$2,$3,'monitoring',$4,$5,$6,$7,
                $8,$9,'nova',$10,$11,$12,$13,$14::jsonb,now(),now()
             )`,
            demandId,
            occurrence.client_id || null,
            recipient?.id || null,
            occurrence.monitoring_type || null,
            occurrence.id,
            occurrence.event_type || null,
            cleanTextValue(parseJsonObject(occurrence.ia_payload, {})?.reasoning_summary || occurrence.summary),
            `[Monitoramento] ${occurrence.monitoring_name || occurrence.event_type}`,
            `${occurrence.summary || ''}\n\nOcorrência: ${occurrence.id}\nOrigem: ${occurrence.monitoring_type}\nPrioridade sugerida: ${occurrence.priority}\n${note || ''}`.trim(),
            priorityMap[String(occurrence.priority || 'medium')] || 'media',
            null,
            assignee || occurrence.assigned_to || null,
            occurrence.patent_number || null,
            JSON.stringify({ finalScore: occurrence.final_score, ia: parseJsonObject(occurrence.ia_payload, {}) })
        );
        await prisma.$executeRawUnsafe(
            `insert into crm_demand_history (id, demand_id, action, old_value, new_value, created_by, created_at)
             values ($1,$2,'created',null,'nova',null,now())`,
            randomUUID(),
            demandId
        ).catch(() => undefined);
        await prisma.$executeRawUnsafe(
            `update monitoring_occurrences
             set crm_demand_id=$2, status='converted_to_demand', reviewed_at=now(), updated_at=now()
             where id=$1`,
            id,
            demandId
        );
        return { id, status: 'converted_to_demand', crmDemandId: demandId };
    }

    if (action === 'send_client') {
        const recipient = await resolveClientRecipient(occurrence.client_id || null, occurrence.event_type, cleanTextValue(request.body?.contactId));
        if (!recipient?.email) return reply.code(400).send({ error: 'Nenhum contato válido para envio' });
        const systemRows = await prisma.$queryRawUnsafe<any[]>(
            `select key, value from system_settings where key in ('templates')`
        ).catch(() => []);
        const templates = parseJsonObject(systemRows.find((item: any) => item.key === 'templates')?.value, {});
        const templateKey = occurrence.monitoring_type === 'process' ? 'process' : occurrence.monitoring_type === 'collision' ? 'collision' : 'market';
        const fallbackBody = `Cliente: ${occurrence.client_name || '-'}\nMonitoramento: ${occurrence.monitoring_name || '-'}\nOcorrência: ${occurrence.event_type}\nResumo: ${occurrence.summary || '-'}\nPrioridade: ${occurrence.priority}\n`;
        const renderedBody = cleanTextValue(templates?.[templateKey]) || fallbackBody;
        const subject = `[Patent Scope] ${occurrence.monitoring_type} • ${occurrence.priority?.toUpperCase() || 'INFO'} • ${occurrence.event_type}`;
        await prisma.$executeRawUnsafe(
            `insert into email_delivery_logs (
                id, client_id, demand_id, occurrence_id, recipient_email, recipient_name, template_key, subject, body, status, error, created_at
             ) values (
                $1,$2,null,$3,$4,$5,$6,$7,$8,'queued',null,now()
             )`,
            randomUUID(),
            occurrence.client_id || null,
            occurrence.id,
            recipient.email,
            recipient.name || null,
            templateKey,
            subject,
            renderedBody
        ).catch(() => undefined);
        await prisma.$executeRawUnsafe(
            `update monitoring_occurrences
             set client_feedback_status='sent', sent_to_client_at=now(), status='awaiting_client_feedback', updated_at=now()
             where id=$1`,
            id
        );
        return { id, status: 'awaiting_client_feedback', recipient: { id: recipient.id, email: recipient.email, name: recipient.name } };
    }

    if (action === 'feedback') {
        const normalized = ['interesting', 'not_interesting', 'requested_revision', 'closed'].includes(feedback) ? feedback : 'requested_revision';
        await prisma.$executeRawUnsafe(
            `update monitoring_occurrences
             set client_feedback_status=$2, client_feedback_note=nullif($3,''), status=case when $2='closed' then 'closed' else status end, updated_at=now()
             where id=$1`,
            id,
            normalized,
            note
        );
        const feedbackId = randomUUID();
        await prisma.$executeRawUnsafe(
            `insert into monitoring_occurrence_feedback (id, occurrence_id, source, feedback, note, created_by, created_at)
             values ($1,$2,'client',$3,nullif($4,''),nullif($5,''),now())`,
            feedbackId,
            id,
            normalized,
            note,
            assignee
        );
        return { id, clientFeedbackStatus: normalized };
    }

    const statusMap: Record<string, string> = {
        mark_relevant: 'relevant',
        mark_irrelevant: 'discarded',
        defer: 'snoozed',
        review: 'in_review',
        close: 'closed'
    };
    const nextStatus = statusMap[action];
    if (!nextStatus) return reply.code(400).send({ error: 'Ação inválida' });

    await prisma.$executeRawUnsafe(
        `update monitoring_occurrences
         set status=$2, assigned_to=case when nullif($3,'') is null then assigned_to else $3 end, reviewed_at=now(), updated_at=now()
         where id=$1`,
        id,
        nextStatus,
        assignee
    );
    if (note || assignee) {
        const feedbackId = randomUUID();
        await prisma.$executeRawUnsafe(
            `insert into monitoring_occurrence_feedback (id, occurrence_id, source, feedback, note, created_by, created_at)
             values ($1,$2,'internal',$3,nullif($4,''),nullif($5,''),now())`,
            feedbackId,
            id,
            nextStatus,
            note,
            assignee
        ).catch(() => undefined);
    }
    return { id, status: nextStatus };
});

fastify.get('/monitoring/center/occurrences/:id/email-preview', async (request: any, reply: any) => {
    await ensureBusinessTables();
    const { id } = request.params as { id: string };
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select o.*, p.name as monitoring_name, c.name as client_name
         from monitoring_occurrences o
         left join monitoring_profiles p on p.id=o.profile_id
         left join "Client" c on c.id=o.client_id
         where o.id=$1
         limit 1`,
        id
    ).catch(() => []);
    const occurrence = rows?.[0];
    if (!occurrence) return reply.code(404).send({ error: 'Ocorrência não encontrada' });
    const recipient = await resolveClientRecipient(occurrence.client_id || null, occurrence.event_type);
    if (!recipient?.email) return reply.code(400).send({ error: 'Nenhum contato encontrado para o cliente' });
    const templatesRows = await prisma.$queryRawUnsafe<any[]>(
        `select value from system_settings where key='templates' limit 1`
    ).catch(() => []);
    const templates = parseJsonObject(templatesRows?.[0]?.value, {});
    const templateKey = occurrence.monitoring_type === 'process' ? 'process' : occurrence.monitoring_type === 'collision' ? 'collision' : 'market';
    const fallbackBody = `Cliente: ${occurrence.client_name || '-'}\nMonitoramento: ${occurrence.monitoring_name || '-'}\nOcorrência: ${occurrence.event_type}\nResumo: ${occurrence.summary || '-'}\nPrioridade: ${occurrence.priority}\n`;
    const body = cleanTextValue(templates?.[templateKey]) || fallbackBody;
    const subject = `[Patent Scope] ${occurrence.monitoring_type} • ${occurrence.priority?.toUpperCase() || 'INFO'} • ${occurrence.event_type}`;
    return {
        occurrenceId: id,
        recipient: { id: recipient.id, name: recipient.name, email: recipient.email, roleArea: recipient.role_area },
        templateKey,
        subject,
        body
    };
});

fastify.get('/settings/system', async () => {
    await ensureBusinessTables();
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select key, value, updated_at from system_settings where key in ('smtp','templates','workflows','integrations')`
    ).catch(() => []);
    const byKey = new Map<string, any>(rows.map((row: any) => [row.key, row.value] as [string, any]));
    return {
        smtp: byKey.get('smtp') || {
            host: '',
            port: '587',
            username: '',
            password: '',
            senderName: ''
        },
        templates: byKey.get('templates') || {
            collision: '',
            process: ''
        },
        workflows: byKey.get('workflows') || {
            statuses: ['nova', 'triagem', 'andamento', 'cliente', 'concluida'],
            collisionSlaDays: 7,
            processSlaDays: 5,
            autoCreateDemandsFromCriticalAlerts: true
        },
        integrations: byKey.get('integrations') || {
            inpiMode: INPI_MODE,
            epoOpsEnabled: Boolean(OPS_CONSUMER_KEY),
            groqEnabled: Boolean(GROQ_API_KEY),
            groqModel: 'llama-3.1-70b-versatile',
            webhookUrl: ''
        }
    };
});

fastify.put('/settings/system', async (request: any, reply) => {
    await ensureBusinessTables();
    const smtp = request.body?.smtp || {};
    const templates = request.body?.templates || {};
    const workflows = request.body?.workflows || {};
    const integrations = request.body?.integrations || {};
    const entries: Array<{ key: string; value: any }> = [
        { key: 'smtp', value: smtp },
        { key: 'templates', value: templates },
        { key: 'workflows', value: workflows },
        { key: 'integrations', value: integrations }
    ];
    for (const entry of entries) {
        await prisma.$executeRawUnsafe(
            `insert into system_settings (key, value, updated_at)
             values ($1, $2::jsonb, now())
             on conflict (key) do update set value=excluded.value, updated_at=now()`,
            entry.key,
            JSON.stringify(entry.value || {})
        );
    }
    return reply.code(204).send();
});

fastify.get('/emails/logs', async (request: any) => {
    await ensureBusinessTables();
    const page = Math.max(1, parseInt(String(request.query?.page || '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(request.query?.pageSize || '30'), 10) || 30));
    const offset = (page - 1) * pageSize;
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select e.*, c.name as client_name
         from email_delivery_logs e
         left join "Client" c on c.id=e.client_id
         order by e.created_at desc
         limit $1 offset $2`,
        pageSize,
        offset
    ).catch(() => []);
    const totalRows = await prisma.$queryRawUnsafe<any[]>(
        `select count(*)::int as total from email_delivery_logs`
    ).catch(() => [{ total: 0 }]);
    return {
        rows,
        total: Number(totalRows?.[0]?.total || 0),
        page,
        pageSize
    };
});

fastify.get('/monitoring/alerts', async (request: any) => {
    await ensureMonitoringTables();
    const { page = 1, pageSize = 30, unreadOnly, severity, despachoCode, fromDate, toDate } = request.query as any;
    const currentPage = Math.max(1, parseInt(String(page || '1'), 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(String(pageSize || '30'), 10) || 30));
    const offset = (currentPage - 1) * size;
    const onlyUnread = String(unreadOnly || '').toLowerCase() === 'true';
    const severityValue = String(severity || '').trim().toLowerCase();
    const despachoValue = String(despachoCode || '').trim();
    const fromValue = String(fromDate || '').trim();
    const toValue = String(toDate || '').trim();
    const totalRows = await prisma.$queryRawUnsafe<any[]>(
        `select count(*)::int as total
         from monitoring_alerts
         where (($1::boolean is false) or is_read=false)
           and ($2::text = '' or lower(severity)=lower($2))
           and ($3::text = '' or coalesce(despacho_code, '') = $3)
           and ($4::text = '' or rpi_date >= $4::date)
           and ($5::text = '' or rpi_date <= $5::date)`,
        onlyUnread,
        severityValue,
        despachoValue,
        fromValue,
        toValue
    ).catch(() => [{ total: 0 }]);
    const total = Number(totalRows?.[0]?.total || 0);
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select id, monitored_patent_id, patent_number, rpi_number, rpi_date, despacho_code, title, complement, severity, deadline, is_read, created_at, updated_at
         from monitoring_alerts
         where (($1::boolean is false) or is_read=false)
           and ($2::text = '' or lower(severity)=lower($2))
           and ($3::text = '' or coalesce(despacho_code, '') = $3)
           and ($4::text = '' or rpi_date >= $4::date)
           and ($5::text = '' or rpi_date <= $5::date)
         order by rpi_date desc, created_at desc
         limit $6 offset $7`,
        onlyUnread,
        severityValue,
        despachoValue,
        fromValue,
        toValue,
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

fastify.post('/monitoring/alerts/read-bulk', async (request: any, reply) => {
    await ensureMonitoringTables();
    const ids = Array.isArray(request.body?.ids) ? request.body.ids.map((item: any) => String(item || '').trim()).filter(Boolean) : [];
    if (ids.length === 0) return reply.code(400).send({ error: 'Informe ids para atualização em lote.' });
    const updated = await prisma.$executeRawUnsafe(
        `update monitoring_alerts
         set is_read=true, updated_at=now()
         where id = any($1::uuid[])`,
        ids
    ).catch(() => 0);
    return { updated: Number(updated || 0) };
});

fastify.post('/monitoring/collision/explain', async (request: any, reply) => {
    await ensureMonitoringTables();
    const patentNumber = String(request.body?.patentNumber || '').trim();
    const title = String(request.body?.title || '').trim();
    const applicant = String(request.body?.applicant || '').trim();
    const inventors = String(request.body?.inventors || '').trim();
    const ipcCodes = String(request.body?.ipcCodes || '').trim();
    const lastEvent = String(request.body?.lastEvent || '').trim();

    if (!patentNumber) {
        return reply.code(400).send({ error: 'patentNumber é obrigatório' });
    }
    if (!GROQ_API_KEY) {
        return reply.code(503).send({ error: 'Groq Cloud não está configurado no backend.' });
    }

    const relatedAlerts = await prisma.$queryRawUnsafe<any[]>(
        `select rpi_number, rpi_date, despacho_code, title, complement, severity, deadline
         from monitoring_alerts
         where patent_number = $1
         order by rpi_date desc, created_at desc
         limit 6`,
        patentNumber
    ).catch(() => []);

    const alertsText = relatedAlerts.length
        ? relatedAlerts.map((alert, index) =>
            `${index + 1}) RPI ${alert.rpi_number || '-'} | despacho ${alert.despacho_code || '-'} | severidade ${alert.severity || '-'} | título ${(alert.title || '').substring(0, 180)} | complemento ${(alert.complement || '').substring(0, 220)}`
        ).join('\n')
        : 'Sem alertas históricos registrados para esta patente monitorada.';

    const contextText = [
        `PATENTE_MONITORADA: ${patentNumber}`,
        `TITULO: ${title || '-'}`,
        `TITULAR: ${applicant || '-'}`,
        `INVENTORES: ${inventors || '-'}`,
        `IPC: ${ipcCodes || '-'}`,
        `ULTIMO_EVENTO: ${lastEvent || '-'}`,
        `ALERTAS_RECENTES:\n${alertsText}`
    ].join('\n');
    const contextHash = createHash('sha256').update(contextText).digest('hex');

    const cached = await prisma.$queryRawUnsafe<any[]>(
        `select risk_level, summary, key_points, collision_focus, recommendation, raw_payload, updated_at
         from monitoring_collision_ai_briefs
         where patent_number=$1 and context_hash=$2
         limit 1`,
        patentNumber,
        contextHash
    ).catch(() => []);
    if (cached?.[0]) {
        const payload = cached[0].raw_payload || {};
        return {
            patentNumber,
            resumoExecutivo: cached[0].summary,
            nivelRisco: cached[0].risk_level,
            pontosChave: Array.isArray(cached[0].key_points) ? cached[0].key_points : [],
            oQueEstaColidindo: cached[0].collision_focus || '',
            acaoRecomendada: cached[0].recommendation || '',
            camadaA: Number(payload?.camadaA || 0),
            camadaB: Number(payload?.camadaB || 0),
            scoreFinal: Number(payload?.scoreFinal || 0),
            confianca: Number(payload?.confianca || 0),
            analyzedAt: cached[0].updated_at,
            cached: true
        };
    }

    const prompt = `Você é um analista sênior de PI no Brasil. Gere uma explicação curta, clara e acionável para evitar leitura manual de todos os eventos.

CONTEXTO:
${contextText}

REGRAS:
- Responda em português do Brasil.
- Seja objetivo e sem juridiquês desnecessário.
- Foque em onde pode haver choque com terceiros e por quê.
- Se dados forem insuficientes, diga explicitamente.
- Não invente fatos não presentes no contexto.

Retorne APENAS JSON válido no formato:
{
  "resumoExecutivo": "texto curto em 2-4 frases",
  "nivelRisco": "baixo|medio|alto|critico",
  "camadaA": 0-100,
  "camadaB": 0-100,
  "scoreFinal": 0-100,
  "confianca": 0-100,
  "pontosChave": ["ponto 1","ponto 2","ponto 3"],
  "oQueEstaColidindo": "quais elementos parecem colidir",
  "acaoRecomendada": "ação prática imediata para o analista"
}`;

    let parsed: any;
    try {
        const raw = await generateWithGemini(prompt, true, 'Você é especialista em análise de colidência de patentes para tomada de decisão operacional. Sempre responda JSON válido e conciso.');
        parsed = parseModelJsonResponse(raw);
    } catch (error: any) {
        request.log.error({ error }, 'Falha ao gerar explicação de colidência com Groq');
        return reply.code(502).send({ error: 'Falha ao gerar explicação com IA no momento.' });
    }

    const normalizedRisk = ['baixo', 'medio', 'alto', 'critico'].includes(String(parsed?.nivelRisco || '').toLowerCase())
        ? String(parsed.nivelRisco).toLowerCase()
        : 'medio';
    const summary = String(parsed?.resumoExecutivo || '').trim() || 'Sem resumo disponível.';
    const points = Array.isArray(parsed?.pontosChave) ? parsed.pontosChave.map((item: any) => String(item)).filter(Boolean).slice(0, 6) : [];
    const collisionFocus = String(parsed?.oQueEstaColidindo || '').trim();
    const recommendation = String(parsed?.acaoRecomendada || '').trim();
    const camadaA = Math.max(0, Math.min(100, Number(parsed?.camadaA || 0) || 0));
    const camadaB = Math.max(0, Math.min(100, Number(parsed?.camadaB || 0) || 0));
    const scoreFinal = Math.max(0, Math.min(100, Number(parsed?.scoreFinal || Math.round((camadaA * 0.45) + (camadaB * 0.55))) || 0));
    const confianca = Math.max(0, Math.min(100, Number(parsed?.confianca || 0) || 0));
    const rawPayload = {
        ...parsed,
        camadaA,
        camadaB,
        scoreFinal,
        confianca
    };

    await prisma.$executeRawUnsafe(
        `insert into monitoring_collision_ai_briefs
         (id, patent_number, context_hash, risk_level, summary, key_points, collision_focus, recommendation, raw_payload, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,now(),now())
         on conflict (patent_number, context_hash)
         do update set risk_level=excluded.risk_level, summary=excluded.summary, key_points=excluded.key_points, collision_focus=excluded.collision_focus, recommendation=excluded.recommendation, raw_payload=excluded.raw_payload, updated_at=now()`,
        randomUUID(),
        patentNumber,
        contextHash,
        normalizedRisk,
        summary,
        JSON.stringify(points),
        collisionFocus || null,
        recommendation || null,
        JSON.stringify(rawPayload)
    ).catch((error) => {
        request.log.warn({ error }, 'Falha ao persistir brief de colidência IA');
    });

    return {
        patentNumber,
        resumoExecutivo: summary,
        nivelRisco: normalizedRisk,
        pontosChave: points,
        oQueEstaColidindo: collisionFocus,
        acaoRecomendada: recommendation,
        camadaA,
        camadaB,
        scoreFinal,
        confianca,
        analyzedAt: new Date().toISOString(),
        cached: false
    };
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
