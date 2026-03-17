import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { AlertCircle, BellRing, CalendarClock, RefreshCw, ShieldAlert } from "lucide-react";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

type DashboardSummary = {
  kpis: {
    monitoredPatents: number;
    unreadAlerts: number;
    exigencyAlerts: number;
    grantsLast30d: number;
    communicationsLast7d: number;
  };
  exigencies: Array<{
    id: string;
    patentNumber: string;
    rpi: string;
    code: string;
    description: string;
    date: string | null;
    deadline: string | null;
    daysLeft: number | null;
  }>;
  communications: Array<{
    id: string;
    patentNumber: string;
    rpi: string;
    code: string;
    description: string;
    complement: string;
    date: string | null;
    source: string | null;
  }>;
  deadlines: Array<{
    patentNumber: string;
    code: string;
    deadline: string;
    daysLeft: number;
  }>;
};

const emptySummary: DashboardSummary = {
  kpis: { monitoredPatents: 0, unreadAlerts: 0, exigencyAlerts: 0, grantsLast30d: 0, communicationsLast7d: 0 },
  exigencies: [],
  communications: [],
  deadlines: [],
};

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString("pt-BR");
}

export default function MonitoringDashboard() {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}/monitoring/dashboard-summary`);
      setSummary(data || emptySummary);
      if (data?.deadlines?.[0]?.deadline) {
        setSelectedDate(new Date(data.deadlines[0].deadline));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const criticalExigencies = useMemo(
    () => summary.exigencies.filter((item) => item.code === "6.1" || item.code === "7.1"),
    [summary.exigencies]
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Dashboard de Monitoramento</h1>
            <p className="text-sm text-muted-foreground">Comunicados RPI, exigências com prazo, alertas e calendário</p>
          </div>
          <Button variant="outline" onClick={refresh} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <Card><CardHeader className="pb-2"><CardDescription>Patentes Monitoradas</CardDescription><CardTitle>{summary.kpis.monitoredPatents}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Alertas Não Lidos</CardDescription><CardTitle>{summary.kpis.unreadAlerts}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Exigências Ativas</CardDescription><CardTitle className="text-red-600">{summary.kpis.exigencyAlerts}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Concessões (30 dias)</CardDescription><CardTitle>{summary.kpis.grantsLast30d}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Comunicados (7 dias)</CardDescription><CardTitle>{summary.kpis.communicationsLast7d}</CardTitle></CardHeader></Card>
        </div>
        {summary.kpis.monitoredPatents === 0 && (
          <Card>
            <CardContent className="py-3 text-sm text-muted-foreground">
              Nenhuma patente monitorada ativa. Cadastre em Monitoramento {"\u003e"} Patentes ou por procurador em Configurações.
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-red-600" /> Exigências Críticas (6.1 / 7.1)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patente</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Prazo</TableHead>
                    <TableHead>Dias</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {criticalExigencies.slice(0, 12).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.patentNumber}</TableCell>
                      <TableCell><Badge variant="outline">{item.code}</Badge></TableCell>
                      <TableCell className="max-w-[420px] truncate" title={item.description}>{item.description || "-"}</TableCell>
                      <TableCell>{formatDate(item.deadline)}</TableCell>
                      <TableCell className={item.daysLeft !== null && item.daysLeft <= 15 ? "text-red-600 font-semibold" : ""}>{item.daysLeft ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                  {criticalExigencies.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sem exigências críticas no momento.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CalendarClock className="w-4 h-4" /> Calendário de Prazos</CardTitle>
              <CardDescription>Seleção focada no prazo mais próximo</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Calendar mode="single" selected={selectedDate} onSelect={setSelectedDate} className="rounded-md border" />
              {summary.deadlines.slice(0, 6).map((item, idx) => (
                <div key={`${item.patentNumber}-${idx}`} className="text-xs p-2 rounded border flex items-center justify-between">
                  <span className="font-mono">{item.patentNumber}</span>
                  <span>{formatDate(item.deadline)} ({item.daysLeft}d)</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BellRing className="w-4 h-4" /> Comunicados Recentes</CardTitle>
            <CardDescription>Últimas movimentações da RPI com fonte de dados</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patente</TableHead>
                  <TableHead>RPI</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Fonte</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.communications.slice(0, 20).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.patentNumber}</TableCell>
                    <TableCell>{item.rpi}</TableCell>
                    <TableCell><Badge variant="outline">{item.code || "-"}</Badge></TableCell>
                    <TableCell className="max-w-[420px] truncate" title={`${item.description || ""} ${item.complement || ""}`}>{item.description || "-"}</TableCell>
                    <TableCell>{item.date || "-"}</TableCell>
                    <TableCell>{item.source || "-"}</TableCell>
                  </TableRow>
                ))}
                {summary.communications.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sem comunicados recentes.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 text-xs text-muted-foreground flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Alertas de exigência usam prioridade para códigos 6.1 e 7.1. Próximo passo é ligar esse painel com notificações automáticas por cliente/procurador.
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
