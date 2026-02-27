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

const fastify = Fastify({ logger: true });

fastify.register(cors, { origin: '*' });
fastify.register(multipart);
fastify.register(jwt, { secret: process.env.JWT_SECRET || 'patent-scope-secret-change-me' });

// ─── Simple User Store (JSON file) ─────────────────────────────
const DATA_DIR = process.env.DATA_DIR || '/app/data';
const USERS_FILE = path.join(DATA_DIR, 'users.json');

interface StoredUser {
    id: string;
    email: string;
    name: string;
    password_hash: string;
    role: string;
    created_at: string;
}

function loadUsers(): StoredUser[] {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
        }
    } catch { /* ignore */ }
    return [];
}

function saveUsers(users: StoredUser[]): void {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ─── Environment ───────────────────────────────────────────────
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
const WHISPER_BASE_URL = process.env.WHISPER_BASE_URL || 'http://whisper:8000';
const PRIMARY_MODEL = process.env.OLLAMA_PRIMARY_MODEL || 'qwen2.5:14b-instruct-q4_K_M';
const SECONDARY_MODEL = process.env.OLLAMA_SECONDARY_MODEL || 'llama3.1:8b-instruct-q4_K_M';
const OPS_CONSUMER_KEY = process.env.OPS_CONSUMER_KEY || '';
const OPS_CONSUMER_SECRET = process.env.OPS_CONSUMER_SECRET || '';
const INPI_MODE = process.env.INPI_MODE || 'scrape';

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

// ─── Ollama Helper ─────────────────────────────────────────────
async function ollamaGenerate(model: string, prompt: string, timeout = 120000): Promise<string> {
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
        model,
        prompt,
        stream: false,
        format: 'json'
    }, { timeout });
    return response.data.response || JSON.stringify(response.data);
}

// ─── POST /auth/register ───────────────────────────────────────
fastify.post('/auth/register', async (request, reply) => {
    const { email, password, name } = request.body as { email: string; password: string; name?: string };
    if (!email || !password) return reply.code(400).send({ error: 'Email e senha são obrigatórios' });
    if (password.length < 6) return reply.code(400).send({ error: 'Senha deve ter no mínimo 6 caracteres' });

    const users = loadUsers();
    if (users.find(u => u.email === email)) {
        return reply.code(409).send({ error: 'Este e-mail já está cadastrado' });
    }

    const hash = await bcrypt.hash(password, 10);
    const newUser: StoredUser = {
        id: crypto.randomUUID(),
        email,
        name: name || email.split('@')[0],
        password_hash: hash,
        role: users.length === 0 ? 'admin' : 'user', // First user is admin
        created_at: new Date().toISOString()
    };
    users.push(newUser);
    saveUsers(users);

    const token = fastify.jwt.sign({ id: newUser.id, email: newUser.email, role: newUser.role }, { expiresIn: '7d' });
    return { token, user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role } };
});

// ─── POST /auth/login ──────────────────────────────────────────
fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };
    if (!email || !password) return reply.code(400).send({ error: 'Email e senha são obrigatórios' });

    const users = loadUsers();
    const user = users.find(u => u.email === email);
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
        const { id, email, role } = request.user as any;
        const users = loadUsers();
        const user = users.find(u => u.id === id);
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
        services: { ollama: OLLAMA_BASE_URL, whisper: WHISPER_BASE_URL },
        models: { primary: PRIMARY_MODEL, secondary: SECONDARY_MODEL },
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

// ─── POST /briefing ────────────────────────────────────────────
fastify.post('/briefing', async (request, reply) => {
    const { text } = request.body as { text: string };
    if (!text) return reply.code(400).send({ error: 'Text is required' });

    const prompt = `Você é um especialista em patentes brasileiro. Analise o texto abaixo e extraia um briefing técnico estruturado.
Responda APENAS um JSON válido com estes campos exatos:
{
  "problemaTecnico": "descrição do problema técnico que a invenção resolve",
  "solucaoProposta": "descrição da solução técnica proposta",
  "diferenciais": "lista dos diferenciais em relação ao estado da arte",
  "aplicacoes": "aplicações industriais e mercados-alvo"
}

Texto:
${text.substring(0, 15000)}`;

    try {
        const raw = await ollamaGenerate(PRIMARY_MODEL, prompt, 180000);
        const parsed = JSON.parse(raw);
        return parsed;
    } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Failed to generate briefing', details: error.message });
    }
});

