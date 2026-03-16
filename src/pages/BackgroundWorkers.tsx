import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Clock, CheckCircle2, AlertCircle, FileDown, Files, PauseCircle, PlayCircle } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

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
  rpiRunning: boolean;
  docRunning: boolean;
  opsRunning: boolean;
};

const initialData: QueuePayload = {
  rpi: { processing: [], success: [], errors: [] },
  docs: { processing: [], success: [], errors: [] },
  ops: { processing: [], success: [], errors: [] }
};

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function statusBadge(status: string) {
  if (status === "running") return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">Processando</Badge>;
  if (status === "pending") return <Badge variant="secondary">Pendente</Badge>;
  if (status === "completed") return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Sucesso</Badge>;
  if (status === "skipped_sigilo") return <Badge variant="outline">Sigilo</Badge>;
  if (status === "not_found") return <Badge variant="destructive">Sem Documento</Badge>;
  if (status === "waiting_indexing") return <Badge variant="outline">Aguardando Indexação</Badge>;
  if (status === "failed") return <Badge variant="destructive">Erro</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function sourceLabel(value?: string | null) {
  if (!value) return "-";
  if (value === "google_bigquery") return "Google BigQuery";
  if (value === "google_patents") return "Google Patents";
  if (value === "ops_api") return "OPS";
  if (value === "inpi") return "INPI";
  if (value === "bucket") return "Bucket";
  if (value === "rpi_xml") return "RPI XML";
  return value;
}

function RpiTable({ rows, onRetry }: { rows: RpiJob[]; onRetry?: (id: string) => void }) {
  if (rows.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">Sem registros.</div>;
  }
  return (
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
  );
}

function DocsTable({ rows, onRetry }: { rows: DocJob[]; onRetry?: (id: string) => void }) {
  if (rows.length === 0) {
    return <div className="p-8 text-sm text-muted-foreground">Sem registros.</div>;
  }
  return (
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
            <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate" title={row.error || ""}>{row.error || "-"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(row.finished_at)}</TableCell>
            <TableCell className="text-right">
              {onRetry && (row.status === "failed" || row.status === "not_found") && (
                <Button size="sm" variant="outline" onClick={() => onRetry(row.id)}>Reprocessar</Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function OpsTable({ rows, onRetry }: { rows: OpsJob[]; onRetry?: (id: string) => void }) {
  if (rows.length === 0) return <div className="p-8 text-sm text-muted-foreground">Sem registros.</div>;
  return (
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
            <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate" title={row.error || ""}>{row.error || "-"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{formatDate(row.finished_at)}</TableCell>
            <TableCell className="text-right">
              {onRetry && (row.status === "failed" || row.status === "not_found") && (
                <Button size="sm" variant="outline" onClick={() => onRetry(row.id)}>Reprocessar</Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function BackgroundWorkers() {
  const [data, setData] = useState<QueuePayload>(initialData);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<WorkerState>({
    rpiPaused: false,
    docsPaused: false,
    opsPaused: false,
    rpiRunning: false,
    docRunning: false,
    opsRunning: false
  });
  const [mainTab, setMainTab] = useState("rpi");
  const [rpiTab, setRpiTab] = useState("processing");
  const [docsTab, setDocsTab] = useState("processing");
  const [opsTab, setOpsTab] = useState("processing");
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
    opsErrors: data.ops.counts?.errors ?? data.ops.errors.length
  }), [data]);

  const fetchQueues = async () => {
    setLoading(true);
    try {
      const [queues, workerState] = await Promise.all([
        axios.get(`${API_URL}/background-workers/queues?limit=120`),
        axios.get(`${API_URL}/background-workers/state`)
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
      await axios.post(`${API_URL}/background-workers/rpi/bootstrap`);
      await fetchQueues();
    } finally {
      setLoading(false);
    }
  };

  const controlWorkers = async (queue: "rpi" | "docs" | "ops" | "all", action: "pause" | "resume") => {
    setLoading(true);
    try {
      await axios.post(`${API_URL}/background-workers/control`, { queue, action });
      await fetchQueues();
    } finally {
      setLoading(false);
    }
  };

  const retryRpiJob = async (id: string) => {
    await axios.post(`${API_URL}/background-workers/rpi/retry/${id}`);
    await fetchQueues();
  };

  const retryDocsJob = async (id: string) => {
    await axios.post(`${API_URL}/background-workers/docs/retry/${id}`);
    await fetchQueues();
  };

  const retryOpsJob = async (id: string) => {
    await axios.post(`${API_URL}/background-workers/ops/retry/${id}`);
    await fetchQueues();
  };

  const retryAllRpiErrors = async () => {
    setLoading(true);
    try {
      const ids = data.rpi.errors.map((row) => row.id);
      const response = await axios.post(`${API_URL}/background-workers/rpi/retry-errors`, { ids });
      setActionMessage(`RPI reprocessadas: ${response.data?.updated ?? 0}`);
      await fetchQueues();
    } finally {
      setLoading(false);
    }
  };

  const retryAllDocsErrors = async () => {
    setLoading(true);
    try {
      const ids = data.docs.errors.map((row) => row.id);
      const response = await axios.post(`${API_URL}/background-workers/docs/retry-errors`, { ids });
      setActionMessage(`Docs reprocessados: ${response.data?.updated ?? 0}`);
      await fetchQueues();
    } finally {
      setLoading(false);
    }
  };

  const retryAllOpsErrors = async () => {
    setLoading(true);
    try {
      const ids = data.ops.errors.map((row) => row.id);
      const response = await axios.post(`${API_URL}/background-workers/ops/retry-errors`, { ids });
      setActionMessage(`OPS reprocessados: ${response.data?.updated ?? 0}`);
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
      const response = await axios.post(`${API_URL}/background-workers/rpi/enqueue-range`, { from, to });
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
      const response = await axios.post(`${API_URL}/background-workers/requeue-by-filter`, {
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
      const response = await axios.post(`${API_URL}/background-workers/clear-active-errors`);
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
      const response = await axios.post(`${API_URL}/background-workers/reprocess-all`);
      const enqueued = response.data.enqueued || {};
      setActionMessage(`Reprocessamento iniciado: RPI ${enqueued.from}→${enqueued.to} (${enqueued.count} enfileiradas)`);
      await fetchQueues();
    } catch (error: any) {
      setActionMessage(error?.response?.data?.error || "Falha ao iniciar reprocessamento total");
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
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Background Workers</h1>
            <p className="text-muted-foreground mt-1">
              Controle da fila de importação de RPI e da fila de download de documentos via Espacenet.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => controlWorkers("all", state.rpiPaused && state.docsPaused && state.opsPaused ? "resume" : "pause")}
              disabled={loading}
              className="gap-2"
            >
              {state.rpiPaused && state.docsPaused && state.opsPaused ? <PlayCircle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
              {state.rpiPaused && state.docsPaused && state.opsPaused ? "Retomar Workers" : "Pausar Workers"}
            </Button>
            <Button variant="outline" onClick={bootstrapRpi} disabled={loading} className="gap-2">
              <Files className="w-4 h-4" />
              Enfileirar 5 anos de RPI
            </Button>
            <Button variant="outline" onClick={clearProcessingAndErrors} disabled={loading} className="gap-2">
              Limpar Erros/Processando
            </Button>
            <Button variant="default" onClick={reprocessAllFiveYears} disabled={loading} className="gap-2">
              Reprocessar Tudo (5 anos)
            </Button>
            <Button variant="outline" onClick={fetchQueues} disabled={loading} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>

        <Tabs value={mainTab} onValueChange={setMainTab}>
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
          <TabsList>
            <TabsTrigger value="rpi" className="gap-2">
              <Files className="w-4 h-4" />
              Fila RPI
            </TabsTrigger>
            <TabsTrigger value="docs" className="gap-2">
              <FileDown className="w-4 h-4" />
              Fila Docs
            </TabsTrigger>
            <TabsTrigger value="ops" className="gap-2">
              <Files className="w-4 h-4" />
              Fila OPS
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rpi" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Processando</CardDescription>
                  <CardTitle className="text-2xl flex items-center gap-2"><Clock className="w-5 h-5" />{counters.rpiProcessing}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Sucesso</CardDescription>
                  <CardTitle className="text-2xl flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-600" />{counters.rpiSuccess}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Erros</CardDescription>
                  <CardTitle className="text-2xl flex items-center gap-2"><AlertCircle className="w-5 h-5 text-red-600" />{counters.rpiErrors}</CardTitle>
                </CardHeader>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Fila RPI</CardTitle>
                <CardDescription>Uma RPI por vez, mantendo histórico de sucesso e falhas.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={rpiTab} onValueChange={setRpiTab}>
                  <TabsList>
                    <TabsTrigger value="processing">Processando</TabsTrigger>
                    <TabsTrigger value="success">Sucesso</TabsTrigger>
                    <TabsTrigger value="errors">Erros</TabsTrigger>
                  </TabsList>
                  <TabsContent value="processing"><RpiTable rows={data.rpi.processing} /></TabsContent>
                  <TabsContent value="success"><RpiTable rows={data.rpi.success} /></TabsContent>
                  <TabsContent value="errors" className="space-y-3">
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" disabled={loading || data.rpi.errors.length === 0} onClick={retryAllRpiErrors}>
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
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Processando</CardDescription>
                  <CardTitle className="text-2xl flex items-center gap-2"><Clock className="w-5 h-5" />{counters.docsProcessing}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Sucesso</CardDescription>
                  <CardTitle className="text-2xl flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-600" />{counters.docsSuccess}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Erros/Logs</CardDescription>
                  <CardTitle className="text-2xl flex items-center gap-2"><AlertCircle className="w-5 h-5 text-red-600" />{counters.docsErrors}</CardTitle>
                </CardHeader>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Fila de Documentos</CardTitle>
                <CardDescription>Somente patentes sem sigilo. Falhas e sem-documento ficam registradas para consulta.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={docsTab} onValueChange={setDocsTab}>
                  <TabsList>
                    <TabsTrigger value="processing">Processando</TabsTrigger>
                    <TabsTrigger value="success">Sucesso</TabsTrigger>
                    <TabsTrigger value="errors">Erros</TabsTrigger>
                  </TabsList>
                  <TabsContent value="processing"><DocsTable rows={data.docs.processing} /></TabsContent>
                  <TabsContent value="success"><DocsTable rows={data.docs.success} /></TabsContent>
                  <TabsContent value="errors" className="space-y-3">
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" disabled={loading || data.docs.errors.length === 0} onClick={retryAllDocsErrors}>
                        Reprocessar todos os erros
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
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Processando</CardDescription>
                  <CardTitle className="text-2xl flex items-center gap-2"><Clock className="w-5 h-5" />{counters.opsProcessing}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Sucesso</CardDescription>
                  <CardTitle className="text-2xl flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-600" />{counters.opsSuccess}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Erros/Logs</CardDescription>
                  <CardTitle className="text-2xl flex items-center gap-2"><AlertCircle className="w-5 h-5 text-red-600" />{counters.opsErrors}</CardTitle>
                </CardHeader>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Fila Bibliográfica OPS</CardTitle>
                <CardDescription>Enriquecimento bibliográfico para despachos que não são 3.1/16.1.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={opsTab} onValueChange={setOpsTab}>
                  <TabsList>
                    <TabsTrigger value="processing">Processando</TabsTrigger>
                    <TabsTrigger value="success">Sucesso</TabsTrigger>
                    <TabsTrigger value="errors">Erros</TabsTrigger>
                  </TabsList>
                  <TabsContent value="processing"><OpsTable rows={data.ops.processing} /></TabsContent>
                  <TabsContent value="success"><OpsTable rows={data.ops.success} /></TabsContent>
                  <TabsContent value="errors" className="space-y-3">
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" disabled={loading || data.ops.errors.length === 0} onClick={retryAllOpsErrors}>
                        Reprocessar todos os erros
                      </Button>
                    </div>
                    <OpsTable rows={data.ops.errors} onRetry={retryOpsJob} />
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
