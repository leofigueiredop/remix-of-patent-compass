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
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

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

// Inicializa SDK do Gemini (fallback)
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ─── OPS Token Cache ───────────────────────────────────────────
let opsAccessToken: string | null = null;
let opsTokenExpiration = 0;

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
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY não configurada no servidor.');
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
    // Try Groq first (free tier, fast)
    if (GROQ_API_KEY) {
        try {
            return await generateWithGroq(prompt, expectJson, customSystemMessage);
        } catch (error: any) {
            fastify.log.warn(`Groq failed, falling back to Gemini: ${error.message}`);
        }
    }
    // Fallback to Gemini
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

// Post-process and validate strategy output from LLM
function validateAndFixStrategy(parsed: any): any {
    // Ensure required fields exist
    if (!parsed.techBlocks) parsed.techBlocks = [];
    if (!parsed.blocks) parsed.blocks = [];
    if (!parsed.searchLevels) parsed.searchLevels = [];
    if (!parsed.ipc_codes) parsed.ipc_codes = [];

    // Fix blocks: ensure each has id, connector, and groups
    parsed.blocks = parsed.blocks.map((b: any, i: number) => ({
        id: b.id || `b${i + 1}`,
        connector: b.connector || 'AND',
        groups: (b.groups || []).map((g: any, j: number) => ({
            id: g.id || `g${i + 1}-${j + 1}`,
            terms: (g.terms || []).filter((t: any) => typeof t === 'string' && t.trim() !== '')
        })).filter((g: any) => g.terms.length > 0)
    })).filter((b: any) => b.groups.length > 0);

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
Para cada eixo, crie 1 camada (block) com 1-2 grupos (groups) de sinônimos.
MÁXIMO 3 camadas (blocks). Agrupe eixos relacionados se necessário.

REGRAS CRÍTICAS DE TERMOS (siga na ordem):
a) PRIMEIRO: 3-4 termos SIMPLES de 1 palavra (PT + EN) — substantivos genéricos.
   Ex: "máquina", "machine", "dispositivo", "device", "aparelho", "apparatus"
b) DEPOIS: variações morfológicas (verbo/substantivo/adjetivo/agente):
   Ex: "cortar", "corte", "cortador" / "cut", "cutting", "cutter"
c) DEPOIS: sinônimos do cotidiano industrial:
   Ex: "prensa" = "compressor" / "molde" = "forma" = "matriz"
d) POR ÚLTIMO: termos compostos mais específicos:
   Ex: "máquina de corte", "cutting machine", "dispositivo de selagem"
e) Mínimo 7-10 termos por grupo. Mix bilingue PT + EN.
f) NÃO use: termos de marca, neologismos, gírias.

3) SEARCH LEVELS (searchLevels) — 3 níveis de queries PRONTAS

REGRAS CQL (Espacenet):
- Sintaxe: ta all "termo" (SEMPRE "ta all", NUNCA "ti=" ou "ab=")
- Máx 300 caracteres por query
- Nível 1: máx 1 AND — busca ampla, use termos SIMPLES de 1 palavra
- Nível 2: máx 2 AND — cruza 2 conceitos
- Nível 3: máx 3 AND — mais refinado

REGRAS INPI:
- Sintaxe: ("termo1" OR "termo2") AND ("termo3" OR "termo4")
- SOMENTE termos em Português
- Mesmas restrições de AND por nível

4) CÓDIGOS IPC (ipc_codes)
3-5 códigos IPC/CPC mais relevantes com justificativa técnica de 1 linha.

═══════════════════════════════════════
EXEMPLO COMPLETO
═══════════════════════════════════════

Briefing: Máquina automática para fabricação de pastéis com corte e selagem integrados.

