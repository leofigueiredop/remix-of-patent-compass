import { useState } from "react";
import { Search, Loader2, ExternalLink, Hash, User, UserCheck, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AppLayout from "@/components/AppLayout";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

interface PatentResult {
    publicationNumber: string;
    title: string;
    applicant: string;
    inventor?: string;
    date: string;
    abstract: string;
    classification: string;
    source: string;
    url: string;
}

export default function QuickSearch() {
    const [number, setNumber] = useState("");
    const [titular, setTitular] = useState("");
    const [inventor, setInventor] = useState("");
    const [keywords, setKeywords] = useState("");
    const [results, setResults] = useState<PatentResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [error, setError] = useState("");

    const hasInput = number || titular || inventor || keywords;

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!hasInput) return;

        setLoading(true);
        setError("");
        setSearched(true);

        try {
            const response = await axios.post(`${API_URL}/search/quick`, {
                number: number || undefined,
                titular: titular || undefined,
                inventor: inventor || undefined,
                keywords: keywords || undefined,
            });
            setResults(response.data.results || []);
        } catch (err: any) {
            setError(err.response?.data?.error || "Erro ao buscar patentes");
            setResults([]);
        } finally {
            setLoading(false);
        }
    };

    const clearAll = () => {
        setNumber("");
        setTitular("");
        setInventor("");
        setKeywords("");
        setResults([]);
        setSearched(false);
        setError("");
    };

    return (
        <AppLayout>
            <div className="space-y-6">
                {/* Header */}
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                            <Search className="w-5 h-5 text-accent" />
                        </div>
                        Busca Rápida de Patentes
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Pesquise diretamente no INPI por número, titular, inventor ou palavras-chave
                    </p>
                </div>

                {/* Search Form */}
                <form onSubmit={handleSearch} className="bg-card rounded-xl border p-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-sm font-medium mb-1.5 flex items-center gap-2">
                                <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                                Número do Pedido
                            </label>
                            <Input
                                placeholder="Ex: BR102018008765"
                                value={number}
                                onChange={(e) => setNumber(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="text-sm font-medium mb-1.5 flex items-center gap-2">
                                <User className="w-3.5 h-3.5 text-muted-foreground" />
                                Titular / Depositante
                            </label>
                            <Input
                                placeholder="Ex: Petrobras, Embrapa..."
                                value={titular}
                                onChange={(e) => setTitular(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="text-sm font-medium mb-1.5 flex items-center gap-2">
                                <UserCheck className="w-3.5 h-3.5 text-muted-foreground" />
                                Inventor
                            </label>
                            <Input
                                placeholder="Ex: João Silva"
                                value={inventor}
                                onChange={(e) => setInventor(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="text-sm font-medium mb-1.5 flex items-center gap-2">
                                <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                                Palavras-chave (Título/Resumo)
                            </label>
                            <Input
                                placeholder="Ex: painel modular construção civil"
                                value={keywords}
                                onChange={(e) => setKeywords(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <Button type="submit" disabled={loading || !hasInput} className="gap-2">
                            {loading ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Buscando...</>
                            ) : (
                                <><Search className="w-4 h-4" /> Buscar</>
                            )}
                        </Button>
                        {hasInput && (
                            <Button type="button" variant="outline" onClick={clearAll} className="gap-2">
                                <X className="w-4 h-4" /> Limpar
                            </Button>
                        )}
                    </div>
                </form>

                {/* Error */}
                {error && (
                    <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                        {error}
                    </div>
                )}

                {/* Results */}
                {searched && !loading && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold">
                                {results.length > 0 ? `${results.length} resultado${results.length > 1 ? "s" : ""} encontrado${results.length > 1 ? "s" : ""}` : "Nenhum resultado"}
                            </h2>
                            {results.length > 0 && (
                                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                                    Fonte: {[...new Set(results.map(r => r.source))].join(" + ")}
                                </span>
                            )}
                        </div>

                        {results.length === 0 ? (
                            <div className="bg-card rounded-xl border p-12 text-center">
                                <Search className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                                <p className="text-muted-foreground">
                                    Nenhuma patente encontrada com os critérios informados.
                                </p>
                                <p className="text-sm text-muted-foreground/70 mt-1">
                                    Tente termos mais genéricos ou verifique o número do pedido.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {results.map((patent, idx) => (
                                    <div key={idx} className="bg-card rounded-xl border p-5 hover:shadow-md transition-shadow">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-xs font-mono font-medium text-accent bg-accent/10 px-2 py-0.5 rounded">
                                                        {patent.publicationNumber}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                                        {patent.source}
                                                    </span>
                                                    {patent.date && (
                                                        <span className="text-xs text-muted-foreground">
                                                            {patent.date}
                                                        </span>
                                                    )}
                                                </div>
                                                <h3 className="font-semibold text-sm mb-1 line-clamp-2">
                                                    {patent.title}
                                                </h3>
                                                {patent.applicant && patent.applicant !== "N/A" && (
                                                    <p className="text-xs text-muted-foreground">
                                                        <span className="font-medium">Titular:</span> {patent.applicant}
                                                    </p>
                                                )}
                                                {patent.abstract && (
                                                    <p className="text-xs text-muted-foreground mt-2 line-clamp-3">
                                                        {patent.abstract}
                                                    </p>
                                                )}
                                                {patent.classification && (
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        <span className="font-medium">IPC:</span> {patent.classification}
                                                    </p>
                                                )}
                                            </div>
                                            <a
                                                href={patent.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="shrink-0 p-2 rounded-lg hover:bg-muted transition-colors"
                                                title="Abrir no site original"
                                            >
                                                <ExternalLink className="w-4 h-4 text-muted-foreground" />
                                            </a>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </AppLayout>
    );
}
