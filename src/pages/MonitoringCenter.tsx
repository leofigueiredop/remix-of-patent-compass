import { useCallback, useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, RefreshCcw, WandSparkles, BriefcaseBusiness, Send, CircleCheck, CircleX, Clock3 } from "lucide-react";
import { monitoringService } from "@/services/monitoring";
import { api } from "@/services/auth";
import { toast } from "sonner";
import NewMonitoringWizard from "@/components/monitoring/NewMonitoringWizard";
import { useLocation } from "react-router-dom";
import OperationalPageHeader from "@/components/operations/OperationalPageHeader";

type ClientOption = {
  id: string;
  name: string;
};

type Occurrence = {
  id: string;
  monitoring_type: string;
  monitoring_name: string;
  client_name: string | null;
  patent_number: string | null;
  event_type: string;
  title: string | null;
  summary: string | null;
  priority: "critical" | "high" | "medium" | "low";
  final_score: number;
  status: string;
  ia_status: string;
  client_feedback_status: string;
  created_at: string;
  detail: Record<string, unknown>;
  ia_payload?: Record<string, unknown>;
};

const emptyDashboard = {
  profiles: { totalActive: 0, process: 0, collision: 0, market: 0, assets: 0 },
  occurrences: {
    total: 0,
    critical: 0,
    pendingTriage: 0,
    convertedToDemand: 0,
    sentToClient: 0,
    discarded: 0,
    waitingClientFeedback: 0,
    processingErrors: 0,
  },
  topClients: [] as Array<{ label: string; total: number }>,
  topAttorneys: [] as Array<{ label: string; total: number }>,
  eventsByRpi: [] as Array<{ label: string; total: number }>,
};