{
  "techBlocks": [
    { "id": "tb1", "name": "Máquina de Conformação de Massa", "description": "Equipamento para moldar, recortar e fechar massa alimentícia recheada" },
    { "id": "tb2", "name": "Sistema de Corte", "description": "Mecanismo para corte e separação de porções de massa" },
    { "id": "tb3", "name": "Sistema de Selagem", "description": "Dispositivo para vedação e fechamento das bordas da massa" }
  ],
  "blocks": [
    {
      "id": "b1", "connector": "AND",
      "groups": [
        { "id": "g1", "terms": ["machine", "máquina", "apparatus", "aparelho", "device", "dispositivo", "equipment", "equipamento", "food machine", "máquina alimentícia", "pastel machine", "máquina de pastel", "empanada machine"] }
      ]
    },
    {
      "id": "b2", "connector": "AND",
      "groups": [
        { "id": "g2", "terms": ["cutter", "cortador", "cutting", "corte", "cut", "cortar", "blade", "lâmina", "knife", "faca", "cutting device", "dispositivo de corte", "cutting wheel", "disco de corte"] },
        { "id": "g3", "terms": ["sealer", "selador", "sealing", "selagem", "seal", "selar", "crimper", "recravador", "press", "prensa", "edge sealer", "selador de bordas", "heat sealer", "seladora térmica"] }
      ]
    }
  ],
  "searchLevels": [
    {
      "level": 1,
      "label": "Busca Ampla",
      "cql": "ta all machine OR ta all apparatus OR ta all \"food machine\" OR ta all pastry OR ta all empanada",
      "inpi": "(\"máquina\" OR \"aparelho\" OR \"dispositivo\" OR \"pastel\" OR \"massa recheada\")"
    },
    {
      "level": 2,
      "label": "Interseção Tecnológica",
      "cql": "(ta all machine OR ta all apparatus OR ta all \"food machine\") AND (ta all cutting OR ta all sealing OR ta all crimping)",
      "inpi": "(\"máquina\" OR \"aparelho\" OR \"equipamento\") AND (\"corte\" OR \"selagem\" OR \"fechamento\")"
    },
    {
      "level": 3,
      "label": "Busca Refinada",
      "cql": "(ta all \"pastry machine\" OR ta all \"empanada machine\" OR ta all \"food forming\") AND (ta all cutting OR ta all cutter) AND (ta all sealing OR ta all crimping)",
      "inpi": "(\"máquina de pastel\" OR \"máquina de massa\") AND (\"corte\" OR \"cortador\") AND (\"selagem\" OR \"selador\" OR \"fechamento\")"
    }
  ],
  "ipc_codes": [
    { "code": "A21C 11/00", "justification": "Máquinas para moldagem de massas alimentícias" },
    { "code": "A21C 3/00", "justification": "Máquinas para divisão e corte de massa" },
    { "code": "B65B 9/00", "justification": "Máquinas para embalar produtos em envoltórios formados a partir de material plano" }
  ]
}

═══════════════════════════════════════
AGORA GERE A ESTRATÉGIA PARA O BRIEFING ACIMA
═══════════════════════════════════════
LEMBRE: termos SIMPLES de 1 palavra primeiro, depois compostos. Mínimo 7-10 termos por grupo.
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

        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            timeout: 30000
        });

        const results = parseOpsResponse(response.data);
        return { results, total: results.length };
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

    const docs = Array.isArray(biblioData) ? biblioData : [biblioData];

    for (const doc of docs) {
        const exchangeDoc = doc?.['exchange-document'];
        if (!exchangeDoc) continue;

        const bibData = exchangeDoc['bibliographic-data'];

        // Title
        let title = 'Sem Título';
        const invTitle = bibData?.['invention-title'];
        if (Array.isArray(invTitle)) {
            title = invTitle.find((t: any) => t['@lang'] === 'en' || t['@lang'] === 'pt')?.['$'] || invTitle[0]?.['$'];
        } else if (invTitle) {
            title = invTitle['$'];
        }

        // Abstract
        let abstract = '';
        const absData = exchangeDoc['abstract'];
        if (Array.isArray(absData)) {
            abstract = absData.find((a: any) => a['@lang'] === 'en')?.['p']?.['$'] || absData[0]?.['p']?.['$'] || '';
        } else if (absData) {
            abstract = absData['p']?.['$'] || '';
        }

        // Applicant
        let applicant = 'Desconhecido';
        const parties = bibData?.['parties']?.['applicants']?.['applicant'];
        if (parties) {
            const appObj = Array.isArray(parties) ? parties[0] : parties;
            applicant = appObj['applicant-name']?.['name']?.['$'] || '';
        }

        // Publication ref
        const pubRef = bibData?.['publication-reference']?.['document-id'];
        const docDb = Array.isArray(pubRef) ? pubRef.find((r: any) => r['@document-id-type'] === 'docdb') : pubRef;
        const pubDate = docDb?.['date']?.['$'] || '';
        const pubNum = docDb?.['doc-number']?.['$'] || '';
        const country = docDb?.['country']?.['$'] || '';

        // Classification
        let classification = '';
        const classData = bibData?.['patent-classifications']?.['patent-classification'];
        if (classData) {
            const cls = Array.isArray(classData) ? classData[0] : classData;
            classification = `${cls?.['section']?.['$'] || ''}${cls?.['class']?.['$'] || ''}${cls?.['subclass']?.['$'] || ''} ${cls?.['main-group']?.['$'] || ''}/${cls?.['subgroup']?.['$'] || ''}`;
        }

        results.push({
            publicationNumber: `${country} ${pubNum}`.trim(),
            title,
            applicant,
            date: pubDate,
            abstract,
            classification,
            source: 'Espacenet',
            url: `https://worldwide.espacenet.com/patent/search?q=pn%3D${country}${pubNum}`
        });
    }

    return results;
}

