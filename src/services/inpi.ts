export interface InpiTitular {
    nome: string;
    pais?: string;
    uf?: string;
}

export interface InpiProcesso {
    numero: string;
    dataDeposito?: string;
    titulo?: string;
    titulares: InpiTitular[];
    classificacao?: string[]; // IPC
    resumo?: string;
}

export interface InpiDespacho {
    codigo: string;
    descricao: string;
    processo: InpiProcesso;
    textoComplementar?: string;
}

export interface InpiRevista {
    numero: string;
    dataPublicacao: string;
    despachos: InpiDespacho[];
}

export class InpiParser {
    // Parses a raw XML string from the RPI
    static parseXML(xmlString: string): InpiRevista {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, "text/xml");

        const revistaEl = xmlDoc.getElementsByTagName("revista")[0];
        if (!revistaEl) throw new Error("XML inválido: tag <revista> não encontrada.");

        const numero = revistaEl.getAttribute("numero") || "";
        const dataPublicacao = revistaEl.getAttribute("dataPublicacao") || "";

        const despachos: InpiDespacho[] = [];
        const despachoNodes = xmlDoc.getElementsByTagName("despacho");

        for (let i = 0; i < despachoNodes.length; i++) {
            const d = despachoNodes[i];
            const codigo = d.getAttribute("codigo") || "";
            const descricao = d.getAttribute("nome") || ""; // Sometimes it's 'nome' or implied by code

            // Processo handling
            const processoEl = d.getElementsByTagName("processo-patente")[0] || d.getElementsByTagName("processo")[0];
            if (!processoEl) continue;

            const processo = this.parseProcesso(processoEl);
            despachos.push({
                codigo,
                descricao,
                processo,
                textoComplementar: d.getElementsByTagName("texto-complementar")[0]?.textContent || undefined
            });
        }

        return { numero, dataPublicacao, despachos };
    }

    private static parseProcesso(el: Element): InpiProcesso {
        const numero = el.getElementsByTagName("numero")[0]?.textContent || el.getAttribute("numero") || "N/A";
        const titulo = el.getElementsByTagName("titulo")[0]?.textContent || "";
        const dataDeposito = el.getElementsByTagName("data-deposito")[0]?.textContent || "";

        // Titulares
        const titulares: InpiTitular[] = [];
        const titularNodes = el.getElementsByTagName("titular");
        for (let i = 0; i < titularNodes.length; i++) {
            titulares.push({
                nome: titularNodes[i].getAttribute("nome-razao-social") || titularNodes[i].textContent || "",
                pais: titularNodes[i].getAttribute("pais") || undefined,
                uf: titularNodes[i].getAttribute("uf") || undefined
            });
        }

        // IPCs
        const classificacao: string[] = [];
        const ipcs = el.getElementsByTagName("classificacao-nacional");
        for (let i = 0; i < ipcs.length; i++) {
            const code = ipcs[i].getElementsByTagName("codigo")[0]?.textContent;
            if (code) classificacao.push(code);
        }

        return { numero, titulo, dataDeposito, titulares, classificacao };
    }
}

export interface CollisionResult {
    patente: InpiProcesso;
    despacho: InpiDespacho;
    matchedKeywords: string[];
    score: number;
}

export class InpiMonitor {
    static checkCollisions(revista: InpiRevista, keywords: string[]): CollisionResult[] {
        const results: CollisionResult[] = [];

        for (const despacho of revista.despachos) {
            if (!despacho.processo.titulo) continue;

            const textToSearch = (despacho.processo.titulo + " " + (despacho.processo.resumo || "")).toLowerCase();
            const matched: string[] = [];
            let score = 0;

            for (const kw of keywords) {
                const cleanKw = kw.toLowerCase().replace("*", "");
                if (textToSearch.includes(cleanKw)) {
                    matched.push(kw);
                    score += 10;
                }
            }

            if (matched.length > 0) {
                results.push({
                    patente: despacho.processo,
                    despacho,
                    matchedKeywords: matched,
                    score
                });
            }
        }

        return results.sort((a, b) => b.score - a.score);
    }
}
