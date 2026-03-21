import { useCallback, useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { FileText, Search, Filter, ShieldCheck, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import axios from "axios";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

type AssetRow = {
    id: string;
    patent_number: string;
    patent_id?: string | null;
    title?: string | null;
    applicant?: string | null;
    active: boolean;
    updated_at: string;
};

export default function MyAssets() {
    const [query, setQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState<"all" | "active" | "paused">("all");
    const [assets, setAssets] = useState<AssetRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [newAssetNumber, setNewAssetNumber] = useState("");

    const loadAssets = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await axios.get(`${API_URL}/monitoring/patents`, { params: { pageSize: 100, q: query || undefined } });
            setAssets(Array.isArray(data?.rows) ? data.rows : []);
        } catch {
            toast.error("Não foi possível carregar os ativos monitorados.");
        } finally {
            setLoading(false);
        }
    }, [query]);

    useEffect(() => {
        const timer = setTimeout(() => {
            void loadAssets();
        }, 250);
        return () => clearTimeout(timer);
    }, [loadAssets]);

    const addAsset = async () => {
        if (!newAssetNumber.trim()) return;
        setAdding(true);
        try {
            await axios.post(`${API_URL}/monitoring/patents/add`, { patentNumber: newAssetNumber.trim() });
            toast.success("Ativo adicionado ao monitoramento.");
            setNewAssetNumber("");
            await loadAssets();
        } catch (error: any) {
            toast.error(error?.response?.data?.error || "Não foi possível adicionar o ativo.");
        } finally {
            setAdding(false);
        }
    };

    const filteredAssets = assets.filter((asset) => {
        if (activeFilter === "active") return asset.active;
        if (activeFilter === "paused") return !asset.active;
        return true;
    });

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 w-full mx-auto">
                <div className="flex justify-between items-end">
                    <div className="animate-in fade-in slide-in-from-left duration-700">
                        <h1 className="text-2xl font-bold flex items-center gap-3 text-slate-900 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                                <Briefcase className="w-5 h-5 text-slate-600" />
                            </div>
                            Meus Ativos
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            Portfólio de patentes monitoradas para você e seus clientes.
                        </p>
                    </div>
                    <Button onClick={addAsset} disabled={adding || !newAssetNumber.trim()} className="gap-2 bg-slate-900 hover:bg-slate-800 text-white">
                        <ShieldCheck className="w-4 h-4" /> Adicionar Ativo
                    </Button>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input className="pl-9 bg-slate-50 border-slate-200" placeholder="Buscar ativo por número, título ou cliente..." value={query} onChange={(e) => setQuery(e.target.value)} />
                    </div>
                    <select
                        value={activeFilter}
                        onChange={(e) => setActiveFilter(e.target.value as "all" | "active" | "paused")}
                        className="h-10 rounded-md border border-slate-200 px-3 text-sm bg-white text-slate-700"
                    >
                        <option value="all">Todos</option>
                        <option value="active">Ativos</option>
                        <option value="paused">Pausados</option>
                    </select>
                    <Button variant="outline" className="gap-2 bg-white text-slate-600">
                        <Filter className="w-4 h-4" /> Filtros
                    </Button>
                    <Input className="max-w-[240px] bg-slate-50 border-slate-200" value={newAssetNumber} onChange={(e) => setNewAssetNumber(e.target.value)} placeholder="BR102024..." />
                </div>

                <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden min-h-[300px]">
                    {loading ? (
                        <div className="p-8 text-center text-sm text-slate-500">Carregando ativos...</div>
                    ) : filteredAssets.length === 0 ? (
                        <div className="min-h-[300px] flex flex-col items-center justify-center text-center p-8">
                            <Briefcase className="w-12 h-12 text-slate-300 mb-4" />
                            <h3 className="text-lg font-bold text-slate-800">Nenhum ativo cadastrado</h3>
                            <p className="text-sm text-slate-500 mt-2 max-w-md">
                                Cadastre patentes para consolidar a visão de colidência, processo e mercado em um único painel.
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {filteredAssets.map((asset) => (
                                <div key={asset.id} className="px-4 py-3 flex items-start justify-between gap-4">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-semibold text-slate-800">{asset.patent_number}</p>
                                            <Badge className={asset.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}>
                                                {asset.active ? "Ativo" : "Pausado"}
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-slate-500">{asset.title || "Sem título"}</p>
                                        <p className="text-[11px] text-slate-400">{asset.applicant || "-"}</p>
                                    </div>
                                    <span className="text-xs text-slate-400">{new Date(asset.updated_at).toLocaleString("pt-BR")}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}