function badgeByPriority(priority: string) {
  if (priority === "critical") return "bg-rose-100 text-rose-700 border-rose-200";
  if (priority === "high") return "bg-amber-100 text-amber-700 border-amber-200";
  if (priority === "medium") return "bg-sky-100 text-sky-700 border-sky-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export default function MonitoringCenter() {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [totalOccurrences, setTotalOccurrences] = useState(0);
  const [page, setPage] = useState(1);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [tabType, setTabType] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualRpiNumber, setManualRpiNumber] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [emailPreview, setEmailPreview] = useState<any | null>(null);
  const [wizardPrefill, setWizardPrefill] = useState<Partial<{ patentNumber: string; title: string }>>({});

  const refreshDashboard = useCallback(async () => {
    const [summary, clientsRes] = await Promise.all([
      monitoringService.getDashboard(),
      api.get(`/clients`).catch(() => ({ data: [] })),
    ]);
    setDashboard(summary || emptyDashboard);
    setClients(Array.isArray(clientsRes.data) ? clientsRes.data.map((item: any) => ({ id: item.id, name: item.name })) : []);
  }, []);

  const refreshOccurrences = useCallback(async (targetPage = page) => {
    const data = await monitoringService.listOccurrences({
      page: targetPage,
      pageSize: 30,
      type: tabType === "all" ? undefined : tabType,
      status: statusFilter === "all" ? undefined : statusFilter,
      priority: priorityFilter === "all" ? undefined : priorityFilter,
      q: query || undefined,
    });
    setOccurrences(data?.rows || []);
    setTotalOccurrences(data?.total || 0);
    setPage(data?.page || targetPage);
  }, [page, priorityFilter, query, statusFilter, tabType]);

  const refreshAll = useCallback(async (targetPage = page) => {
    setLoading(true);
    try {
      await Promise.all([refreshDashboard(), refreshOccurrences(targetPage)]);
    } finally {
      setLoading(false);
    }
  }, [page, refreshDashboard, refreshOccurrences]);

  useEffect(() => {
    void refreshAll(1);
  }, [refreshAll, tabType, statusFilter, priorityFilter]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("new") === "1") setWizardOpen(true);
    setWizardPrefill({
      patentNumber: params.get("patent") || "",
      title: params.get("title") || ""
    });
  }, [location.search]);

  const filteredTotalPages = useMemo(() => Math.max(1, Math.ceil(totalOccurrences / 30)), [totalOccurrences]);
  const nextBestAction = useMemo(() => {
    if (dashboard.occurrences.critical > 0) {
      return {
        label: `Priorizar ${dashboard.occurrences.critical} ocorrências críticas`,
        cta: "Filtrar críticos",
        action: () => {
          setPriorityFilter("critical");
          setStatusFilter("pending_triage");
          void refreshOccurrences(1);
        }
      };
    }
    if (dashboard.occurrences.pendingTriage > 0) {
      return {
        label: `Triar ${dashboard.occurrences.pendingTriage} ocorrências pendentes`,
        cta: "Abrir pendências",
        action: () => {
          setStatusFilter("pending_triage");
          void refreshOccurrences(1);
        }
      };
    }
    if (dashboard.occurrences.waitingClientFeedback > 0) {
      return {
        label: `Cobrar retorno de ${dashboard.occurrences.waitingClientFeedback} ocorrências`,
        cta: "Ver feedback pendente",
        action: () => {
          setStatusFilter("awaiting_client_feedback");
          void refreshOccurrences(1);
        }
      };
    }
    return {
      label: "Pipeline estável. Crie novo monitoramento para ampliar cobertura.",
      cta: "Novo monitoramento",
      action: () => setWizardOpen(true)
    };
  }, [dashboard.occurrences.critical, dashboard.occurrences.pendingTriage, dashboard.occurrences.waitingClientFeedback, refreshOccurrences]);

  const runLatestRpi = async () => {
    try {
      setBusyId("rpi");
      const result = await monitoringService.processLatestRpi();
      if (result?.createdOccurrences === undefined) {
        toast.success("RPI mais recente detectada.");
      } else {
        toast.success(`RPI ${result.rpiNumber}: ${result.createdOccurrences} ocorrências geradas.`);
      }
      await refreshAll(1);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Falha no processamento da RPI.");
    } finally {
      setBusyId(null);
    }
  };

  const runManualRpi = async () => {
    if (!manualRpiNumber.trim()) {
      toast.error("Informe o número da RPI para reprocessar.");
      return;
    }
    try {
      setBusyId("rpi-manual");
      const result = await monitoringService.processRpi(manualRpiNumber.trim());
      toast.success(`RPI ${result.rpiNumber}: ${result.createdOccurrences} ocorrências geradas.`);
      await refreshAll(1);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Falha ao processar RPI informada.");
    } finally {
      setBusyId(null);
    }
  };

  const executeAction = async (occurrenceId: string, action: string, payload?: { note?: string; assignee?: string; feedback?: string }) => {
    try {
      setBusyId(`${occurrenceId}:${action}`);
      await monitoringService.applyOccurrenceAction(occurrenceId, action, payload);
      await refreshOccurrences(page);
      await refreshDashboard();
      toast.success("Ação aplicada.");
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Não foi possível aplicar a ação.");
    } finally {
      setBusyId(null);
    }
  };

  const runAi = async (occurrenceId: string) => {
    try {
      setBusyId(`${occurrenceId}:ai`);
      await monitoringService.analyzeOccurrenceWithAi(occurrenceId);
      await refreshOccurrences(page);
      toast.success("Análise IA concluída.");
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Falha na análise IA.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleSelection = (id: string, checked: boolean) => {
    setSelectedIds((prev) => checked ? Array.from(new Set([...prev, id])) : prev.filter((item) => item !== id));
  };

  const convertSelected = async () => {
    if (selectedIds.length === 0) {
      toast.error("Selecione ocorrências para converter.");
      return;
    }
    try {
      setBusyId("bulk-convert");
      const result = await monitoringService.bulkConvertToDemands(selectedIds);
      toast.success(`${result?.created || 0} demandas criadas em lote.`);
      setSelectedIds([]);
      await refreshAll(page);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Falha na conversão em lote.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <OperationalPageHeader
          title="Hub Operacional de Monitoramentos"
          description="Triagem, priorização, análise IA e conversão para demanda em um fluxo único."
          icon={<BriefcaseBusiness className="w-5 h-5 text-slate-600" />}
          actions={
            <>
              <Button variant="outline" onClick={() => refreshAll(page)} disabled={loading} className="h-10">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
              </Button>
              <Button variant="outline" onClick={runLatestRpi} disabled={busyId === "rpi"} className="h-10">
                {busyId === "rpi" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <WandSparkles className="w-4 h-4 mr-2" />}
                Processar RPI mais recente
              </Button>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 bg-white">
                <Input
                  className="h-8 w-28 border-0 p-0 text-sm"
                  placeholder="RPI antiga"
                  value={manualRpiNumber}
                  onChange={(e) => setManualRpiNumber(e.target.value)}
                />
                <Button size="sm" variant="outline" onClick={runManualRpi} disabled={busyId === "rpi-manual"} className="h-9">
                  {busyId === "rpi-manual" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Reprocessar"}
                </Button>
              </div>
              <Button onClick={() => setWizardOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white h-10">
                <Plus className="w-4 h-4 mr-2" />
                Novo Monitoramento
              </Button>
              <Button variant="outline" onClick={convertSelected} disabled={busyId === "bulk-convert"} className="h-10">
                {busyId === "bulk-convert" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <BriefcaseBusiness className="w-4 h-4 mr-2" />}
                Converter selecionadas
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Monit. ativos</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{dashboard.profiles.totalActive}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Críticos</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-rose-600">{dashboard.occurrences.critical}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Aguardando triagem</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{dashboard.occurrences.pendingTriage}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Enviados cliente</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{dashboard.occurrences.sentToClient}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Viraram demanda</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{dashboard.occurrences.convertedToDemand}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Descartados</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{dashboard.occurrences.discarded}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Aguard. feedback</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{dashboard.occurrences.waitingClientFeedback}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Erros IA</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{dashboard.occurrences.processingErrors}</CardContent></Card>
        </div>

        <Card className="border-emerald-200 bg-emerald-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-emerald-900">Próxima ação recomendada</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-emerald-900">{nextBestAction.label}</p>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white w-full sm:w-auto" onClick={nextBestAction.action}>
              {nextBestAction.cta}
            </Button>
          </CardContent>
        </Card>

        <div className="rounded-xl border border-slate-200 p-4 bg-white space-y-3">
          <Tabs value={tabType} onValueChange={setTabType}>
            <TabsList className="w-full justify-start overflow-x-auto whitespace-nowrap">
              <TabsTrigger value="all">Todos</TabsTrigger>
              <TabsTrigger value="process">Processo</TabsTrigger>
              <TabsTrigger value="collision">Colidência</TabsTrigger>
              <TabsTrigger value="market">Mercado</TabsTrigger>
              <TabsTrigger value="assets">Meus Ativos</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cliente, patente, monitoramento..." />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="pending_triage">Aguardando triagem</SelectItem>
                <SelectItem value="in_review">Em revisão</SelectItem>
                <SelectItem value="awaiting_client_feedback">Aguardando cliente</SelectItem>
                <SelectItem value="converted_to_demand">Virou demanda</SelectItem>
                <SelectItem value="discarded">Descartado</SelectItem>
                <SelectItem value="relevant">Relevante</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger><SelectValue placeholder="Prioridade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas prioridades</SelectItem>
                <SelectItem value="critical">Crítico</SelectItem>
                <SelectItem value="high">Alto</SelectItem>
                <SelectItem value="medium">Médio</SelectItem>
                <SelectItem value="low">Baixo</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => refreshOccurrences(1)} className="w-full">Aplicar</Button>
            <Button variant="outline" onClick={() => { setQuery(""); setStatusFilter("all"); setPriorityFilter("all"); setTabType("all"); }} className="w-full">Limpar</Button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="hidden md:grid grid-cols-[0.6fr_1.5fr_1.8fr_2fr_0.9fr_0.8fr_1fr_1fr_2fr] gap-2 px-4 py-2 border-b text-xs uppercase tracking-wide text-slate-500 font-semibold">
            <div>Sel</div>
            <div>Cliente</div>
            <div>Monitoramento</div>
            <div>Item detectado</div>
            <div>Tipo</div>
            <div>Score</div>
            <div>Prioridade</div>
            <div>Status</div>
            <div>Ações</div>
          </div>
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">Carregando ocorrências...</div>
          ) : occurrences.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">Sem ocorrências para os filtros selecionados.</div>
          ) : (
            occurrences.map((row) => (
              <div key={row.id}>
                <div className="hidden md:grid grid-cols-[0.6fr_1.5fr_1.8fr_2fr_0.9fr_0.8fr_1fr_1fr_2fr] gap-2 px-4 py-3 border-b items-center text-sm">
                <div>
                  <input className="h-5 w-5" type="checkbox" checked={selectedIds.includes(row.id)} onChange={(e) => toggleSelection(row.id, e.target.checked)} />
                </div>
                <div>
                  <p className="font-medium text-slate-800">{row.client_name || "Sem cliente"}</p>
                  <p className="text-xs text-slate-500">{new Date(row.created_at).toLocaleString("pt-BR")}</p>
                </div>
                <div>
                  <p className="font-medium">{row.monitoring_name || "-"}</p>
                  <p className="text-xs text-slate-500">{row.patent_number || "-"}</p>
                </div>
                <div>
                  <p className="font-medium">{row.title || "-"}</p>
                  <p className="text-xs text-slate-500 line-clamp-2">{row.summary || "-"}</p>
                </div>
                <div><Badge variant="outline">{row.monitoring_type}</Badge></div>
                <div className="font-semibold">{row.final_score}</div>
                <div><Badge className={badgeByPriority(row.priority)}>{row.priority}</Badge></div>
                <div>
                  <div className="text-xs">{row.status}</div>
                  <div className="text-[11px] text-slate-500">{row.ia_status === "completed" ? "IA ok" : row.ia_status}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => { setSelected(row); setDetailOpen(true); }}>Detalhe</Button>
                  <Button size="sm" variant="outline" onClick={() => runAi(row.id)} disabled={busyId === `${row.id}:ai`}>
                    {busyId === `${row.id}:ai` ? <Loader2 className="w-3 h-3 animate-spin" /> : <WandSparkles className="w-3 h-3" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => executeAction(row.id, "create_demand")} disabled={busyId === `${row.id}:create_demand`}>
                    <BriefcaseBusiness className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={async () => {
                    try {
                      const preview = await monitoringService.getEmailPreview(row.id);
                      setEmailPreview(preview);
                    } catch (error: any) {
                      toast.error(error?.response?.data?.error || "Sem preview disponível");
                    }
                  }}>
                    <Send className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <div className="md:hidden border-b px-3 py-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-800">{row.title || "-"}</p>
                    <p className="text-xs text-slate-500">{row.client_name || "Sem cliente"} • {new Date(row.created_at).toLocaleDateString("pt-BR")}</p>
                  </div>
                  <input className="h-5 w-5" type="checkbox" checked={selectedIds.includes(row.id)} onChange={(e) => toggleSelection(row.id, e.target.checked)} />
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline">{row.monitoring_type}</Badge>
                  <Badge className={badgeByPriority(row.priority)}>{row.priority}</Badge>
                  <Badge variant="outline">Score {row.final_score}</Badge>
                </div>
                <p className="text-xs text-slate-500 line-clamp-2">{row.summary || "-"}</p>
                <div className="grid grid-cols-3 gap-2">
                  <Button size="sm" variant="outline" className="h-9" onClick={() => { setSelected(row); setDetailOpen(true); }}>Detalhe</Button>
                  <Button size="sm" variant="outline" className="h-9" onClick={() => runAi(row.id)} disabled={busyId === `${row.id}:ai`}>
                    {busyId === `${row.id}:ai` ? <Loader2 className="w-3 h-3 animate-spin" /> : <WandSparkles className="w-3 h-3" />}
                  </Button>
                  <Button size="sm" variant="outline" className="h-9" onClick={() => executeAction(row.id, "create_demand")} disabled={busyId === `${row.id}:create_demand`}>
                    <BriefcaseBusiness className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              </div>
            ))
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-3 text-sm">
            <span>Total: {totalOccurrences}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-9" disabled={page <= 1} onClick={() => { const next = Math.max(1, page - 1); void refreshOccurrences(next); }}>
                Anterior
              </Button>
              <span>{page}/{filteredTotalPages}</span>
              <Button variant="outline" size="sm" className="h-9" disabled={page >= filteredTotalPages} onClick={() => { const next = Math.min(filteredTotalPages, page + 1); void refreshOccurrences(next); }}>
                Próxima
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Top clientes por ocorrências</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {dashboard.topClients.length === 0 ? <p className="text-sm text-slate-500">Sem dados.</p> : dashboard.topClients.map((item) => (
                <div key={item.label} className="flex justify-between text-sm"><span>{item.label}</span><strong>{item.total}</strong></div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Top procuradores monitorados</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {dashboard.topAttorneys.length === 0 ? <p className="text-sm text-slate-500">Sem dados.</p> : dashboard.topAttorneys.map((item) => (
                <div key={item.label} className="flex justify-between text-sm"><span>{item.label}</span><strong>{item.total}</strong></div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Eventos por RPI</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {dashboard.eventsByRpi.length === 0 ? <p className="text-sm text-slate-500">Sem dados.</p> : dashboard.eventsByRpi.map((item) => (
                <div key={item.label} className="flex justify-between text-sm"><span>{item.label}</span><strong>{item.total}</strong></div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Detalhe da Ocorrência</DialogTitle>
            </DialogHeader>
            {selected && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{selected.monitoring_type}</Badge>
                  <Badge className={badgeByPriority(selected.priority)}>{selected.priority}</Badge>
                  <Badge variant="outline">Score {selected.final_score}</Badge>
                  <Badge variant="outline">{selected.status}</Badge>
                  <Badge variant="outline">{selected.client_feedback_status}</Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border p-3">
                    <div className="text-xs uppercase text-slate-500 mb-1">Contexto</div>
                    <p><strong>Cliente:</strong> {selected.client_name || "Sem cliente"}</p>
                    <p><strong>Monitoramento:</strong> {selected.monitoring_name}</p>
                    <p><strong>Patente:</strong> {selected.patent_number || "-"}</p>
                    <p><strong>Evento:</strong> {selected.event_type}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs uppercase text-slate-500 mb-1">Resumo</div>
                    <p className="font-medium">{selected.title || "-"}</p>
                    <p className="text-slate-600 mt-1">{selected.summary || "-"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Button variant="outline" onClick={() => executeAction(selected.id, "mark_relevant")}><CircleCheck className="w-4 h-4 mr-2" />Marcar relevante</Button>
                  <Button variant="outline" onClick={() => executeAction(selected.id, "mark_irrelevant")}><CircleX className="w-4 h-4 mr-2" />Descartar</Button>
                  <Button variant="outline" onClick={() => executeAction(selected.id, "defer")}><Clock3 className="w-4 h-4 mr-2" />Revisar depois</Button>
                  <Button variant="outline" onClick={() => executeAction(selected.id, "send_client")}><Send className="w-4 h-4 mr-2" />Enviar ao cliente</Button>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-slate-500 mb-2">Análise IA</p>
                  <pre className="text-xs whitespace-pre-wrap text-slate-700">{JSON.stringify(selected.ia_payload || {}, null, 2)}</pre>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs uppercase text-slate-500 mb-2">Detalhe técnico</p>
                  <pre className="text-xs whitespace-pre-wrap text-slate-700">{JSON.stringify(selected.detail || {}, null, 2)}</pre>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(emailPreview)} onOpenChange={(open) => { if (!open) setEmailPreview(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Preview de Envio ao Cliente</DialogTitle>
            </DialogHeader>
            {emailPreview && (
              <div className="space-y-3">
                <p className="text-sm"><strong>Destinatário:</strong> {emailPreview.recipient?.name} ({emailPreview.recipient?.email})</p>
                <p className="text-sm"><strong>Assunto:</strong> {emailPreview.subject}</p>
                <div className="rounded border p-3 text-sm whitespace-pre-wrap">{emailPreview.body}</div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <NewMonitoringWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          onCreated={async () => {
            await refreshAll(1);
          }}
          clients={clients}
          prefill={wizardPrefill}
        />
      </div>
    </AppLayout>
  );
}
