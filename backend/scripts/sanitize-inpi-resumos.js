process.loadEnvFile?.('.env');
const { PrismaClient } = require('@prisma/client');

function normalizeSummaryText(value) {
    return String(value || '')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

function cutFromSummaryMarker(text) {
    const markerRegexes = [
        /\(\s*57\s*\)\s*resumo\s*[:\-]?\s*/i,
        /\(\s*57\s*\)\s*/i,
        /\bresumo\s*[:\-]\s*/i
    ];
    for (const regex of markerRegexes) {
        const match = regex.exec(text);
        if (!match) continue;
        return text.slice(match.index + match[0].length).trim();
    }
    return text;
}

function cutAtStopMarkers(text) {
    const stopRegexes = [
        /\(\s*73\s*\)\s*nome\s+do\s+titular/i,
        /\(\s*72\s*\)\s*nome\s+do\s+inventor/i,
        /\(\s*71\s*\)\s*nome\s+do\s+depositante/i,
        /\btodas\s+as\s+anuidades\s+vinculadas\b/i,
        /\bpeti[cç][oõ]es\b/i,
        /\bservi[cç]o\s+pgo\b/i,
        /\bhist[óo]rico\s+inpi\b/i,
        /\bprotocolo\b.*\bdata\b.*\bservi[cç]os?\b/i
    ];
    let minIndex = text.length;
    for (const regex of stopRegexes) {
        const match = regex.exec(text);
        if (!match) continue;
        if (match.index >= 0 && match.index < minIndex) minIndex = match.index;
    }
    return text.slice(0, minIndex).trim();
}

function collapseRepeatedTail(text) {
    const normalized = normalizeSummaryText(text);
    if (normalized.length < 300) return normalized;
    const half = Math.floor(normalized.length / 2);
    const left = normalized.slice(0, half).trim();
    const right = normalized.slice(half).trim();
    if (left.length > 120 && right.length > 120 && (left.includes(right.slice(0, 80)) || right.includes(left.slice(0, 80)))) {
        return left;
    }
    return normalized;
}

function sanitizeInpiDetailedAbstract(input) {
    const raw = normalizeSummaryText(input);
    if (!raw) return '';
    const fromMarker = cutFromSummaryMarker(raw);
    const withoutTail = cutAtStopMarkers(fromMarker);
    const cleaned = collapseRepeatedTail(withoutTail)
        .replace(/^(brasilacesso|consulta\s+[àa]\s+base\s+de\s+dados\s+do\s+inpi).*/i, '')
        .replace(/^\(54\)\s*t[íi]tulo\s*[:\-]?\s*/i, '')
        .replace(/^\(57\)\s*/i, '')
        .trim();
    if (cleaned.length < 80) return '';
    return cleaned;
}

const prisma = new PrismaClient();
const POLLUTED_REGEX = /(consulta\s+[àa]\s+base\s+de\s+dados\s+do\s+inpi|todas\s+as\s+anuidades\s+vinculadas|servi[cç]o\s+pgo\s+protocolo|brasilacesso)/i;

async function run() {
    const candidates = await prisma.inpiPatent.findMany({
        where: {
            OR: [
                { resumo_detalhado: { contains: 'Consulta à Base de Dados do INPI' } },
                { resumo_detalhado: { contains: 'Todas as anuidades vinculadas' } },
                { resumo_detalhado: { contains: 'Serviço Pgo Protocolo' } },
                { resumo_detalhado: { contains: 'BrasilAcesso' } },
                { abstract: { contains: 'Consulta à Base de Dados do INPI' } },
                { abstract: { contains: 'Todas as anuidades vinculadas' } },
                { abstract: { contains: 'Serviço Pgo Protocolo' } },
                { abstract: { contains: 'BrasilAcesso' } }
            ]
        },
        select: { cod_pedido: true, resumo_detalhado: true, abstract: true }
    });

    let updated = 0;
    for (const row of candidates) {
        const source = row.resumo_detalhado || row.abstract || '';
        const cleaned = sanitizeInpiDetailedAbstract(source);
        const isPolluted = POLLUTED_REGEX.test(source);
        if (!cleaned && !isPolluted) continue;
        const target = cleaned || '';
        const currentResumo = normalizeSummaryText(row.resumo_detalhado || '');
        const currentAbstract = normalizeSummaryText(row.abstract || '');
        if (target === currentResumo && target === currentAbstract) continue;
        await prisma.inpiPatent.update({
            where: { cod_pedido: row.cod_pedido },
            data: {
                resumo_detalhado: target,
                abstract: target,
                updated_at: new Date()
            }
        });
        updated++;
    }

    console.log(JSON.stringify({ scanned: candidates.length, updated }, null, 2));
}

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
