function normalizeSummaryText(value?: string): string {
    return String(value || '')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

function cutFromSummaryMarker(text: string): string {
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

function cutAtStopMarkers(text: string): string {
    const stopRegexes = [
        /\(\s*73\s*\)\s*nome\s+do\s+titular/i,
        /\(\s*72\s*\)\s*nome\s+do\s+inventor/i,
        /\(\s*71\s*\)\s*nome\s+do\s+depositante/i,
        /\(\s*74\s*\)\s*nome\s+do\s+procurador/i,
        /\(\s*51\s*\)\s*classifica[cç][aã]o/i,
        /\(\s*52\s*\)\s*classifica[cç][aã]o/i,
        /\(\s*54\s*\)\s*t[íi]tulo/i,
        /\bclassifica[cç][aã]o(?:\s+(?:ipc|cpc|internacional))?\s*[:\-]/i,
        /\b(?:titular|depositante|inventor(?:es)?|procurador)\s*[:\-]/i,
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

function collapseRepeatedTail(text: string): string {
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

export function sanitizeInpiDetailedAbstract(input?: string): string {
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
