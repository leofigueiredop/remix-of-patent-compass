import { randomUUID } from 'crypto';
import { prisma } from '../db';

const COLLISION_DISPATCH_CODES = ['3.1', '1.3', '16.1'];
const MAX_COLLISION_JOB_ATTEMPTS = Math.max(2, parseInt(process.env.MAX_COLLISION_JOB_ATTEMPTS || '4', 10));
const COLLISION_SEMANTIC_MIN_SCORE = Math.max(1, Math.min(100, parseInt(process.env.COLLISION_SEMANTIC_MIN_SCORE || '34', 10)));
const COLLISION_TOP_K_PER_PUBLICATION = Math.max(1, Math.min(40, parseInt(process.env.COLLISION_TOP_K_PER_PUBLICATION || '8', 10)));

let collisionLoopStarted = false;
let collisionRunning = false;
let collisionPaused = false;

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

function normalizeDispatchCode(value: any): string {
    return cleanTextValue(value).replace(/\s+/g, '');
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

function scoreToPriority(score: number): 'critical' | 'high' | 'medium' | 'low' {
    if (score >= 86) return 'critical';
    if (score >= 70) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
}

const COLLISION_STOPWORDS = new Set([
    'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos',
    'para', 'por', 'com', 'sem', 'que', 'um', 'uma', 'uns', 'umas', 'ao', 'aos', 'ou', 'se',
    'como', 'entre', 'sobre', 'sob', 'até', 'apos', 'apos', 'mais', 'menos', 'ja', 'foi',
    'ser', 'sao', 'sua', 'seu', 'suas', 'seus', 'esta', 'este', 'essas', 'esses', 'isso', 'isto'
]);

function tokenizeForSemanticVector(value: any): string[] {
    const text = normalizeCompareValue(value)
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return [];
    return text
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !COLLISION_STOPWORDS.has(token))
        .slice(0, 3000);
}