// ─── POST /search/inpi ─────────────────────────────────────────
fastify.post('/search/inpi', async (request, reply) => {
    const { keywords, ipc_codes } = request.body as { keywords: string[]; ipc_codes: string[] };
    if (!keywords?.length) return reply.code(400).send({ error: 'Keywords are required' });

    try {
        const results = await scrapeInpiBuscaWeb(keywords, ipc_codes);
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

    $('table tr').each((_, row) => {
        const bgColor = $(row).attr('bgcolor');
        if (!bgColor || (bgColor !== '#E0E0E0' && bgColor !== 'white')) return;

        const cells = $(row).find('td');
        if (cells.length < 3) return;

        const link = $(cells[0]).find('a').first();
        if (!link.length) return;

        const number = link.text().trim();
        if (!number) return;

        const href = link.attr('href') || '';
        const codMatch = href.match(/CodPedido=(\d+)/);
        const codPedido = codMatch ? codMatch[1] : '';

        const date = $(cells[1]).text().trim();
        const title = $(cells[2]).find('b').text().trim() || $(cells[2]).text().trim();
        const classification = cells.length > 3 ? $(cells[3]).text().trim() : '';

        if (number && title) {
            results.push({
                publicationNumber: number,
                title,
                applicant: '',
                date,
                abstract: '',
                classification,
                source: 'INPI',
                url: codPedido
                    ? `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${codPedido}`
                    : `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${encodeURIComponent(number)}`
            });
        }
    });

    const totalMatch = html.match(/Foram encontrados\s*<b>(\d+)<\/b>/);
    const total = totalMatch ? parseInt(totalMatch[1]) : results.length;
    fastify.log.info(`INPI: found ${results.length} results (total: ${total})`);

    return results;
}

function searchInpiViaCurl(params: {
    number?: string;
    titular?: string;
    inventor?: string;
    keywords?: string;
    resumo?: string;
}): any[] {
    const cookieFile = `/tmp/inpi_${randomUUID()}.txt`;

    try {
        // Step 1: Anonymous login — curl handles redirects & cookies perfectly
        execSync(
            `curl -s -c ${cookieFile} -L 'https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login' -o /dev/null`,
            { timeout: 15000 }
        );

        // Step 2: POST advanced search — INPI requires ALL fields (even empty)
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
            RegisterPerPage: '100',
            botao: ' pesquisar » ',
        };

        const postBody = Object.entries(fields)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');
        fastify.log.info(`INPI curl search: ${postBody}`);

        const html = execSync(
            `curl -s -b ${cookieFile} -X POST 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController' -d '${postBody}' | iconv -f ISO-8859-1 -t UTF-8`,
            { timeout: 30000, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
        );

        // Cleanup
        try { execSync(`rm -f ${cookieFile}`); } catch { }

        return parseInpiResults(html);
    } catch (error: any) {
        try { execSync(`rm -f ${cookieFile}`); } catch { }
        fastify.log.warn(`INPI curl search failed: ${error.message}`);
        return [];
    }
}

async function scrapeInpiBuscaWeb(keywords: string[], _ipcCodes: string[], inpiQuery?: string): Promise<any[]> {
    // If we have a pre-built INPI boolean query, use it in the Resumo field for better recall.
    // Otherwise fallback to simple keyword join in Titulo.
    if (inpiQuery) {
        return searchInpiViaCurl({ resumo: inpiQuery });
    }
    return searchInpiViaCurl({ keywords: keywords.join(' ') });
}

// ─── GET /search/inpi/detail/:codPedido ────────────────────────
fastify.get('/search/inpi/detail/:codPedido', async (request, reply) => {
    const { codPedido } = request.params as { codPedido: string };
    if (!codPedido) return reply.code(400).send({ error: 'CodPedido é obrigatório' });

    const cookieFile = `/tmp/inpi_detail_${randomUUID()}.txt`;
    try {
        // Login anônimo
        execSync(`curl -s -c ${cookieFile} -L 'https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login' -o /dev/null`, { timeout: 15000 });

        // Buscar página de detalhe
        const html = execSync(
            `curl -s -b ${cookieFile} 'https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${codPedido}' | iconv -f ISO-8859-1 -t UTF-8`,
            { timeout: 30000, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
        );

        try { execSync(`rm -f ${cookieFile}`); } catch { }

        const $ = cheerio.load(html);
        const detail: Record<string, string> = {};

        // INPI detail page has <td> with labels followed by <td> with values
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

        // Also try to extract abstract from specific div if exists
        const resumoDiv = $('div.resumo, #resumo, .abstract').text().trim();
        if (resumoDiv && !detail.abstract) detail.abstract = resumoDiv;

        return {
            codPedido,
            ...detail,
            source: 'INPI',
            url: `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${codPedido}`
        };
    } catch (error: any) {
        try { execSync(`rm -f ${cookieFile}`); } catch { }
        fastify.log.warn(`INPI detail scrape failed: ${error.message}`);
        return reply.code(500).send({ error: 'Falha ao buscar detalhe da patente', details: error.message });
    }
});

// ─── POST /search/quick ────────────────────────────────────────
fastify.post('/search/quick', async (request, reply) => {
    const { number, titular, inventor, keywords } = request.body as {
        number?: string;
        titular?: string;
        inventor?: string;
        keywords?: string;
    };

    if (!number && !titular && !inventor && !keywords) {
        return reply.code(400).send({ error: 'Informe pelo menos um critério de busca' });
    }

    const results: any[] = [];

    // 1. Search INPI via advanced search (POST with session)
    try {
        const inpiResults = searchInpiViaCurl({ number, titular, inventor, keywords });
        results.push(...inpiResults);
    } catch (err: any) {
        fastify.log.warn(`Quick search INPI failed: ${err.message}`);
    }

    // 2. Search Espacenet if OPS keys are configured
    if (OPS_CONSUMER_KEY && OPS_CONSUMER_SECRET) {
        try {
            const cqlParts: string[] = [];
            if (number) cqlParts.push(`pn=${number.trim()}`);
            if (titular) cqlParts.push(`pa="${titular.trim()}"`);
            if (inventor) cqlParts.push(`in="${inventor.trim()}"`);
            if (keywords) cqlParts.push(`txt="${keywords.trim()}"`);

            const cql = cqlParts.join(' AND ');
            const token = await getOpsToken();
            const opsUrl = `https://ops.epo.org/3.2/rest-services/published-data/search/biblio?q=${encodeURIComponent(cql)}`;

            const response = await axios.get(opsUrl, {
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
                timeout: 30000
            });

            const opsResults = parseOpsResponse(response.data);
            results.push(...opsResults);
        } catch (err: any) {
            if (err.response?.status !== 404) {
                fastify.log.warn(`Quick search Espacenet failed: ${err.message}`);
            }
        }
    }

    return { results, total: results.length };
});

// ─── POST /search (unified) ────────────────────────────────────
fastify.post('/search', async (request, reply) => {
    const { cql, inpiQuery, keywords, ipc_codes } = request.body as {
        cql: string;
        inpiQuery?: string;
        keywords?: string[];
        ipc_codes: string[];
    };

    const results: { espacenet: any[]; inpi: any[] } = { espacenet: [], inpi: [] };

    const inpiStr = inpiQuery ? inpiQuery : (keywords?.length ? keywords.join(' ') : '');

    // Run both searches in parallel
    const [espacenetResult, inpiResult] = await Promise.allSettled([
        cql ? (async () => {
            try {
                const token = await getOpsToken();
                const url = `https://ops.epo.org/3.2/rest-services/published-data/search/biblio?q=${encodeURIComponent(cql)}`;
                const response = await axios.get(url, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
                    timeout: 30000
                });
                return parseOpsResponse(response.data);
            } catch (err: any) {
                if (err.response?.status === 404) return [];
                throw err;
            }
        })() : Promise.resolve([]),
        inpiStr ? scrapeInpiBuscaWeb([inpiStr], ipc_codes || [], inpiQuery) : Promise.resolve([])
    ]);

    if (espacenetResult.status === 'fulfilled') {
        results.espacenet = espacenetResult.value;
    } else {
        fastify.log.error(`Espacenet search FAILED: ${espacenetResult.reason?.message || espacenetResult.reason}`);
    }
    if (inpiResult.status === 'fulfilled') {
        results.inpi = inpiResult.value;
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
        await fastify.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
