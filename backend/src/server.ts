import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import FormData from 'form-data';
import * as cheerio from 'cheerio';

const fastify = Fastify({ logger: true });

fastify.register(cors, { origin: '*' });
fastify.register(multipart);

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

async function scrapeInpiBuscaWeb(keywords: string[], ipcCodes: string[]): Promise<any[]> {
    // INPI Busca Web uses a search form that we can query via GET params
    const query = keywords.join(' ');
    const url = `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=SearchPatent&Query=${encodeURIComponent(query)}`;

    try {
        const response = await axios.get(url, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; PatentScoope/1.0)',
                'Accept': 'text/html',
                'Accept-Language': 'pt-BR,pt;q=0.9'
            }
        });

        const $ = cheerio.load(response.data);
        const results: any[] = [];

        // INPI search results are typically in a table structure
        // The exact selectors may need adjustment based on the current INPI page structure
        $('table.resultado tr, table.listaResultado tr, .resultado-pesquisa tr').each((i, row) => {
            if (i === 0) return; // Skip header row

            const cells = $(row).find('td');
            if (cells.length < 2) return;

            const number = $(cells[0]).text().trim();
            const title = $(cells[1]).text().trim();
            const depositor = cells.length > 2 ? $(cells[2]).text().trim() : '';
            const date = cells.length > 3 ? $(cells[3]).text().trim() : '';

            if (number && title) {
                results.push({
                    publicationNumber: number,
                    title,
                    applicant: depositor || 'N/A',
                    date: date || '',
                    abstract: '', // INPI listing doesn't show abstract
                    classification: '',
                    source: 'INPI',
                    url: `https://busca.inpi.gov.br/pePI/servlet/PatenteServletController?Action=detail&CodPedido=${encodeURIComponent(number)}`
                });
            }
        });

        return results;
    } catch (error: any) {
        // If scraping fails, return empty (INPI may be down or block automated access)
        fastify.log.warn(`INPI scrape failed: ${error.message}. Returning empty results.`);
        return [];
    }
}

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
