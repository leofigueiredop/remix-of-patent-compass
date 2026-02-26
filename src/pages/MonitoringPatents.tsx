import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Search, Eye, FileText, ScrollText, Users } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

// Extended Mock Data matching user requirements
const monitoredPatents = [
    {
        id: "1",
        number: "BR 10 2023 004561-2",
        title: "PAINEL PAREDE MODULAR COM ISOLAMENTO TÉRMICO E ACÚSTICO",
        holder: "João Silva Construções ME",
        inventor: "João da Silva",
        classification: "E04B 2/00; E04C 2/288",
        status: "Ativo",
        alerts: 0,
        lastUpdate: "2025-10-15",
        abstract: "A presente invenção refere-se a um painel de parede modular (10) compreendendo um núcleo isolante (12) imprensado entre duas placas cimentícias (14), caracterizado por possuir canais internos (16) para passagem de instalações elétricas e hidráulicas sem necessidade de quebra posterior.",
        claims: "1. Painel parede modular caracterizado por compreender um núcleo de poliestireno expandido e revestimento de argamassa armada.\n2. Painel de acordo com a reivindicação 1, onde os canais internos são pré-moldados."
    },
    {
        id: "2",
        number: "BR 10 2022 018923-8",
        title: "SISTEMA DE ENCAIXE RÁPIDO PARA BLOCOS DE CONCRETO CELULAR",
        holder: "Construtora Alfa S.A.",
        inventor: "Roberto Almeida; Carlos Santos",
        classification: "E04B 1/02",
        status: "Alerta",
        alerts: 2,
        lastUpdate: "2025-11-02",
        abstract: "Sistema de conexão para blocos de alvenaria que dispensa o uso de argamassa de assentamento, utilizando apenas adesivo polimérico nas junções verticais.",
        claims: "1. Sistema de encaixe compreendendo macho e fêmea com geometria trapezoidal.\n2. Bloco de concreto celular autoclavado com densidade de 500kg/m3."
    },
    {
        id: "3",
        number: "BRL SERVICE INV-2065590",
        title: "DISPOSITIVO DE SUPORTE ESTRUTURAL PARA VIGAS EM BALANÇO",
        holder: "Leo Figueiredo Engenharia",
        inventor: "Leonardo Figueiredo",
        classification: "E04G 5/00",
        status: "Ativo",
        alerts: 1,
        lastUpdate: "2026-01-20",
        abstract: "Dispositivo auxiliar para escoramento de vigas em balanço durante a fase de cura do concreto, permitindo ajuste milimétrico de altura.",
        claims: "1. Dispositivo de suporte metálico com rosca sem fim para ajuste de altura.\n2. Base articulada para adaptação em terrenos irregulares."
    },
];

export default function MonitoringPatents() {
    const [selectedPatent, setSelectedPatent] = useState<typeof monitoredPatents[0] | null>(null);

    return (
        <AppLayout>
            <div className="space-y-6">
                <div className="flex justify-between items-end">
                    <div>
                        <h1 className="text-2xl font-bold mb-1">Patentes Monitoradas</h1>
                        <p className="text-muted-foreground text-sm">
                            Gerenciamento do portfólio vigiado (Próprias e de Terceiros)
                        </p>
                    </div>
                    <Button className="gap-2 bg-accent hover:bg-accent/90">
                        <Search className="w-4 h-4" /> Cadastrar Nova Patente
                    </Button>
                </div>

                <div className="rounded-md border bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[180px]">Número</TableHead>
                                <TableHead className="max-w-[300px]">Título / Classificação</TableHead>
                                <TableHead>Titular / Inventor</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-center">Colidências</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {monitoredPatents.map((patent) => (
                                <TableRow key={patent.id}>
                                    <TableCell className="font-mono font-medium text-xs">
                                        {patent.number}
                                    </TableCell>
                                    <TableCell>
                                        <div className="font-semibold text-sm line-clamp-2" title={patent.title}>{patent.title}</div>
                                        <Badge variant="outline" className="mt-1 text-[10px] h-5">{patent.classification}</Badge>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        <div className="flex flex-col">
                                            <span className="font-medium">{patent.holder}</span>
                                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                <Users className="w-3 h-3" /> {patent.inventor}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={patent.status === "Alerta" ? "destructive" : "secondary"}>
                                            {patent.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {patent.alerts > 0 ? (
                                            <Badge variant="destructive" className="rounded-full w-6 h-6 p-0 flex items-center justify-center mx-auto">
                                                {patent.alerts}
                                            </Badge>
                                        ) : (
                                            <span className="text-muted-foreground">-</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="gap-2 hover:text-accent"
                                            onClick={() => setSelectedPatent(patent)}
                                        >
                                            <Eye className="w-4 h-4" /> Detalhes
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                {/* Details Sheet */}
                <Sheet open={!!selectedPatent} onOpenChange={() => setSelectedPatent(null)}>
                    <SheetContent className="sm:max-w-xl w-full flex flex-col h-full">
                        {selectedPatent && (
                            <>
                                <SheetHeader className="mb-6">
                                    <Badge className="w-fit mb-2">{selectedPatent.number}</Badge>
                                    <SheetTitle className="text-lg leading-snug">{selectedPatent.title}</SheetTitle>
                                    <SheetDescription>
                                        IPC: {selectedPatent.classification} | Status: {selectedPatent.status}
                                    </SheetDescription>
                                </SheetHeader>

                                <ScrollArea className="flex-1 -mx-6 px-6">
                                    <div className="space-y-6 pb-6">
                                        {/* Entities */}
                                        <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
                                            <div>
                                                <div className="text-xs text-muted-foreground font-semibold uppercase mb-1">Titular</div>
                                                <div className="text-sm font-medium">{selectedPatent.holder}</div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-muted-foreground font-semibold uppercase mb-1">Inventores</div>
                                                <div className="text-sm font-medium">{selectedPatent.inventor}</div>
                                            </div>
                                        </div>

                                        {/* Abstract */}
                                        <div className="space-y-2">
                                            <h3 className="text-sm font-bold flex items-center gap-2">
                                                <FileText className="w-4 h-4 text-accent" /> Resumo
                                            </h3>
                                            <p className="text-sm text-justify text-muted-foreground leading-relaxed bg-muted/20 p-3 rounded border">
                                                {selectedPatent.abstract}
                                            </p>
                                        </div>

                                        {/* Claims */}
                                        <div className="space-y-2">
                                            <h3 className="text-sm font-bold flex items-center gap-2">
                                                <ScrollText className="w-4 h-4 text-accent" /> Reivindicações (Principal)
                                            </h3>
                                            <div className="text-sm font-mono text-muted-foreground bg-muted/20 p-3 rounded border whitespace-pre-wrap">
                                                {selectedPatent.claims}
                                            </div>
                                        </div>
                                    </div>
                                </ScrollArea>

                                <SheetFooter className="pt-4 border-t mt-auto">
                                    <Button variant="outline" onClick={() => setSelectedPatent(null)}>Fechar</Button>
                                    <Button className="bg-accent text-accent-foreground">Editar Dados</Button>
                                </SheetFooter>
                            </>
                        )}
                    </SheetContent>
                </Sheet>
            </div>
        </AppLayout>
    );
}
