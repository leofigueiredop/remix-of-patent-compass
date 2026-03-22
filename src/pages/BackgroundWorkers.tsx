import { useEffect, useMemo, useState, type ReactNode } from "react";
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Clock, CheckCircle2, AlertCircle, FileDown, Files, PauseCircle, PlayCircle, Settings, Layers3, Loader2, CheckCheck } from "lucide-react";
import { api } from "@/services/auth";

type RpiJob = {
  id: string;
  rpi_number: number;
  status: string;
  source?: string | null;
  attempts: number;
  imported_count: number;
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

type DocJob = {
  id: string;
  patent_id: string;
  publication_number?: string | null;
  status: string;
  attempts: number;
  storage_key?: string | null;
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  source?: string | null;
  patent?: {
    numero_publicacao?: string | null;
    title?: string | null;
    status?: string | null;
  };
};

type QueuePayload = {
  rpi: {
    processing: RpiJob[];
    success: RpiJob[];
    errors: RpiJob[];
    counts?: {
      processing: number;
      success: number;
      errors: number;
    };
  };
  docs: {
    processing: DocJob[];
    success: DocJob[];
    errors: DocJob[];
    counts?: {
      processing: number;
      success: number;
      errors: number;
    };
  };
  ops: {
    processing: OpsJob[];
    success: OpsJob[];
    errors: OpsJob[];
    counts?: {
      processing: number;
      success: number;
      errors: number;
    };
  };
  inpi: {
    processing: InpiJob[];
    success: InpiJob[];
    errors: InpiJob[];
    counts?: {
      processing: number;
      success: number;
      errors: number;
    };
  };
  bigquery: {
    processing: OpsJob[];
    success: OpsJob[];
    errors: OpsJob[];
    counts?: {
      processing: number;
      success: number;
      errors: number;
    };
  };
};

type OpsJob = {
  id: string;
  patent_number: string;
  rpi_number?: number | null;
  status: string;
  attempts: number;
  docdb_id?: string | null;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  source?: string | null;
};

type WorkerState = {
  rpiPaused: boolean;
  docsPaused: boolean;
  opsPaused: boolean;
  inpiPaused: boolean;
  bqPaused: boolean;
  rpiRunning: boolean;
  docRunning: boolean;
  opsRunning: boolean;
  inpiRunning: boolean;
  inpiTextRunning?: boolean;
  inpiDocRunning?: boolean;
  bqRunning: boolean;
  bigQueryEnabled?: boolean;
  bigQueryProject?: string | null;
  bigQueryFirstEnabled?: boolean;
  googlePatentsEnabled?: boolean;
  googlePatentsCircuitOpen?: boolean;
  googlePatentsCircuitOpenUntil?: string | null;
  googlePatentsMetrics?: {
    requests?: number;
    success?: number;
    failures?: number;
    retries?: number;
    circuitOpens?: number;
    shortPdfRejected?: number;
    invalidBucketDeleted?: number;
  };
};

type InpiJob = {
  id: string;
  patent_number: string;
  priority: number;
  status: string;
  attempts: number;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  source?: string | null;
};

const initialData: QueuePayload = {
  rpi: { processing: [], success: [], errors: [] },
  docs: { processing: [], success: [], errors: [] },
  ops: { processing: [], success: [], errors: [] },
  inpi: { processing: [], success: [], errors: [] },
  bigquery: { processing: [], success: [], errors: [] }
};

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function statusBadge(status: string) {
  if (status === "running" || status === "running_google_patents" || status === "running_ops") return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Processando</Badge>;
  if (status === "pending_google_patents") return <Badge className="bg-indigo-500/10 text-indigo-600 border-indigo-500/20">Pendente GP</Badge>;
  if (status === "pending_ops") return <Badge className="bg-violet-500/10 text-violet-600 border-violet-500/20">Pendente OPS</Badge>;
  if (status === "waiting_inpi_text") return <Badge className="bg-cyan-500/10 text-cyan-700 border-cyan-500/20">Aguardando INPI Text</Badge>;
  if (status === "waiting_inpi") return <Badge className="bg-orange-500/10 text-orange-700 border-orange-500/20">Aguardando INPI Doc</Badge>;
  if (status === "pending") return <Badge variant="secondary">Pendente</Badge>;
  if (status === "completed") return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Sucesso</Badge>;
  if (status === "skipped_sigilo") return <Badge variant="outline">Sigilo</Badge>;
  if (status === "not_found") return <Badge variant="destructive">Sem Documento</Badge>;
  if (status === "waiting_indexing") return <Badge variant="outline">Aguardando Indexação</Badge>;
  if (status === "failed_google_patents") return <Badge variant="destructive">Erro GP</Badge>;
  if (status === "failed_ops") return <Badge variant="destructive">Erro OPS</Badge>;
  if (status === "failed_permanent") return <Badge variant="destructive">Erro Permanente</Badge>;
  if (status === "failed") return <Badge variant="destructive">Erro</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function sourceLabel(value?: string | null) {
  if (!value) return "-";
  if (value === "google_bigquery") return "Google Patents";
  if (value === "google_patents") return "Google Patents";
  if (value === "ops_api") return "OPS";
  if (value === "inpi") return "INPI";
  if (value === "bucket") return "Bucket";
  if (value === "rpi_xml") return "RPI XML";
  return value;
}

function queueBadge(paused: boolean, running: boolean) {
  if (paused) return <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">Pausada</Badge>;
  if (running) return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Executando</Badge>;
  return <Badge variant="secondary">Ociosa</Badge>;
}

function MetricCard({
  title,
  value,
  icon,
  tone = "default"
}: {
  title: string;
  value: number;
  icon: ReactNode;
  tone?: "default" | "success" | "danger";
}) {
  const valueClass = tone === "success" ? "text-emerald-600" : tone === "danger" ? "text-red-600" : "text-slate-900";
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className={`text-2xl flex items-center gap-2 ${valueClass}`}>
          {icon}
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

function RpiTable({ rows, onRetry }: { rows: RpiJob[]; onRetry?: (id: string) => void }) {
  if (rows.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">Sem registros.</div>;
  }
  return (
    <div className="rounded-xl border border-slate-200 overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>RPI</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Tentativas</TableHead>
          <TableHead>Importadas</TableHead>
          <TableHead>Fonte</TableHead>
          <TableHead>Início</TableHead>
          <TableHead>Fim</TableHead>
          <TableHead>Log</TableHead>
          <TableHead className="text-right">Ação</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono">{row.rpi_number}</TableCell>
            <TableCell>{statusBadge(row.status)}</TableCell>
            <TableCell>{row.attempts}</TableCell>
            <TableCell>{row.imported_count}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{sourceLabel(row.source)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(row.started_at)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(row.finished_at)}</TableCell>
            <TableCell className="text-xs text-muted-foreground max-w-[360px] truncate" title={row.error || ""}>{row.error || "-"}</TableCell>
            <TableCell className="text-right">
              {onRetry && (row.status === "failed") && (
                <Button size="sm" variant="outline" onClick={() => onRetry(row.id)}>Reprocessar</Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </div>
  );
}

function DocsTable({ rows, onRetry }: { rows: DocJob[]; onRetry?: (id: string) => void }) {
  if (rows.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">Sem registros.</div>;
  }
  return (
    <div className="rounded-xl border border-slate-200 overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Patente</TableHead>
          <TableHead>Título</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Tentativas</TableHead>
          <TableHead>Storage Key</TableHead>
          <TableHead>Fonte</TableHead>
          <TableHead>Log</TableHead>
          <TableHead>Fim</TableHead>
          <TableHead className="text-right">Ação</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono text-xs">{row.publication_number || row.patent?.numero_publicacao || row.patent_id}</TableCell>
            <TableCell className="max-w-[280px] truncate" title={row.patent?.title || ""}>{row.patent?.title || "-"}</TableCell>
            <TableCell>{statusBadge(row.status)}</TableCell>
            <TableCell>{row.attempts}</TableCell>
            <TableCell className="font-mono text-[11px] max-w-[280px] truncate" title={row.storage_key || ""}>{row.storage_key || "-"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{sourceLabel(row.source)}</TableCell>
            <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate" title={row.error || ""}>{row.error || "-"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(row.finished_at)}</TableCell>
            <TableCell className="text-right">
              <div className="flex gap-2 justify-end">
                {onRetry && ["failed", "failed_google_patents", "failed_ops", "failed_permanent", "not_found", "waiting_inpi", "pending_ops"].includes(row.status) && (
                  <Button size="sm" variant="outline" onClick={() => onRetry(row.id)}>Reprocessar</Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </div>
  );
}

function OpsTable({ rows, onRetry }: { rows: OpsJob[]; onRetry?: (id: string) => void }) {
  if (rows.length === 0) return <div className="p-8 text-sm text-muted-foreground">Sem registros.</div>;
  return (
    <div className="rounded-xl border border-slate-200 overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Número</TableHead>
          <TableHead>RPI</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Tentativas</TableHead>
          <TableHead>DOCDB</TableHead>
          <TableHead>Fonte</TableHead>
          <TableHead>Log</TableHead>
          <TableHead>Fim</TableHead>
          <TableHead className="text-right">Ação</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono text-xs">{row.patent_number}</TableCell>
            <TableCell className="font-mono text-xs">{row.rpi_number ?? "-"}</TableCell>
            <TableCell>{statusBadge(row.status)}</TableCell>
            <TableCell>{row.attempts}</TableCell>
            <TableCell className="font-mono text-[11px]">{row.docdb_id || "-"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{sourceLabel(row.source)}</TableCell>
            <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate" title={row.error || ""}>{row.error || "-"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(row.finished_at)}</TableCell>
            <TableCell className="text-right">
              <div className="flex gap-2 justify-end">
                {onRetry && ["failed", "failed_permanent", "not_found"].includes(row.status) && (
                  <Button size="sm" variant="outline" onClick={() => onRetry(row.id)}>Reprocessar</Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </div>
  );
}

function InpiTable({ rows, onRetry }: { rows: InpiJob[]; onRetry?: (id: string) => void }) {
  if (rows.length === 0) return <div className="p-8 text-sm text-muted-foreground">Sem registros.</div>;
  return (
    <div className="rounded-xl border border-slate-200 overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Patente</TableHead>
          <TableHead>Prioridade</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Tentativas</TableHead>
          <TableHead>Fonte</TableHead>
          <TableHead>Início</TableHead>
          <TableHead>Fim</TableHead>
          <TableHead>Log</TableHead>
          <TableHead className="text-right">Ação</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono text-xs">{row.patent_number}</TableCell>
            <TableCell>{row.priority}</TableCell>
            <TableCell>{statusBadge(row.status)}</TableCell>
            <TableCell>{row.attempts}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{sourceLabel(row.source)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(row.started_at)}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(row.finished_at)}</TableCell>
            <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate" title={row.error || ""}>{row.error || "-"}</TableCell>
            <TableCell className="text-right">
              <div className="flex gap-2 justify-end">
                {onRetry && ["failed", "failed_permanent"].includes(row.status) && (
                  <Button size="sm" variant="outline" onClick={() => onRetry(row.id)}>Reprocessar</Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </div>
  );
}

export default function BackgroundWorkers() {
  const [data, setData] = useState<QueuePayload>(initialData);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<WorkerState>({
    rpiPaused: false,
    docsPaused: false,
    opsPaused: false,
    inpiPaused: false,
    bqPaused: false,
    rpiRunning: false,
    docRunning: false,
    opsRunning: false,
    inpiRunning: false,
    bqRunning: false
  });
  const [mainTab, setMainTab] = useState("rpi");
  const [rpiTab, setRpiTab] = useState("processing");
  const [docsTab, setDocsTab] = useState("processing");
  const [opsTab, setOpsTab] = useState("processing");
  const [inpiTab, setInpiTab] = useState("processing");
  const [enqueueFrom, setEnqueueFrom] = useState("");
  const [enqueueTo, setEnqueueTo] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterCodes, setFilterCodes] = useState("");
  const [filterTarget, setFilterTarget] = useState<"all" | "docs" | "ops">("all");
  const [actionMessage, setActionMessage] = useState("");

  const counters = useMemo(() => ({
    rpiProcessing: data.rpi.counts?.processing ?? data.rpi.processing.length,
    rpiSuccess: data.rpi.counts?.success ?? data.rpi.success.length,
    rpiErrors: data.rpi.counts?.errors ?? data.rpi.errors.length,
    docsProcessing: data.docs.counts?.processing ?? data.docs.processing.length,
    docsSuccess: data.docs.counts?.success ?? data.docs.success.length,
    docsErrors: data.docs.counts?.errors ?? data.docs.errors.length,
    opsProcessing: data.ops.counts?.processing ?? data.ops.processing.length,
    opsSuccess: data.ops.counts?.success ?? data.ops.success.length,
    opsErrors: data.ops.counts?.errors ?? data.ops.errors.length,
    inpiProcessing: data.inpi.counts?.processing ?? data.inpi.processing.length,
    inpiSuccess: data.inpi.counts?.success ?? data.inpi.success.length,
    inpiErrors: data.inpi.counts?.errors ?? data.inpi.errors.length
  }), [data]);

  const allPaused = state.rpiPaused && state.docsPaused && state.opsPaused && state.inpiPaused && state.bqPaused;
  const anyRunning = state.rpiRunning || state.docRunning || state.opsRunning || state.inpiRunning || state.bqRunning || state.inpiTextRunning || state.inpiDocRunning;
  const docsStageCounters = useMemo(() => {
    const rows = [...data.docs.processing, ...data.docs.errors];
    const byStatus = (statuses: string[]) => rows.filter((row) => statuses.includes(row.status)).length;
    return {
      gp: byStatus(["pending_google_patents", "running_google_patents", "failed_google_patents"]),
      ops: byStatus(["pending_ops", "running_ops", "failed_ops"]),
      inpi: byStatus(["waiting_inpi_text", "waiting_inpi"])
    };
  }, [data.docs.processing, data.docs.errors]);

  const fetchQueues = async () => {
    setLoading(true);
    try {
      const [queues, workerState] = await Promise.all([
        api.get(`/background-workers/queues?limit=120`),
        api.get(`/background-workers/state`)
      ]);
      setData(queues.data);
      setState(workerState.data);
    } finally {
      setLoading(false);
    }
  };

  const bootstrapRpi = async () => {
    setLoading(true);
    try {
      await api.post(`/background-workers/rpi/bootstrap`);
      await fetchQueues();
    } finally {
      setLoading(false);
    }
  };

  const controlWorkers = async (queue: "rpi" | "docs" | "ops" | "inpi" | "bigquery" | "all", action: "pause" | "resume") => {
    setLoading(true);
    try {
      await api.post(`/background-workers/control`, { queue, action });
      await fetchQueues();
    } finally {
      setLoading(false);
    }
  };

  const retryRpiJob = async (id: string) => {
    await api.post(`/background-workers/rpi/retry/${id}`);
    await fetchQueues();
  };

  const retryDocsJob = async (id: string) => {
    await api.post(`/background-workers/docs/retry/${id}`);
    await fetchQueues();
  };

  const retryOpsJob = async (id: string) => {
    await api.post(`/background-workers/ops/retry/${id}`, { preferBigQuery: false });
    await fetchQueues();
  };

  const retryInpiJob = async (id: string) => {
    await api.post(`/background-workers/inpi/retry/${id}`);
    await fetchQueues();
  };

  const retryAllRpiErrors = async (preferBigQuery = false) => {
    setLoading(true);
    try {
      const ids = data.rpi.errors.map((row) => row.id);
      const response = await api.post(`/background-workers/rpi/retry-errors`, { ids, preferBigQuery });
      setActionMessage(`RPI reprocessadas: ${response.data?.updated ?? 0}`);
      await fetchQueues();
    } finally {
      setLoading(false);
    }
  };

  const retryAllDocsErrors = async () => {
    setLoading(true);
    try {
      const response = await api.post(`/background-workers/docs/retry-errors`, {});
      setActionMessage(`Docs reenfileirados (erro + processando): ${response.data?.updated ?? 0}`);
      await fetchQueues();
    } finally {
      setLoading(false);
    }
  };

  const retryAllOpsErrors = async (preferBigQuery = false) => {
    setLoading(true);
    try {
      const ids = data.ops.errors.map((row) => row.id);
      const response = await api.post(`/background-workers/ops/retry-errors`, { ids, preferBigQuery });
      setActionMessage(`OPS reprocessados: ${response.data?.updated ?? 0}`);
      await fetchQueues();
    } finally {
      setLoading(false);
    }
  };

  const retryAllInpiErrors = async () => {
    setLoading(true);
    try {
      const ids = data.inpi.errors.map((row) => row.id);
      const response = await api.post(`/background-workers/inpi/retry-errors`, { ids });
      setActionMessage(`INPI reprocessados: ${response.data?.updated ?? 0}`);
      await fetchQueues();
    } finally {
      setLoading(false);
    }
  };

  const enqueueRange = async () => {
    const from = Number.parseInt(enqueueFrom, 10);
    const to = Number.parseInt(enqueueTo, 10);
    setLoading(true);
    try {
      const response = await api.post(`/background-workers/rpi/enqueue-range`, { from, to });
      setActionMessage(`RPIs enfileiradas: ${response.data.created}/${response.data.requested} (${response.data.from} até ${response.data.to})`);
      await fetchQueues();
    } catch (error: any) {
      setActionMessage(error?.response?.data?.error || "Falha ao enfileirar intervalo de RPI");
    } finally {
      setLoading(false);
    }
  };

  const enqueueByFilter = async () => {
    const rpiFrom = filterFrom ? Number.parseInt(filterFrom, 10) : undefined;
    const rpiTo = filterTo ? Number.parseInt(filterTo, 10) : undefined;
    setLoading(true);
    try {
      const response = await api.post(`/background-workers/requeue-by-filter`, {
        rpiFrom,
        rpiTo,
        dispatchCodes: filterCodes,
        target: filterTarget
      });
      setActionMessage(`Filtro aplicado: ${response.data.selectedRows} registros, docs=${response.data.docsQueued}, ops=${response.data.opsQueued}`);
      await fetchQueues();
    } catch (error: any) {
      setActionMessage(error?.response?.data?.error || "Falha ao enfileirar por filtro");
    } finally {
      setLoading(false);
    }
  };

  const clearProcessingAndErrors = async () => {
    if (!window.confirm("Limpar listas de erros e processando das filas RPI/Docs/OPS?")) return;
    setLoading(true);
    try {
      const response = await api.post(`/background-workers/clear-active-errors`);
      setActionMessage(`Listas limpas: RPI=${response.data.rpiDeleted}, Docs=${response.data.docsDeleted}, OPS=${response.data.opsDeleted}`);
      await fetchQueues();
    } catch (error: any) {
      setActionMessage(error?.response?.data?.error || "Falha ao limpar listas");
    } finally {
      setLoading(false);
    }
  };

  const reprocessAllFiveYears = async () => {
    if (!window.confirm("Reprocessar tudo (5 anos) e limpar erros/processando atuais?")) return;
    setLoading(true);
    try {
      const response = await api.post(`/background-workers/reprocess-all`);
      const enqueued = response.data.enqueued || {};
      setActionMessage(`Reprocessamento iniciado: RPI ${enqueued.from}→${enqueued.to} (${enqueued.count} enfileiradas)`);
      await fetchQueues();
    } catch (error: any) {
      setActionMessage(error?.response?.data?.error || "Falha ao iniciar reprocessamento total");
    } finally {
      setLoading(false);
    }
  };

  const reprocessShortDocs = async () => {
    if (!window.confirm("Reprocessar documentos concluídos com PDF curto (1 página)?")) return;
    setLoading(true);
    try {
      const response = await api.post(`/background-workers/google-patents/reprocess-short-docs`, {
        limit: 1000,
        maxPages: 1
      });
      setActionMessage(`PDFs curtos verificados: ${response.data?.scanned ?? 0}, reprocessados: ${response.data?.requeued ?? 0}`);
      await fetchQueues();
    } catch (error: any) {
      setActionMessage(error?.response?.data?.error || "Falha ao reprocessar PDFs curtos");
    } finally {
      setLoading(false);
    }
  };

  const enqueueAllProcessedDocs = async () => {
    if (!window.confirm("Enfileirar todas as patentes já processadas para auditoria completa de documento?")) return;
    setLoading(true);
    try {
      const response = await api.post(`/background-workers/google-patents/enqueue-all-processed`, {
        batchSize: 2000
      });
      setActionMessage(`Patentes varridas: ${response.data?.scanned ?? 0}, jobs atualizados: ${response.data?.queued ?? 0}`);
      await fetchQueues();
    } catch (error: any) {
      setActionMessage(error?.response?.data?.error || "Falha ao enfileirar patentes processadas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueues();
    const timer = setInterval(() => fetchQueues(), 8000);
    return () => clearInterval(timer);
  }, []);

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 w-full mx-auto">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="animate-in fade-in slide-in-from-left duration-700">
            <h1 className="text-2xl font-bold flex items-center gap-3 text-slate-900 mb-2">
                <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                    <Settings className="w-5 h-5 text-slate-600" />
                </div>
                Workflows de Background
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Painel operacional de filas com cadeia INPI Text → Google Patents → OPS → INPI Doc.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap animate-in fade-in zoom-in-95 duration-500">
            <Button
              variant="outline"
              onClick={() => controlWorkers("all", allPaused ? "resume" : "pause")}
              disabled={loading}
              className="gap-2 h-10 text-sm bg-white w-full sm:w-auto"
            >
              {allPaused ? <PlayCircle className="w-3.5 h-3.5 text-emerald-600" /> : <PauseCircle className="w-3.5 h-3.5 text-amber-600" />}
              {allPaused ? "Retomar Workers" : "Pausar Workers"}
            </Button>
            <Button variant="outline" onClick={bootstrapRpi} disabled={loading} className="gap-2 h-10 text-sm bg-white w-full sm:w-auto">
              <Files className="w-3.5 h-3.5" />
              Enfileirar 5 anos de RPI
            </Button>
            <Button variant="outline" onClick={clearProcessingAndErrors} disabled={loading} className="gap-2 h-10 text-sm bg-white text-red-600 hover:text-red-700 hover:bg-red-50 w-full sm:w-auto">
              Limpar Erros/Processando
            </Button>
            <Button variant="default" onClick={reprocessAllFiveYears} disabled={loading} className="gap-2 h-10 text-sm bg-slate-900 text-white hover:bg-slate-800 w-full sm:w-auto">
              Reprocessar Tudo (5 anos)
            </Button>
            <Button variant="outline" onClick={enqueueAllProcessedDocs} disabled={loading} className="gap-2 h-10 text-sm bg-white w-full sm:w-auto">
              Auditar todas as patentes processadas
            </Button>
            <Button variant="outline" onClick={fetchQueues} disabled={loading} className="gap-2 h-10 text-sm bg-white w-full sm:w-auto">
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500 mb-1">Estado global</div>
              <div className="flex items-center gap-2">
                {anyRunning ? <Loader2 className="w-4 h-4 animate-spin text-blue-600" /> : <CheckCheck className="w-4 h-4 text-emerald-600" />}
                <span className="text-sm font-medium text-slate-800">{anyRunning ? "Workers ativos" : "Sem execução ativa"}</span>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500 mb-1">Fila Docs por etapa</div>
              <div className="text-sm text-slate-800">GP {docsStageCounters.gp} • OPS {docsStageCounters.ops} • INPI {docsStageCounters.inpi}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500 mb-1">Google Patents</div>
              <div className="text-sm text-slate-800">Req {state.googlePatentsMetrics?.requests ?? 0} • Retry {state.googlePatentsMetrics?.retries ?? 0}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500 mb-1">Qualidade de PDF</div>
              <div className="text-sm text-slate-800">Curto {state.googlePatentsMetrics?.shortPdfRejected ?? 0} • Limpeza {state.googlePatentsMetrics?.invalidBucketDeleted ?? 0}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {queueBadge(state.rpiPaused, state.rpiRunning)}
            <Badge variant="outline" className="border-slate-300">RPI</Badge>
            {queueBadge(state.docsPaused, state.docRunning)}
            <Badge variant="outline" className="border-slate-300">Docs</Badge>
            {queueBadge(state.opsPaused, state.opsRunning)}
            <Badge variant="outline" className="border-slate-300">OPS</Badge>
            {queueBadge(state.inpiPaused, state.inpiRunning || Boolean(state.inpiTextRunning) || Boolean(state.inpiDocRunning))}
            <Badge variant="outline" className="border-slate-300">INPI (Text {state.inpiTextRunning ? "ON" : "OFF"} • Doc {state.inpiDocRunning ? "ON" : "OFF"})</Badge>
            <Badge variant={state.bigQueryEnabled ? "default" : "secondary"}>BQ {state.bigQueryEnabled ? "ON" : "OFF"}</Badge>
            <Badge variant={state.googlePatentsEnabled ? "default" : "secondary"}>Google Patents {state.googlePatentsEnabled ? "ON" : "OFF"}</Badge>
            <Badge variant={state.googlePatentsCircuitOpen ? "destructive" : "secondary"}>Circuito GP {state.googlePatentsCircuitOpen ? "ABERTO" : "OK"}</Badge>
          </div>
        </div>

        <Tabs value={mainTab} onValueChange={setMainTab} className="animate-in fade-in duration-500">
          <Card>
            <CardHeader>
              <CardTitle>Enfileiramento por Filtro</CardTitle>
              <CardDescription>Use a interface para enfileirar RPIs e jobs sem usar terminal.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <Input
                  placeholder="RPI de"
                  value={enqueueFrom}
                  onChange={(event) => setEnqueueFrom(event.target.value)}
                />
                <Input
                  placeholder="RPI até"
                  value={enqueueTo}
                  onChange={(event) => setEnqueueTo(event.target.value)}
                />
                <Button onClick={enqueueRange} disabled={loading} className="md:col-span-2">
                  Enfileirar intervalo RPI
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                <Input
                  placeholder="Filtro RPI de"
                  value={filterFrom}
                  onChange={(event) => setFilterFrom(event.target.value)}
                />
                <Input
                  placeholder="Filtro RPI até"
                  value={filterTo}
                  onChange={(event) => setFilterTo(event.target.value)}
                />
                <Input
                  placeholder="Códigos despacho (ex: 3.1,16.1)"
                  value={filterCodes}
                  onChange={(event) => setFilterCodes(event.target.value)}
                  className="md:col-span-2"
                />
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={filterTarget}
                  onChange={(event) => setFilterTarget(event.target.value as "all" | "docs" | "ops")}
                >
                  <option value="all">Docs + OPS</option>
                  <option value="docs">Só Docs</option>
                  <option value="ops">Só OPS</option>
                </select>
                <Button onClick={enqueueByFilter} disabled={loading}>
                  Enfileirar por filtro
                </Button>
              </div>
              {actionMessage && (
                <div className="text-xs text-muted-foreground">{actionMessage}</div>
              )}
            </CardContent>
          </Card>
          <TabsList className="w-full justify-start overflow-x-auto whitespace-nowrap bg-slate-100 p-1">
            <TabsTrigger value="rpi" className="gap-2">
              <Files className="w-4 h-4" />
              Fila RPI <span className="text-xs text-muted-foreground">({counters.rpiProcessing + counters.rpiErrors})</span>
            </TabsTrigger>
            <TabsTrigger value="docs" className="gap-2">
              <FileDown className="w-4 h-4" />
              Fila Docs <span className="text-xs text-muted-foreground">({counters.docsProcessing + counters.docsErrors})</span>
            </TabsTrigger>
            <TabsTrigger value="ops" className="gap-2">
              <Layers3 className="w-4 h-4" />
              Fila OPS <span className="text-xs text-muted-foreground">({counters.opsProcessing + counters.opsErrors})</span>
            </TabsTrigger>
            <TabsTrigger value="inpi" className="gap-2">
              <Files className="w-4 h-4" />
              Fila INPI <span className="text-xs text-muted-foreground">({counters.inpiProcessing + counters.inpiErrors})</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rpi" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MetricCard title="Processando" value={counters.rpiProcessing} icon={<Clock className="w-5 h-5" />} />
              <MetricCard title="Sucesso" value={counters.rpiSuccess} icon={<CheckCircle2 className="w-5 h-5" />} tone="success" />
              <MetricCard title="Erros" value={counters.rpiErrors} icon={<AlertCircle className="w-5 h-5" />} tone="danger" />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Fila RPI</CardTitle>
                <CardDescription>Uma RPI por vez, mantendo histórico de sucesso e falhas.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={rpiTab} onValueChange={setRpiTab}>
                  <TabsList className="w-full justify-start overflow-x-auto whitespace-nowrap">
                    <TabsTrigger value="processing">Processando</TabsTrigger>
                    <TabsTrigger value="success">Sucesso</TabsTrigger>
                    <TabsTrigger value="errors">Erros</TabsTrigger>
                  </TabsList>
                  <TabsContent value="processing"><RpiTable rows={data.rpi.processing} /></TabsContent>
                  <TabsContent value="success"><RpiTable rows={data.rpi.success} /></TabsContent>
                  <TabsContent value="errors" className="space-y-3">
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" disabled={loading || data.rpi.errors.length === 0} onClick={() => retryAllRpiErrors()}>
                        Reprocessar todos os erros
                      </Button>
                    </div>
                    <RpiTable rows={data.rpi.errors} onRetry={retryRpiJob} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="docs" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MetricCard title="Processando" value={counters.docsProcessing} icon={<Clock className="w-5 h-5" />} />
              <MetricCard title="Sucesso" value={counters.docsSuccess} icon={<CheckCircle2 className="w-5 h-5" />} tone="success" />
              <MetricCard title="Erros/Logs" value={counters.docsErrors} icon={<AlertCircle className="w-5 h-5" />} tone="danger" />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Fila de Documentos</CardTitle>
                <CardDescription>Somente patentes sem sigilo. Falhas e sem-documento ficam registradas para consulta.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={docsTab} onValueChange={setDocsTab}>
                  <TabsList className="w-full justify-start overflow-x-auto whitespace-nowrap">
                    <TabsTrigger value="processing">Processando</TabsTrigger>
                    <TabsTrigger value="success">Sucesso</TabsTrigger>
                    <TabsTrigger value="errors">Erros</TabsTrigger>
                  </TabsList>
                  <TabsContent value="processing"><DocsTable rows={data.docs.processing} /></TabsContent>
                  <TabsContent value="success"><DocsTable rows={data.docs.success} /></TabsContent>
                  <TabsContent value="errors" className="space-y-3">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={loading} onClick={reprocessShortDocs}>
                        Reprocessar docs 1 página
                      </Button>
                      <Button variant="outline" size="sm" disabled={loading} onClick={() => retryAllDocsErrors()}>
                        Reenfileirar erro + processando
                      </Button>
                    </div>
                    <DocsTable rows={data.docs.errors} onRetry={retryDocsJob} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ops" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MetricCard title="Processando" value={counters.opsProcessing} icon={<Clock className="w-5 h-5" />} />
              <MetricCard title="Sucesso" value={counters.opsSuccess} icon={<CheckCircle2 className="w-5 h-5" />} tone="success" />
              <MetricCard title="Erros/Logs" value={counters.opsErrors} icon={<AlertCircle className="w-5 h-5" />} tone="danger" />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Fila Bibliográfica OPS</CardTitle>
                <CardDescription>Enriquecimento bibliográfico para despachos que não são 3.1/16.1/1.3.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={opsTab} onValueChange={setOpsTab}>
                  <TabsList className="w-full justify-start overflow-x-auto whitespace-nowrap">
                    <TabsTrigger value="processing">Processando</TabsTrigger>
                    <TabsTrigger value="success">Sucesso</TabsTrigger>
                    <TabsTrigger value="errors">Erros</TabsTrigger>
                  </TabsList>
                  <TabsContent value="processing"><OpsTable rows={data.ops.processing} /></TabsContent>
                  <TabsContent value="success"><OpsTable rows={data.ops.success} /></TabsContent>
                  <TabsContent value="errors" className="space-y-3">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={loading || data.ops.errors.length === 0} onClick={() => retryAllOpsErrors(false)}>
                        Reprocessar todos (Google Patents)
                      </Button>
                    </div>
                    <OpsTable rows={data.ops.errors} onRetry={retryOpsJob} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="inpi" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MetricCard title="Processando" value={counters.inpiProcessing} icon={<Clock className="w-5 h-5" />} />
              <MetricCard title="Sucesso" value={counters.inpiSuccess} icon={<CheckCircle2 className="w-5 h-5" />} tone="success" />
              <MetricCard title="Erros" value={counters.inpiErrors} icon={<AlertCircle className="w-5 h-5" />} tone="danger" />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Fila INPI</CardTitle>
                <CardDescription>Coleta primária do INPI antes do enriquecimento.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={inpiTab} onValueChange={setInpiTab}>
                  <TabsList className="w-full justify-start overflow-x-auto whitespace-nowrap">
                    <TabsTrigger value="processing">Processando</TabsTrigger>
                    <TabsTrigger value="success">Sucesso</TabsTrigger>
                    <TabsTrigger value="errors">Erros</TabsTrigger>
                  </TabsList>
                  <TabsContent value="processing"><InpiTable rows={data.inpi.processing} /></TabsContent>
                  <TabsContent value="success"><InpiTable rows={data.inpi.success} /></TabsContent>
                  <TabsContent value="errors" className="space-y-3">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={loading || data.inpi.errors.length === 0} onClick={() => retryAllInpiErrors()}>
                        Reprocessar todos os erros
                      </Button>
                    </div>
                    <InpiTable rows={data.inpi.errors} onRetry={retryInpiJob} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
