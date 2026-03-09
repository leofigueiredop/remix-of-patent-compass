import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import FormData from 'form-data';
import * as cheerio from 'cheerio';
import bcrypt from 'bcryptjs';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import pdfParse from 'pdf-parse';

const execAsync = promisify(exec);

import { GoogleGenAI } from '@google/genai';

const fastify = Fastify({ logger: true });
const prisma = new PrismaClient();

fastify.register(cors, { origin: '*' });
fastify.register(multipart);
fastify.register(jwt, { secret: process.env.JWT_SECRET || 'patent-scope-secret-change-me' });

// ─── Environment ───────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const WHISPER_BASE_URL = process.env.WHISPER_BASE_URL || 'http://whisper:8000';
const OPS_CONSUMER_KEY = process.env.OPS_CONSUMER_KEY || '';
const OPS_CONSUMER_SECRET = process.env.OPS_CONSUMER_SECRET || '';
const INPI_MODE = process.env.INPI_MODE || 'scrape';

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
const inpiQueue = new AsyncQueue(1500); // 1.5s between calls

function isRetryableInpiNetworkError(message: string): boolean {
    const normalized = (message || '').toLowerCase();
    return normalized.includes('failed to connect')
        || normalized.includes('connection refused')
        || normalized.includes('timed out')
        || normalized.includes('empty reply')
        || normalized.includes('connection reset');
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

// Inicializa SDK do Gemini somente se configurado
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

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

// ─── Gemini Helper (fallback) ──────────────────────────────────
async function generateWithGeminiDirect(prompt: string, expectJson = true): Promise<string> {
    if (!ai) {
        throw new Error('Gemini não configurado no servidor.');
    }

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            temperature: 0.2,
            responseMimeType: expectJson ? "application/json" : "text/plain"
        }
    });

    if (!response.text) throw new Error("Gemini retornou uma resposta vazia.");
    return response.text;
}

