import AppLayout from "@/components/AppLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Eye } from "lucide-react";

const monitoredPatents = [
    { id: "1", number: "BR 10 2023 004561-2", title: "Painel Parede Modular com Isolamento Térmico", owner: "João Silva", status: "Ativo", alerts: 0, date: "2025-10-15" },
    { id: "2", number: "BR 10 2022 018923-8", title: "Sistema de Encaixe para Construção Civil", owner: "Construtora Alfa", status: "Alerta", alerts: 2, date: "2025-11-02" },
    { id: "3", number: "BRL SERVICE INV-2065590", title: "Dispositivo de Suporte Estrutural", owner: "Leo Figueiredo", status: "Ativo", alerts: 1, date: "2026-01-20" },
];

export default function MonitoringPatents() {
    return (
        <AppLayout>
            <div className="space-y-6">
                <div className="flex justify-between items-end">
                    <div>
                        <h1 className="text-2xl font-bold mb-1">Patentes Monitoradas</h1>
                        <p className="text-muted-foreground text-sm">
                            Gerencie as patentes próprias ou de terceiros sob vigilância
                        </p>
                    </div>
                    <Button className="gap-2">
                        <Search className="w-4 h-4" /> Adicionar Patente
                    </Button>
                </div>

                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Número / Título</TableHead>
                                <TableHead>Titular</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Alertas</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {monitoredPatents.map((patent) => (
                                <TableRow key={patent.id}>
                                    <TableCell>
                                        <p className="font-medium text-sm">{patent.number}</p>
                                        <p className="text-xs text-muted-foreground">{patent.title}</p>
                                    </TableCell>
                                    <TableCell className="text-sm">{patent.owner}</TableCell>
                                    <TableCell>
                                        <Badge variant={patent.status === "Alerta" ? "destructive" : "secondary"}>
                                            {patent.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <span className={`text-sm font-semibold ${patent.alerts > 0 ? "text-risk-high" : "text-muted-foreground"}`}>
                                            {patent.alerts}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="sm" className="gap-2">
                                            <Eye className="w-4 h-4" /> Detalhes
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </div>
        </AppLayout>
    );
}