// ─── POST /strategy ────────────────────────────────────────────
fastify.post('/strategy', async (request, reply) => {
    const { briefing } = request.body as { briefing: any };
    if (!briefing) return reply.code(400).send({ error: 'Briefing object is required' });

    const prompt = `Com base no briefing técnico abaixo de uma invenção, gere palavras-chave de busca e classificações IPC/CPC para pesquisa de anterioridade em bases de patentes.
Responda APENAS um JSON válido com:
{
  "keywords_pt": ["array de 5-8 palavras-chave em português"],
  "keywords_en": ["array de 5-8 palavras-chave em inglês"],
  "ipc_codes": ["array de 3-5 códigos IPC relevantes no formato X00X 00/00"]
}

Briefing:
${JSON.stringify(briefing)}`;

    try {
        const raw = await ollamaGenerate(SECONDARY_MODEL, prompt, 60000);
        const parsed = JSON.parse(raw);
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
        const url = `http://ops.epo.org/3.2/rest-services/published-data/search/biblio?q=${encodeURIComponent(cql)}`;

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
            Resumo: '',
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

async function scrapeInpiBuscaWeb(keywords: string[], _ipcCodes: string[]): Promise<any[]> {
    return searchInpiViaCurl({ keywords: keywords.join(' ') });
}

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
            const opsUrl = `http://ops.epo.org/3.2/rest-services/published-data/search/biblio?q=${encodeURIComponent(cql)}`;

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
    const { cql, keywords, ipc_codes } = request.body as {
        cql: string;
        keywords: string[];
        ipc_codes: string[];
    };

    const results: { espacenet: any[]; inpi: any[] } = { espacenet: [], inpi: [] };

    // Run both searches in parallel
    const [espacenetResult, inpiResult] = await Promise.allSettled([
        cql ? (async () => {
            try {
                const token = await getOpsToken();
                const url = `http://ops.epo.org/3.2/rest-services/published-data/search/biblio?q=${encodeURIComponent(cql)}`;
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
        keywords?.length ? scrapeInpiBuscaWeb(keywords, ipc_codes || []) : Promise.resolve([])
    ]);

    if (espacenetResult.status === 'fulfilled') results.espacenet = espacenetResult.value;
    if (inpiResult.status === 'fulfilled') results.inpi = inpiResult.value;

    return results;
});

// ─── POST /analyze ─────────────────────────────────────────────
fastify.post('/analyze', async (request, reply) => {
    const { patents, briefing } = request.body as { patents: any[]; briefing: any };
    if (!patents?.length || !briefing) {
        return reply.code(400).send({ error: 'Patents array and briefing are required' });
    }

    try {
        // Analyze patents in batches of 3 (avoid overloading LLM)
        const analyzed: any[] = [];
        const batchSize = 3;

        for (let i = 0; i < patents.length; i += batchSize) {
            const batch = patents.slice(i, i + batchSize);

            const batchPromises = batch.map(async (patent: any) => {
                const prompt = `Você é um especialista em propriedade intelectual. Compare a patente encontrada com a invenção do cliente e avalie o risco de colisão.

INVENÇÃO DO CLIENTE:
Problema: ${briefing.problemaTecnico || ''}
Solução: ${briefing.solucaoProposta || ''}
Diferenciais: ${briefing.diferenciais || ''}

PATENTE ENCONTRADA:
Número: ${patent.publicationNumber}
Título: ${patent.title}
Resumo: ${patent.abstract || 'Não disponível'}
Titular: ${patent.applicant}
Classificação: ${patent.classification || 'N/A'}

Responda APENAS um JSON com:
{
  "riskLevel": "high" ou "medium" ou "low",
  "score": número de 0 a 100 indicando grau de sobreposição,
  "justificativa": "explicação em português do grau de risco e sobreposição técnica (2-3 frases)"
}`;

                try {
                    const raw = await ollamaGenerate(PRIMARY_MODEL, prompt, 120000);
                    const parsed = JSON.parse(raw);
                    return {
                        ...patent,
                        riskLevel: parsed.riskLevel || 'medium',
                        score: parsed.score ?? 50,
                        justificativa: parsed.justificativa || ''
                    };
                } catch {
                    return {
                        ...patent,
                        riskLevel: 'medium',
                        score: 50,
                        justificativa: 'Análise automática indisponível — avalie manualmente.'
                    };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            analyzed.push(...batchResults);
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
