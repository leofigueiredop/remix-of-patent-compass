import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileDown, Search, FolderOpen } from "lucide-react";
import { useState } from "react";

interface Research {
    id: string;
    title: string;
    date: string;
    status: "editing" | "analyzed" | "finalized";
}

export default function ResearchHistory() {
    const [researches] = useState<Research[]>([]);

    return (
        <AppLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold mb-1">Histórico de Pesquisas</h1>
                    <p className="text-muted-foreground text-sm">
                        Acesse resultados e relatórios de análises anteriores
                    </p>
                </div>

                <div className="grid gap-3">
                    {researches.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">
                            <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-50" />
                            <p className="text-sm font-medium">Nenhuma pesquisa no histórico</p>
                            <p className="text-xs mt-1">Pesquisas concluídas aparecerão aqui automaticamente.</p>
                        </div>
                    ) : (
                        researches.map((research) => (
                            <div key={research.id} className="p-4 rounded-lg border bg-card/50 flex items-center justify-between hover:border-accent/50 transition-colors cursor-pointer group">
                                <div className="flex gap-4 items-center">
                                    <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                                        <Search className="w-5 h-5 text-accent" />
                                    </div>
                                    <div>
                                        <p className="font-medium text-sm group-hover:text-accent transition-colors">{research.title}</p>
                                        <div className="flex items-center gap-3 mt-1">
                                            <p className="text-[11px] text-muted-foreground uppercase">{new Date(research.date).toLocaleDateString('pt-BR')}</p>
                                            <Badge variant="outline" className="text-[10px] h-4 px-1">{research.status}</Badge>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => window.location.href = '/research/report'}
                                    >
                                        Ver Análise
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8"><FileDown className="w-4 h-4" /></Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </AppLayout>
    );
}