function buildTokenWeights(tokens: string[]): Map<string, number> {
    const weights = new Map<string, number>();
    for (const token of tokens) {
        weights.set(token, (weights.get(token) || 0) + 1);
    }
    return weights;
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>): number {
    if (left.size === 0 || right.size === 0) return 0;
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (const value of left.values()) leftNorm += value * value;
    for (const value of right.values()) rightNorm += value * value;
    for (const [token, leftValue] of left.entries()) {
        const rightValue = right.get(token);
        if (rightValue) dot += leftValue * rightValue;
    }
    if (!dot || !leftNorm || !rightNorm) return 0;
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function extractProfileSemanticKeywords(profile: any): string[] {
    const rules = parseJsonObject(profile?.rules, {});
    const explicit = safeArrayString(rules?.semantic_keywords || []);
    if (explicit.length > 0) return explicit.map((item) => normalizeCompareValue(item)).filter(Boolean);
    const fallback = safeArrayString([
        ...(safeArrayString(rules?.keywords || [])),
        cleanTextValue(profile?.asset_title || ''),
        cleanTextValue(profile?.notes || ''),
        cleanTextValue(rules?.semantic_fingerprint || '')
    ]).join(' ');
    return tokenizeForSemanticVector(fallback).slice(0, 40);
}

function buildPublicationSemanticText(publication: any, patentText: string) {
    return [
        cleanTextValue(publication?.ops_title || ''),
        cleanTextValue(publication?.despacho_desc || ''),
        cleanTextValue(publication?.complement || ''),
        cleanTextValue(patentText || '')
    ].filter(Boolean).join(' ');
}

function computeCollisionIdeaScore(profile: any, profileVector: Map<string, number>, profileKeywords: string[], publication: any, publicationVector: Map<string, number>) {
    const cosine = cosineSimilarity(profileVector, publicationVector);
    const publicationNormalizedText = normalizeCompareValue([
        cleanTextValue(publication?.ops_title || ''),
        cleanTextValue(publication?.despacho_desc || ''),
        cleanTextValue(publication?.complement || '')
    ].join(' '));
    const keywordHits = profileKeywords.filter((keyword) => keyword && publicationNormalizedText.includes(keyword)).length;
    const keywordCoverage = profileKeywords.length > 0 ? Math.min(1, keywordHits / Math.max(1, Math.min(8, profileKeywords.length))) : 0;
    const semanticScore = Math.max(0, Math.min(100, Math.round(cosine * 100)));
    const keywordScore = Math.max(0, Math.min(100, Math.round(keywordCoverage * 100)));
    const profileSensitivityWeight = String(profile?.sensitivity || '').toLowerCase().includes('agress')
        ? 0.70
        : String(profile?.sensitivity || '').toLowerCase().includes('conserv')
            ? 0.85
            : 0.78;
    const finalIdeaCollisionScore = Math.max(0, Math.min(100, Math.round((semanticScore * profileSensitivityWeight) + (keywordScore * (1 - profileSensitivityWeight)))));
    return {
        matched: finalIdeaCollisionScore >= Number(profile?.score_min_alert || COLLISION_SEMANTIC_MIN_SCORE),
        semanticScore,
        keywordScore,
        finalIdeaCollisionScore,
        keywordHits
    };
}

async function ensureCollisionWorkerTables() {
    const statements = [
        `create table if not exists monitoring_collision_jobs (
            id text primary key,
            rpi_number text not null,
            status text not null default 'pending',
            attempts int not null default 0,
            dispatch_codes jsonb not null default '["3.1","1.3","16.1"]'::jsonb,
            triggered_by text null,
            result_data jsonb null,
            error text null,
            started_at timestamptz null,
            finished_at timestamptz null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )`,
        `create index if not exists idx_monitoring_collision_jobs_status on monitoring_collision_jobs(status, created_at)`,
        `create index if not exists idx_monitoring_collision_jobs_rpi on monitoring_collision_jobs(rpi_number, created_at)`,
        `create unique index if not exists idx_monitoring_occurrences_collision_manual_unique
         on monitoring_occurrences(profile_id, publication_id, event_type, rpi_number)
         where origin_source='collision_worker_manual'`
    ];
    for (const sql of statements) {
        await prisma.$executeRawUnsafe(sql);
    }
}

async function runCollisionJob(job: any) {
    const rpiNumber = cleanTextValue(job?.rpi_number);
    const dispatchCodesFromJob = safeArrayString(parseJsonArray(job?.dispatch_codes));
    const allowedDispatch = (dispatchCodesFromJob.length > 0 ? dispatchCodesFromJob : COLLISION_DISPATCH_CODES)
        .map((item) => normalizeDispatchCode(item))
        .filter(Boolean);
    const allowedDispatchSet = new Set(allowedDispatch);

    const profiles = await prisma.$queryRawUnsafe<any[]>(
        `select *
         from monitoring_profiles
         where status='active' and type='collision'
         order by updated_at desc
         limit 1500`
    ).catch(() => []);

    if (!rpiNumber || profiles.length === 0) {
        return {
            rpiNumber,
            allowedDispatchCodes: allowedDispatch,
            totalProfiles: profiles.length,
            totalPublications: 0,
            publicationsInScope: 0,
            createdOccurrences: 0,
            aiCandidates: 0
        };
    }

    const publications = await prisma.$queryRawUnsafe<any[]>(
        `select id, patent_number, rpi, date, despacho_code, despacho_desc, complement, ops_title, ops_applicant, ops_inventor, ops_ipc, ops_error
         from inpi_publication
         where rpi=$1
         order by created_at desc
         limit 8000`,
        rpiNumber
    ).catch(() => []);

    const publicationsInScope = publications.filter((item: any) => allowedDispatchSet.has(normalizeDispatchCode(item?.despacho_code)));
    const profilePatentKeys = Array.from(new Set(profiles
        .map((profile: any) => normalizePatentValue(profile?.asset_patent_number))
        .filter(Boolean)));
    const profilePatentRows = profilePatentKeys.length > 0
        ? await prisma.$queryRawUnsafe<any[]>(
            `select cod_pedido, numero_publicacao, title, abstract, resumo_detalhado, ipc_codes
             from inpi_patents
             where cod_pedido = any($1::text[]) or numero_publicacao = any($1::text[])`,
            profilePatentKeys
        ).catch(() => [])
        : [];
    const profilePatentTextByKey = new Map<string, string>();
    for (const row of profilePatentRows) {
        const corpus = [
            cleanTextValue(row?.title || ''),
            cleanTextValue(row?.abstract || ''),
            cleanTextValue(row?.resumo_detalhado || ''),
            cleanTextValue(row?.ipc_codes || '')
        ].filter(Boolean).join(' ');
        const keyA = normalizePatentValue(row?.cod_pedido);
        const keyB = normalizePatentValue(row?.numero_publicacao);
        if (keyA) profilePatentTextByKey.set(keyA, corpus);
        if (keyB) profilePatentTextByKey.set(keyB, corpus);
    }
    const publicationsPatentKeys = Array.from(new Set(publicationsInScope.map((item: any) => normalizePatentValue(item?.patent_number)).filter(Boolean)));
    const publicationPatentRows = publicationsPatentKeys.length > 0
        ? await prisma.$queryRawUnsafe<any[]>(
            `select cod_pedido, numero_publicacao, title, abstract, resumo_detalhado
             from inpi_patents
             where cod_pedido = any($1::text[]) or numero_publicacao = any($1::text[])`,
            publicationsPatentKeys
        ).catch(() => [])
        : [];
    const publicationPatentTextByKey = new Map<string, string>();
    for (const row of publicationPatentRows) {
        const corpus = [
            cleanTextValue(row?.title || ''),
            cleanTextValue(row?.abstract || ''),
            cleanTextValue(row?.resumo_detalhado || '')
        ].filter(Boolean).join(' ');
        const keyA = normalizePatentValue(row?.cod_pedido);
        const keyB = normalizePatentValue(row?.numero_publicacao);
        if (keyA) publicationPatentTextByKey.set(keyA, corpus);
        if (keyB) publicationPatentTextByKey.set(keyB, corpus);
    }
    const profilesPrepared = profiles.map((profile: any) => {
        const profileRules = parseJsonObject(profile?.rules, {});
        const profilePatentText = profilePatentTextByKey.get(normalizePatentValue(profile?.asset_patent_number)) || '';
        const profileSemanticCorpus = [
            cleanTextValue(profile?.asset_title || ''),
            cleanTextValue(profile?.notes || ''),
            cleanTextValue(profilePatentText || ''),
            safeArrayString(profileRules?.keywords || []).join(' '),
            safeArrayString(profileRules?.semantic_keywords || []).join(' '),
            cleanTextValue(profileRules?.semantic_fingerprint || '')
        ].filter(Boolean).join(' ');
        const profileTokens = tokenizeForSemanticVector(profileSemanticCorpus);
        return {
            profile,
            profileRules,
            profileKeywords: extractProfileSemanticKeywords(profile),
            profileCorpus: profileSemanticCorpus,
            profileVector: buildTokenWeights(profileTokens)
        };
    });
    let createdOccurrences = 0;
    let aiCandidates = 0;
    const createdOccurrenceIds: string[] = [];

    for (const publication of publicationsInScope) {
        const dispatchCode = normalizeDispatchCode(publication?.despacho_code);
        const eventType = `collision_candidate_dispatch_${dispatchCode.replace(/\./g, '_') || 'unknown'}`;
        const publicationPatentText = publicationPatentTextByKey.get(normalizePatentValue(publication?.patent_number)) || '';
        const publicationSemanticText = buildPublicationSemanticText(publication, publicationPatentText);
        const publicationVector = buildTokenWeights(tokenizeForSemanticVector(publicationSemanticText));
        const ranked = profilesPrepared
            .map((prepared) => {
                const score = computeCollisionIdeaScore(
                    prepared.profile,
                    prepared.profileVector,
                    prepared.profileKeywords,
                    publication,
                    publicationVector
                );
                return { ...prepared, score };
            })
            .filter((item) => item.score.matched && item.score.finalIdeaCollisionScore >= COLLISION_SEMANTIC_MIN_SCORE)
            .sort((a, b) => b.score.finalIdeaCollisionScore - a.score.finalIdeaCollisionScore)
            .slice(0, COLLISION_TOP_K_PER_PUBLICATION);
        aiCandidates += ranked.length;
        for (const candidate of ranked) {
            const profile = candidate.profile;
            const finalScore = candidate.score.finalIdeaCollisionScore;
            const ruleScore = candidate.score.keywordScore;
            const semanticScore = candidate.score.semanticScore;
            const legalScore = Math.max(0, Math.min(100, Math.round((semanticScore * 0.65) + (ruleScore * 0.35))));
            const priority = scoreToPriority(finalScore);
            const occurrenceId = randomUUID();
            const detail = {
                publication,
                profileName: profile.name,
                matchingRules: candidate.profileRules,
                semanticPrefilter: {
                    score: finalScore,
                    semanticScore,
                    keywordScore: ruleScore,
                    keywordHits: candidate.score.keywordHits,
                    minScore: COLLISION_SEMANTIC_MIN_SCORE,
                    topKPerPublication: COLLISION_TOP_K_PER_PUBLICATION,
                    profileCorpus: candidate.profileCorpus.slice(0, 1800),
                    publicationSemanticText: publicationSemanticText.slice(0, 1800)
                },
                worker: {
                    source: 'collision_worker_manual',
                    jobId: job?.id || null,
                    rpiNumber,
                    dispatchCodes: allowedDispatch
                },
                scoreBreakdown: {
                    rule: ruleScore,
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
                    $1,$2,'collision',$3,$4,$5,$6,$7,
                    'collision_worker_manual',$8,$9,$10::jsonb,$11,$12,$13,$14,
                    $15,'pending_triage','not_requested','pending_send',now(),now()
                )
                on conflict do nothing`,
                occurrenceId,
                profile.id,
                profile.client_id || null,
                publication.patent_number || null,
                publication.rpi || null,
                publication.id || null,
                eventType,
                cleanTextValue(publication?.ops_title || publication?.despacho_desc || publication?.patent_number || ''),
                `Candidato de colidência por conteúdo detectado na RPI ${rpiNumber} (despacho ${dispatchCode || '-'})`,
                JSON.stringify(detail),
                ruleScore,
                semanticScore,
                legalScore,
                finalScore,
                priority
            );
            createdOccurrences += 1;
            createdOccurrenceIds.push(occurrenceId);
        }
    }

    return {
        jobId: job?.id || null,
        rpiNumber,
        allowedDispatchCodes: allowedDispatch,
        totalProfiles: profiles.length,
        totalPublications: publications.length,
        publicationsInScope: publicationsInScope.length,
        createdOccurrences,
        aiCandidates,
        createdOccurrenceIds: createdOccurrenceIds.slice(0, 5000),
        strategy: {
            model: 'semantic_prefilter_v1',
            semanticMinScore: COLLISION_SEMANTIC_MIN_SCORE,
            topKPerPublication: COLLISION_TOP_K_PER_PUBLICATION
        }
    };
}

async function processNextCollisionJob() {
    if (collisionPaused || collisionRunning) return;
    collisionRunning = true;
    try {
        await ensureCollisionWorkerTables();
        let job = await prisma.$queryRawUnsafe<any[]>(
            `select *
             from monitoring_collision_jobs
             where status='pending'
             order by created_at asc
             limit 1`
        ).catch(() => []);
        let current = job?.[0];
        if (!current) {
            const failed = await prisma.$queryRawUnsafe<any[]>(
                `select *
                 from monitoring_collision_jobs
                 where status='failed' and attempts < $1
                 order by updated_at asc
                 limit 1`,
                MAX_COLLISION_JOB_ATTEMPTS
            ).catch(() => []);
            current = failed?.[0];
        }
        if (!current?.id) return;
        const nextAttempt = Number(current.attempts || 0) + 1;
        await prisma.$executeRawUnsafe(
            `update monitoring_collision_jobs
             set status='running', attempts=$2, error=null, started_at=now(), updated_at=now()
             where id=$1`,
            current.id,
            nextAttempt
        );
        try {
            const result = await runCollisionJob(current);
            await prisma.$executeRawUnsafe(
                `update monitoring_collision_jobs
                 set status='completed', result_data=$2::jsonb, finished_at=now(), updated_at=now()
                 where id=$1`,
                current.id,
                JSON.stringify(result)
            );
        } catch (error: any) {
            const message = cleanTextValue(error?.message || 'Falha ao processar job de colidência');
            await prisma.$executeRawUnsafe(
                `update monitoring_collision_jobs
                 set status=$2, error=$3, finished_at=now(), updated_at=now()
                 where id=$1`,
                current.id,
                nextAttempt >= MAX_COLLISION_JOB_ATTEMPTS ? 'failed_permanent' : 'failed',
                message.slice(0, 1800)
            );
        }
    } finally {
        collisionRunning = false;
    }
}

export async function enqueueCollisionMonitoringJob(rpiNumber: string, triggeredBy?: string) {
    await ensureCollisionWorkerTables();
    const normalizedRpi = cleanTextValue(rpiNumber);
    if (!normalizedRpi) {
        throw new Error('rpiNumber é obrigatório');
    }
    const existing = await prisma.$queryRawUnsafe<any[]>(
        `select id, rpi_number, status, attempts, dispatch_codes, triggered_by, result_data, error, started_at, finished_at, created_at, updated_at
         from monitoring_collision_jobs
         where rpi_number=$1 and status in ('pending','running')
         order by created_at desc
         limit 1`,
        normalizedRpi
    ).catch(() => []);
    if (existing?.[0]) {
        processNextCollisionJob().catch(() => undefined);
        return existing[0];
    }
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
        `insert into monitoring_collision_jobs
         (id, rpi_number, status, attempts, dispatch_codes, triggered_by, created_at, updated_at)
         values ($1,$2,'pending',0,$3::jsonb,$4,now(),now())`,
        id,
        normalizedRpi,
        JSON.stringify(COLLISION_DISPATCH_CODES),
        cleanTextValue(triggeredBy) || null
    );
    processNextCollisionJob().catch(() => undefined);
    const inserted = await prisma.$queryRawUnsafe<any[]>(
        `select id, rpi_number, status, attempts, dispatch_codes, triggered_by, result_data, error, started_at, finished_at, created_at, updated_at
         from monitoring_collision_jobs
         where id=$1
         limit 1`,
        id
    ).catch(() => []);
    return inserted?.[0] || { id, rpi_number: normalizedRpi, status: 'pending' };
}

export async function retryCollisionMonitoringJob(jobId: string) {
    await ensureCollisionWorkerTables();
    await prisma.$executeRawUnsafe(
        `update monitoring_collision_jobs
         set status='pending', error=null, started_at=null, finished_at=null, updated_at=now()
         where id=$1`,
        cleanTextValue(jobId)
    );
    processNextCollisionJob().catch(() => undefined);
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select id, rpi_number, status, attempts, dispatch_codes, triggered_by, result_data, error, started_at, finished_at, created_at, updated_at
         from monitoring_collision_jobs
         where id=$1
         limit 1`,
        cleanTextValue(jobId)
    ).catch(() => []);
    return rows?.[0] || null;
}

export async function listCollisionMonitoringJobs(limit = 50) {
    await ensureCollisionWorkerTables();
    const size = Math.max(1, Math.min(200, Number(limit) || 50));
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select id, rpi_number, status, attempts, dispatch_codes, triggered_by, result_data, error, started_at, finished_at, created_at, updated_at
         from monitoring_collision_jobs
         order by created_at desc
         limit $1`,
        size
    ).catch(() => []);
    return rows.map((row: any) => ({
        ...row,
        dispatch_codes: Array.isArray(row.dispatch_codes) ? row.dispatch_codes : (() => {
            try {
                const parsed = JSON.parse(String(row.dispatch_codes || '[]'));
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        })(),
        result_data: parseJsonObject(row.result_data, {})
    }));
}

export async function previewCollisionCandidatesForRpi(rpiNumber: string) {
    await ensureCollisionWorkerTables();
    const normalizedRpi = cleanTextValue(rpiNumber);
    if (!normalizedRpi) return { rpiNumber: normalizedRpi, totalPublications: 0, inScope: 0, byDispatchCode: [] };
    const rows = await prisma.$queryRawUnsafe<any[]>(
        `select despacho_code, count(*)::int as total
         from inpi_publication
         where rpi=$1
         group by despacho_code`,
        normalizedRpi
    ).catch(() => []);
    const byDispatchCode = rows.map((row: any) => ({
        despachoCode: normalizeDispatchCode(row.despacho_code || ''),
        total: Number(row.total || 0),
        inScope: COLLISION_DISPATCH_CODES.includes(normalizeDispatchCode(row.despacho_code || ''))
    }));
    return {
        rpiNumber: normalizedRpi,
        totalPublications: byDispatchCode.reduce((acc: number, item: any) => acc + Number(item.total || 0), 0),
        inScope: byDispatchCode.filter((item: any) => item.inScope).reduce((acc: number, item: any) => acc + Number(item.total || 0), 0),
        allowedDispatchCodes: COLLISION_DISPATCH_CODES,
        byDispatchCode
    };
}

export async function getCollisionMonitoringWorkerState() {
    await ensureCollisionWorkerTables();
    const counts = await prisma.$queryRawUnsafe<any[]>(
        `select status, count(*)::int as total
         from monitoring_collision_jobs
         group by status`
    ).catch(() => []);
    const countMap = new Map<string, number>();
    for (const row of counts) {
        countMap.set(String(row.status), Number(row.total || 0));
    }
    return {
        paused: collisionPaused,
        running: collisionRunning,
        allowedDispatchCodes: COLLISION_DISPATCH_CODES,
        counts: {
            pending: countMap.get('pending') || 0,
            running: countMap.get('running') || 0,
            completed: countMap.get('completed') || 0,
            failed: countMap.get('failed') || 0,
            failedPermanent: countMap.get('failed_permanent') || 0
        }
    };
}

export function setCollisionMonitoringWorkerPause(paused: boolean) {
    collisionPaused = paused;
    return {
        paused: collisionPaused,
        running: collisionRunning,
        allowedDispatchCodes: COLLISION_DISPATCH_CODES
    };
}

export async function startCollisionMonitoringWorker() {
    if (collisionLoopStarted) return;
    collisionLoopStarted = true;
    await ensureCollisionWorkerTables();
    processNextCollisionJob().catch(() => undefined);
    setInterval(() => {
        processNextCollisionJob().catch(() => undefined);
    }, 4000);
}
