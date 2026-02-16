
export interface OpsAuthResponse {
    access_token: string;
    token_type: string;
    expires_in: string; // usually seconds as string
    scope: string;
}

export interface OpsSearchResult {
    publicationNumber: string;
    title: string;
    applicant: string;
    date: string;
    abstract: string;
}

export class EspacenetService {
    private static BASE_URL = "http://ops.epo.org/3.2";
    private static AUTH_URL = "https://ops.epo.org/3.2/auth/accesstoken";

    // Note: These should ideally be in env vars, but for the "demo/simulation" we might need to prompt user or use a proxy.
    // For now, I'll structure it to accept keys or fail gracefully.
    private static CONSUMER_KEY = import.meta.env.VITE_OPS_CONSUMER_KEY || "";
    private static CONSUMER_SECRET = import.meta.env.VITE_OPS_CONSUMER_SECRET || "";

    private static accessToken: string | null = null;
    private static tokenExpiration: number = 0;

    static async authenticate(): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiration) {
            return this.accessToken;
        }

        if (!this.CONSUMER_KEY || !this.CONSUMER_SECRET) {
            throw new Error("Credenciais da API do Espacenet (OPS) não configuradas. Adicione VITE_OPS_CONSUMER_KEY e VITE_OPS_CONSUMER_SECRET ao .env");
        }

        const credentials = btoa(`${this.CONSUMER_KEY}:${this.CONSUMER_SECRET}`);

        try {
            const response = await fetch(this.AUTH_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Basic ${credentials}`,
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: "grant_type=client_credentials"
            });

            if (!response.ok) {
                throw new Error(`Falha na autenticação OPS: ${response.statusText}`);
            }

            const data: OpsAuthResponse = await response.json();
            this.accessToken = data.access_token;
            // expires_in is usually 1200 seconds (20 mins). We'll expire it a bit earlier to be safe.
            this.tokenExpiration = Date.now() + (parseInt(data.expires_in) * 1000) - 60000;

            return this.accessToken;
        } catch (error) {
            console.error("Erro ao autenticar no Espacenet:", error);
            throw error;
        }
    }

    static async search(cqlQuery: string): Promise<OpsSearchResult[]> {
        try {
            const token = await this.authenticate();

            // OPS Search Endpoint: /published-data/search?q={cql}
            // We need to request Biblio data to get title/abstract
            // Usually standard search returns simple list, we might need constituents.
            // Let's try basic search first.

            const url = `${this.BASE_URL}/rest-services/published-data/search/biblio?q=${encodeURIComponent(cqlQuery)}`;

            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Accept": "application/json"
                }
            });

            if (!response.ok) {
                throw new Error(`Erro na busca OPS: ${response.statusText}`);
            }

            const data = await response.json();
            return this.parseSearchResponse(data);

        } catch (error) {
            console.error("Espacenet Search Error:", error);
            // Fallback for demo if no keys or error
            if ((error as Error).message.includes("Credenciais")) {
                // Return empty or mock is handled by caller, but here we throw to let UI know
                throw error;
            }
            return [];
        }
    }

    private static parseSearchResponse(data: any): OpsSearchResult[] {
        // Parsing OPS JSON is tricky as it's often a direct mapping of XML.
        // This is a simplified parser assuming standard JSON output from OPS v3.2

        const results: OpsSearchResult[] = [];

        // Configurações de navegação do JSON do OPS podem variar
        const biblioData = data?.["ops:world-patent-data"]?.["ops:biblio-search"]?.["ops:search-result"]?.["exchange-documents"];

        if (!biblioData) return [];

        const docs = Array.isArray(biblioData) ? biblioData : [biblioData];

        for (const doc of docs) {
            const exchangeDoc = doc?.["exchange-document"];
            if (!exchangeDoc) continue;

            const bibliographicData = exchangeDoc["bibliographic-data"];

            // Extract Title
            let title = "Sem Título";
            const inventionTitle = bibliographicData?.["invention-title"];
            if (Array.isArray(inventionTitle)) {
                title = inventionTitle.find((t: any) => t["@lang"] === "en" || t["@lang"] === "pt")?.["$"] || inventionTitle[0]?.["$"];
            } else if (inventionTitle) {
                title = inventionTitle["$"];
            }

            // Extract Abstract
            let abstract = "";
            const abstractData = exchangeDoc["abstract"];
            if (Array.isArray(abstractData)) {
                abstract = abstractData.find((a: any) => a["@lang"] === "en")?.["p"]?.["$"] || "";
            } else if (abstractData) {
                abstract = abstractData["p"]?.["$"] || "";
            }

            // Extract Applicant
            let applicant = "Desconhecido";
            const parties = bibliographicData?.["parties"]?.["applicants"]?.["applicant"];
            if (parties) {
                const appObj = Array.isArray(parties) ? parties[0] : parties;
                applicant = appObj["applicant-name"]?.["name"]?.["$"] || "";
            }

            // Extract Date and Number
            const pubRef = bibliographicData?.["publication-reference"]?.["document-id"];
            const pubDate = pubRef?.find((r: any) => r["@document-id-type"] === "docdb")?.["date"]?.["$"] || "";
            const pubNum = pubRef?.find((r: any) => r["@document-id-type"] === "docdb")?.["doc-number"]?.["$"] || "";
            const country = pubRef?.find((r: any) => r["@document-id-type"] === "docdb")?.["country"]?.["$"] || "";

            results.push({
                publicationNumber: `${country}${pubNum}`,
                title,
                applicant,
                date: pubDate,
                abstract
            });
        }

        return results;
    }
}