// ─── Unified LLM Helper: Groq first, Gemini fallback ──────────
async function generateWithGemini(prompt: string, expectJson = true, customSystemMessage?: string): Promise<string> {
    if (GROQ_API_KEY) {
        try {
            return await generateWithGroq(prompt, expectJson, customSystemMessage);
        } catch (error: any) {
            if (ai) {
                fastify.log.warn(`Groq falhou, usando fallback Gemini: ${error.message}`);
            } else {
                fastify.log.warn(`Groq falhou e Gemini não está configurado: ${error.message}`);
            }
        }
    }
    if (!GROQ_API_KEY && !ai) {
        throw new Error('Nenhum provedor LLM configurado. Configure GROQ_API_KEY.');
    }
    return await generateWithGeminiDirect(prompt, expectJson);
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
        services: { groq: GROQ_API_KEY ? 'configured' : 'missing', gemini: GEMINI_API_KEY ? 'configured' : 'missing', whisper: WHISPER_BASE_URL },
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

fastify.post('/briefing/problem', async (request, reply) => {
    const { text } = request.body as { text: string };
    const raw = await generateWithGemini(`${briefingPrompts.problem}\n\nText:\n${text.substring(0, 15000)}`, false);
    return { problemaTecnico: raw.replace(/["{}]/g, '').trim() };
});

fastify.post('/briefing/solution', async (request, reply) => {
    const { text } = request.body as { text: string };
    const raw = await generateWithGemini(`${briefingPrompts.solution}\n\nText:\n${text.substring(0, 15000)}`, false);
    return { solucaoProposta: raw.replace(/["{}]/g, '').trim() };
});

fastify.post('/briefing/highlights', async (request, reply) => {
    const { text } = request.body as { text: string };
    const raw = await generateWithGemini(`${briefingPrompts.highlights}\n\nText:\n${text.substring(0, 15000)}`, false);
    return { diferenciais: raw.replace(/["{}]/g, '').trim() };
});

fastify.post('/briefing/applications', async (request, reply) => {
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
        const parsed = JSON.parse(raw);
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
            const parsed = JSON.parse(raw);
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
    const { keywords, ipc_codes } = request.body as { keywords: string[]; ipc_codes: string[] };
    if (!keywords?.length) return reply.code(400).send({ error: 'Keywords are required' });

    try {
        const results = await scrapeInpiBuscaWeb(keywords, ipc_codes);
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

        const cells = $(row).find('td');
        if (cells.length < 2) return;

        const number = link.text().trim();
        if (!number) return;

        const href = link.attr('href') || '';
        const onclick = link.attr('onclick') || '';
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

        if (number) {
            results.push({
                publicationNumber: number,
                title: title || '(Sem título)',
                applicant: '',
                date,
                abstract: '',
                classification,
                source: 'INPI',
                url: detailUrl
            });
        }
    });

    const pageText = $.root().text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
    const totalMatch = html.match(/Foram encontrados[\s\S]{0,120}?<b>\s*([\d.,]+)\s*<\/b>/i)
        || pageText.match(/Foram encontrados\s*([\d.,]+)/i);
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

async function initializeInpiAnonymousSession(cookieFile: string): Promise<void> {
    const payloadFilePrimary = `/tmp/inpi_login_primary_${randomUUID()}.txt`;
    const payloadFileFallback = `/tmp/inpi_login_fallback_${randomUUID()}.txt`;
    const loginUrl = 'https://busca.inpi.gov.br/pePI/servlet/LoginController';
    const debugLog = `/tmp/inpi_init_${randomUUID()}.log`;
    
    fs.writeFileSync(debugLog, `Init session start for ${cookieFile}\n`);

    try {
        fs.appendFileSync(debugLog, 'Step 1: Accessing login page...\n');
        await execInpiCurlWithRetry(
            `curl -v -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -c ${cookieFile} '${loginUrl}?action=login' -o /dev/null`,
            3,
            20000
        );

        fs.writeFileSync(payloadFilePrimary, 'submission=continuar', 'utf8');
        fs.appendFileSync(debugLog, 'Step 2: Posting submission=continuar...\n');
        await execInpiCurlWithRetry(
            `curl -v -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -c ${cookieFile} -X POST '${loginUrl}' --data-binary @${payloadFilePrimary} -o /dev/null`,
            3,
            25000
        );

        fs.writeFileSync(payloadFileFallback, 'action=login&T_Login=&T_Senha=&Usuario=', 'utf8');
        fs.appendFileSync(debugLog, 'Step 3: Posting empty login...\n');
        await execInpiCurlWithRetry(
            `curl -v -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -c ${cookieFile} -X POST '${loginUrl}' --data-binary @${payloadFileFallback} -o /dev/null`,
            3,
            25000
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
            `curl -s -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} '${detailUrl}' | iconv -f ISO-8859-1 -t UTF-8`,
            3,
            12000,
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
}): Promise<any[]> {
    const cookieFile = `/tmp/inpi_${randomUUID()}.txt`;
    const payloadFile = `/tmp/inpi_payload_${randomUUID()}.txt`;

    try {
        await initializeInpiAnonymousSession(cookieFile);

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
            `curl -sS -L --http1.1 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController' --data-binary @${payloadFile} | iconv -f ISO-8859-1 -t UTF-8`,
            3,
            35000,
            50 * 1024 * 1024
        );

        // Don't delete cookies yet - needed for details
        try { fs.unlinkSync(payloadFile); } catch { }

        let firstPageResults = parseInpiResults(stdout);
        const baseNextPageUrl = 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=nextPage';
        if (firstPageResults.length === 0) {
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
        const maxResults = 500;
        const maxPages = typeof params.maxPages === 'number' && params.maxPages > 0 ? params.maxPages : 5;
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

        const pageMetaTotal = reportedTotal ?? (pageResults as any).total ?? pageResults.length;
        const pageMetaPerPage = (pageResults as any).perPage ?? perPageEstimate;
        const pageMetaCurrentPage = (pageResults as any).currentPage ?? Math.min(requestedPage, estimatedTotalPages);
        const pageMetaTotalPages = reportedTotalPages ?? (pageResults as any).totalPages ?? estimatedTotalPages;

        if (requestedPage === 1 && reportedTotal && perPageFromHtml && reportedTotal > perPageFromHtml) {
            const results = pageResults;
            const totalPages = Math.min(Math.ceil(reportedTotal / perPageFromHtml), maxPages);
            fastify.log.info(`INPI: fetching up to ${totalPages} pages (~${targetTotal} results)`);

            for (let page = 2; page <= totalPages; page++) {
                if (results.length >= targetTotal) break;
                const pageUrl = `${baseNextPageUrl}&Page=${page}&Resumo=&Titulo=`;
                try {
                    const { stdout: pageHtml } = await execAsync(
                        `curl -s -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} '${pageUrl}' | iconv -f ISO-8859-1 -t UTF-8`,
                        { timeout: 120000, maxBuffer: 50 * 1024 * 1024 }
                    );
                    const pageResults = parseInpiResults(pageHtml);
                    for (const item of pageResults) {
                        if (results.length >= targetTotal) break;
                        const already = results.some((r) =>
                            r.publicationNumber === item.publicationNumber &&
                            r.source === item.source
                        );
                        if (!already) {
                            results.push(item);
                        }
                    }
                } catch (pageErr: any) {
                    fastify.log.warn(`INPI nextPage fetch failed for Page=${page}: ${pageErr.message}`);
                    break;
                }
            }
        }

        const results = pageResults;
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
                : results.length;
            const targetResults = results.slice(0, enrichLimit);
            fastify.log.info(`Enriching ${targetResults.length} of ${results.length} INPI results with details...`);
            const batchSize = 10;
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

async function scrapeInpiBuscaWeb(keywords: string[], _ipcCodes: string[], inpiQuery?: string): Promise<any[]> {
    const resumoFromQuery = (inpiQuery || keywords.join(' '))
        .replace(/[()"]/g, ' ')
        .replace(/\b(AND|OR|NOT|E|OU|NÃO|NAO)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (inpiQuery) {
        fastify.log.info(`INPI boolean query: ${inpiQuery.substring(0, 300)}`);
        return inpiQueue.enqueue(() => searchInpiViaCurl({ keywords: inpiQuery, resumo: resumoFromQuery }));
    }
    return inpiQueue.enqueue(() => searchInpiViaCurl({ keywords: keywords.join(' '), resumo: resumoFromQuery }));
}

async function fetchEspacenetBiblioByPublicationNumber(publicationNumber: string): Promise<{
    title?: string;
    applicant?: string;
    inventor?: string;
    abstract?: string;
    classification?: string;
    date?: string;
} | null> {
    if (!OPS_CONSUMER_KEY || !OPS_CONSUMER_SECRET) return null;
    const cleanedPn = publicationNumber.replace(/\s+/g, '');
    if (!cleanedPn) return null;
    try {
        const token = await getOpsToken();
        const url = `https://ops.epo.org/3.2/rest-services/published-data/search/biblio?q=${encodeURIComponent(`pn=${cleanedPn}`)}`;
        const response = await espacenetQueue.enqueue(() => axios.get(url, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
            timeout: 30000
        }));
        const opsResults = parseOpsResponse(response.data);
        const translated = await translatePatentsToPortuguese(opsResults);
        const first = translated[0];
        if (!first) return null;
        return {
            title: first.title,
            applicant: first.applicant,
            inventor: first.inventor,
            abstract: first.abstract,
            classification: first.classification,
            date: first.date
        };
    } catch (error: any) {
        fastify.log.warn(`Espacenet biblio fallback failed for PN=${publicationNumber}: ${error.message}`);
        return null;
    }
}

function extractInpiFigureUrls(html: string): string[] {
    const $ = cheerio.load(html);
    const baseUrl = 'https://busca.inpi.gov.br/pePI/';
    const blockedTokens = ['logo', 'banner', 'sprite', 'seta', 'icone', 'icon', 'blank', 'spacer', '.css', '.js'];
    const figureTokens = ['fig', 'image', 'imagem', 'desenho', 'thumbnail', 'thumb', 'patente'];
    const figures = new Set<string>();

    const normalizeUrl = (value: string): string => {
        const decoded = value.trim().replace(/&amp;/g, '&');
        if (!decoded) return '';
        try {
            return new URL(decoded, baseUrl).toString();
        } catch {
            return '';
        }
    };

    const collect = (rawValue?: string) => {
        if (!rawValue) return;
        const normalized = normalizeUrl(rawValue);
        if (!normalized) return;
        const lower = normalized.toLowerCase();
        if (blockedTokens.some(token => lower.includes(token))) return;
        const hasImageExtension = /\.(jpg|jpeg|png|gif|webp|bmp|tif|tiff)(\?|$)/i.test(lower);
        const hasFigureToken = figureTokens.some(token => lower.includes(token));
        if (!hasImageExtension && !hasFigureToken) return;
        figures.add(normalized);
    };

    $('img').each((_, el) => {
        collect($(el).attr('src'));
        collect($(el).attr('data-src'));
        collect($(el).attr('data-original'));
    });

    $('a').each((_, el) => {
        collect($(el).attr('href'));
        const onclick = $(el).attr('onclick') || '';
        const quotedMatches = onclick.match(/['"]([^'"]+\.(?:jpg|jpeg|png|gif|webp|bmp|tif|tiff)[^'"]*)['"]/gi) || [];
        quotedMatches.forEach((match) => {
            const cleaned = match.replace(/^['"]|['"]$/g, '');
            collect(cleaned);
        });
    });

    return Array.from(figures).slice(0, 20);
}

async function fetchInpiDetailByCod(codPedido: string, publicationNumber?: string): Promise<any> {
    const cookieFile = `/tmp/inpi_detail_${randomUUID()}.txt`;
    const defaultUrl = `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${encodeURIComponent(codPedido)}`;
    const fetchHtml = async (targetUrl: string): Promise<string> => {
        const encodedUrl = targetUrl.replace(/'/g, `%27`);
        const { stdout } = await inpiQueue.enqueue(() => execInpiCurlWithRetry(
            `curl -s -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' -e 'https://busca.inpi.gov.br/pePI/' -b ${cookieFile} -c ${cookieFile} '${encodedUrl}' | iconv -f ISO-8859-1 -t UTF-8`,
            3,
            30000,
            5 * 1024 * 1024
        ));
        return stdout;
    };
    const isLoginHtml = (html: string): boolean => {
        const normalized = normalizeText(html);
        return normalized.includes('pepi - pesquisa em propriedade industrial')
            && normalized.includes('para realizar a pesquisa anonimamente');
    };
    const extractDetailFromHtml = (html: string): Record<string, any> => {
        const $ = cheerio.load(html);
        const detail: Record<string, any> = {};
        $('table tr').each((_, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 2) {
                const label = $(cells[0]).text().trim().toLowerCase().replace(/[:\s]+$/g, '').trim();
                const value = $(cells[1]).text().trim();

                if (label.includes('depositante') || label.includes('titular')) detail.applicant = value;
                if (label.includes('inventor')) detail.inventor = value;
                if (label.includes('resumo')) detail.abstract = value;
                if (label.includes('classifica')) detail.classification = value;
                if (label.includes('dep') && label.includes('sito') && !detail.filingDate) detail.filingDate = value;
                if (label.includes('t') && label.includes('tulo') && !detail.title) detail.title = value;
                if (label.includes('despacho') || label.includes('situa')) detail.status = value;
            }
        });
        const resumoDiv = $('div.resumo, #resumo, .abstract').text().trim();
        if (resumoDiv && !detail.abstract) detail.abstract = resumoDiv;
        detail.figures = extractInpiFigureUrls(html);
        return detail;
    };

    const lookupDetailUrlByCod = async (): Promise<string | null> => {
        const list = await searchInpiViaCurl({ keywords: codPedido, resumo: codPedido });
        const match = list.find((item: any) => typeof item?.url === 'string' && item.url.includes(`CodPedido=${codPedido}`));
        return match?.url || null;
    };

    try {
        await initializeInpiAnonymousSession(cookieFile);
        let html = await fetchHtml(defaultUrl);
        if (!html.trim() || isLoginHtml(html)) {
            const discoveredUrl = await lookupDetailUrlByCod();
            if (discoveredUrl && discoveredUrl !== defaultUrl) {
                html = await fetchHtml(discoveredUrl);
            }
        }
        if (!html.trim() || isLoginHtml(html)) {
            await initializeInpiAnonymousSession(cookieFile);
            html = await fetchHtml(defaultUrl);
        }
        if (!html.trim() || isLoginHtml(html)) {
            fastify.log.warn(`INPI detail fell back to login page for CodPedido=${codPedido}`);
            const fallback = publicationNumber ? await fetchEspacenetBiblioByPublicationNumber(publicationNumber) : null;
            if (fallback) {
                return {
                    codPedido,
                    title: fallback.title,
                    applicant: fallback.applicant,
                    inventor: fallback.inventor,
                    abstract: fallback.abstract,
                    classification: fallback.classification,
                    filingDate: fallback.date,
                    source: 'INPI',
                    url: defaultUrl,
                    figures: []
                };
            }
            return {
                codPedido,
                source: 'INPI',
                url: defaultUrl,
                figures: []
            };
        }
        const detail = extractDetailFromHtml(html);
        if (!detail.title && !detail.abstract && !detail.applicant && !detail.inventor && (!detail.figures || detail.figures.length === 0)) {
            fastify.log.warn(`INPI did not return usable detail fields for CodPedido=${codPedido}`);
            const fallback = publicationNumber ? await fetchEspacenetBiblioByPublicationNumber(publicationNumber) : null;
            if (fallback) {
                return {
                    codPedido,
                    title: fallback.title,
                    applicant: fallback.applicant,
                    inventor: fallback.inventor,
                    abstract: fallback.abstract,
                    classification: fallback.classification,
                    filingDate: fallback.date,
                    source: 'INPI',
                    url: defaultUrl,
                    figures: []
                };
            }
            return {
                codPedido,
                source: 'INPI',
                url: defaultUrl,
                figures: []
            };
        }

        return {
            codPedido,
            ...detail,
            source: 'INPI',
            url: defaultUrl
        };
    } catch (error: any) {
        throw error;
    } finally {
        try { execSync(`rm -f ${cookieFile}`); } catch { }
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

// ─── GET /search/inpi/detail/:codPedido ────────────────────────
fastify.get('/search/inpi/detail/:codPedido', async (request, reply) => {
    const { codPedido } = request.params as { codPedido: string };
    const { publicationNumber } = request.query as { publicationNumber?: string };
    if (!codPedido) return reply.code(400).send({ error: 'CodPedido é obrigatório' });
    try {
        const detail = await fetchInpiDetailByCod(codPedido, publicationNumber);
        return detail;
    } catch (error: any) {
        fastify.log.warn(`INPI detail scrape failed: ${error.message}`);
        return {
            codPedido,
            source: 'INPI',
            status: 'EM SIGILO',
            url: `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${encodeURIComponent(codPedido)}`,
            figures: []
        };
    }
});

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
    const { number, titular, inventor, keywords, page, pageSize, includeEspacenet } = request.body as {
        number?: string;
        titular?: string;
        inventor?: string;
        keywords?: string;
        page?: number;
        pageSize?: number;
        includeEspacenet?: boolean;
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

    try {
        const inpi = await inpiQueue.enqueue(() => searchInpiViaCurl({
            number,
            titular,
            inventor,
            keywords,
            resumo: keywords,
            page: requestedPage,
            pageSize: requestedPageSize,
            maxPages: 1,
            enrichDetails: false
        }));
        fetchedInpiResults.push(...inpi);
        enqueueSearchResultsPersistence(inpi);
    } catch (err: any) {
        fastify.log.warn(`Quick search INPI failed: ${err.message}`);
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

    const inpiCurrentPage = Math.max(1, (fetchedInpiResults as any).currentPage ?? requestedPage);
    const inpiPageSize = (fetchedInpiResults as any).perPage ?? requestedPageSize;
    const inpiCurrentCount = inpiResults.length;
    const inpiRawTotal = (fetchedInpiResults as any).total ?? inpiResults.length;
    const inpiRawTotalPages = (fetchedInpiResults as any).totalPages
        ?? Math.max(1, Math.ceil(inpiRawTotal / requestedPageSize));
    const inpiMinTotalForPage = inpiCurrentCount > 0
        ? ((inpiCurrentPage - 1) * requestedPageSize) + inpiCurrentCount
        : 0;
    const inpiMayHaveNextPage = inpiCurrentCount === requestedPageSize;
    const inpiTotalPages = Math.max(
        inpiRawTotalPages,
        inpiCurrentPage,
        inpiMayHaveNextPage ? inpiCurrentPage + 1 : inpiCurrentPage
    );
    const inpiTotal = Math.max(
        inpiRawTotal,
        inpiMinTotalForPage,
        inpiMayHaveNextPage ? (inpiCurrentPage * requestedPageSize) + 1 : inpiMinTotalForPage
    );
    const inpiFrom = inpiTotal > 0 ? ((inpiCurrentPage - 1) * requestedPageSize) + 1 : 0;
    const inpiTo = inpiTotal > 0 ? inpiFrom + Math.max(inpiCurrentCount, 1) - 1 : 0;
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
                hasNext: inpiMayHaveNextPage || inpiCurrentPage < inpiTotalPages
            }
        },
        results: [...inpiResults, ...espacenetResults],
        total: allTotal
    };
});

// ─── POST /search (unified) ────────────────────────────────────
fastify.post('/search', async (request, reply) => {
    const { cql, inpiQuery, keywords, ipc_codes } = request.body as {
        cql: string;
        inpiQuery?: string;
        keywords?: string[];
        ipc_codes: string[];
    };

    fastify.log.info(`=== SEARCH REQUEST ===`);
    fastify.log.info(`CQL query (${cql?.length || 0} chars): ${cql}`);
    fastify.log.info(`INPI query (${inpiQuery?.length || 0} chars): ${inpiQuery}`);
    fastify.log.info(`IPC codes: ${ipc_codes?.join(', ') || 'none'}`);

    const results: { espacenet: any[]; inpi: any[] } = { espacenet: [], inpi: [] };

    const inpiStr = inpiQuery ? inpiQuery : (keywords?.length ? keywords.join(' ') : '');

    // Run both searches in parallel
    const [espacenetResult, inpiResult] = await Promise.allSettled([
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
        inpiStr ? scrapeInpiBuscaWeb([inpiStr], ipc_codes || [], inpiQuery) : Promise.resolve([])
    ]);

    if (espacenetResult.status === 'fulfilled') {
        results.espacenet = espacenetResult.value;
        enqueueSearchResultsPersistence(results.espacenet);
    } else {
        fastify.log.error(`Espacenet search FAILED: ${espacenetResult.reason?.message || espacenetResult.reason}`);
    }
    if (inpiResult.status === 'fulfilled') {
        results.inpi = inpiResult.value;
        enqueueSearchResultsPersistence(results.inpi);
    } else {
        fastify.log.error(`INPI search FAILED: ${inpiResult.reason?.message || inpiResult.reason}`);
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
                const parsed = JSON.parse(raw);
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
const start = async () => {
    try {
        const startupLog = `/tmp/server_startup.log`;
        fs.writeFileSync(startupLog, `Server starting at ${new Date().toISOString()} with PID ${process.pid}\n`);
        
        await fastify.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
