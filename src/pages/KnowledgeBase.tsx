import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
    Search,
    FileText,
    BookOpen,
    BrainCircuit,
    Upload,
    MoreHorizontal,
    Database,
    FileCheck
} from "lucide-react";

// Mock RAG Documents
const documents = [
    { id: 1, name: "Manual de Patentes - Engenharia Civil.pdf", type: "PDF", size: "12MB", date: "2024-01-15", status: "Indexado", vectors: "14.2k" },
    { id: 2, name: "Relatório Técnico - Concreto Celular.docx", type: "DOCX", size: "2.4MB", date: "2024-02-10", status: "Indexado", vectors: "3.1k" },
    { id: 3, name: "Norma ABNT NBR 6118.pdf", type: "PDF", size: "8MB", date: "2024-03-05", status: "Processando", vectors: "8.5k" },
    { id: 4, name: "Patentes Anteriores da Empresa (2020-2023).zip", type: "Múltiplos", size: "45MB", date: "2024-01-10", status: "Indexado", vectors: "52.1k" },
];

export default function KnowledgeBase() {
    const [searchTerm, setSearchTerm] = useState("");

    return (
        <AppLayout>
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <BrainCircuit className="w-6 h-6 text-accent" /> Base de Conhecimento (RAG)
                        </h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            Biblioteca corporativa indexada para contexto da IA. Tudo aqui é usado para tornar as respostas mais precisas.
                        </p>
                    </div>
                    <Button className="gap-2 bg-accent hover:bg-accent/90">
                        <Upload className="w-4 h-4" /> Importar Documentos
                    </Button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="bg-muted/30 border-dashed">
                        <CardContent className="p-4 flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                                <FileText className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold">142</div>
                                <div className="text-xs text-muted-foreground">Documentos Indexados</div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-muted/30 border-dashed">
                        <CardContent className="p-4 flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                                <Database className="w-5 h-5 text-purple-600" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold">1.2M</div>
                                <div className="text-xs text-muted-foreground">Vetores Semânticos (Embeddings)</div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-muted/30 border-dashed">
                        <CardContent className="p-4 flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                                <FileCheck className="w-5 h-5 text-green-600" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold">100%</div>
                                <div className="text-xs text-muted-foreground">Saúde do Índice</div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Search & Filter */}
                <div className="flex items-center gap-4 py-2">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar documentos na base..."
                            className="pl-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm">Filtrar por Data</Button>
                        <Button variant="outline" size="sm">Tipo de Arquivo</Button>
                    </div>
                </div>

                {/* Document List */}
                <div className="bg-card rounded-lg border shadow-sm">
                    <div className="grid grid-cols-12 gap-4 p-4 border-b bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <div className="col-span-6 md:col-span-5">Nome do Arquivo</div>
                        <div className="col-span-2 hidden md:block">Tipo</div>
                        <div className="col-span-2 hidden md:block">Data Ingestão</div>
                        <div className="col-span-2 text-center">Status</div>
                        <div className="col-span-2 md:col-span-1 text-right">Ação</div>
                    </div>
                    <div className="divide-y">
                        {documents.map((doc) => (
                            <div key={doc.id} className="grid grid-cols-12 gap-4 p-4 items-center hover:bg-muted/30 transition-colors group">
                                <div className="col-span-6 md:col-span-5 flex items-center gap-3 overflow-hidden">
                                    <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center flex-shrink-0">
                                        <FileText className="w-4 h-4 text-slate-500" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-medium text-sm truncate" title={doc.name}>{doc.name}</div>
                                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                                            {doc.size} • {doc.vectors} vetores
                                        </div>
                                    </div>
                                </div>
                                <div className="col-span-2 hidden md:block text-sm text-muted-foreground">
                                    <Badge variant="secondary" className="font-normal">{doc.type}</Badge>
                                </div>
                                <div className="col-span-2 hidden md:block text-sm text-muted-foreground">
                                    {new Date(doc.date).toLocaleDateString()}
                                </div>
                                <div className="col-span-2 text-center">
                                    <Badge
                                        variant={doc.status === "Indexado" ? "secondary" : "outline"}
                                        className={doc.status === "Indexado" ? "bg-green-100 text-green-700 hover:bg-green-100 border-none" : "animate-pulse border-blue-200 text-blue-600 bg-blue-50"}
                                    >
                                        {doc.status}
                                    </Badge>
                                </div>
                                <div className="col-span-2 md:col-span-1 text-right">
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                        <MoreHorizontal className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
