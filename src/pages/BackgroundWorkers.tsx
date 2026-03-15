import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import AppLayout from "@/components/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Clock, CheckCircle2, AlertCircle, FileDown, Files, PauseCircle, PlayCircle } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

type RpiJob = {
  id: string;
  rpi_number: number;
  status: string;
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
};

type WorkerState = {
  rpiPaused: boolean;
  docsPaused: boolean;
  rpiRunning: boolean;
  docRunning: boolean;
};

const initialData: QueuePayload = {
  rpi: { processing: [], success: [], errors: [] },
  docs: { processing: [], success: [], errors: [] }
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
  if (status === "failed") return <Badge variant="destructive">Erro</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
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

export default function BackgroundWorkers() {
  const [data, setData] = useState<QueuePayload>(initialData);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<WorkerState>({
    rpiPaused: false,
    docsPaused: false,
    rpiRunning: false,
    docRunning: false
  });
  const [mainTab, setMainTab] = useState("rpi");
  const [rpiTab, setRpiTab] = useState("processing");
  const [docsTab, setDocsTab] = useState("processing");

  const counters = useMemo(() => ({
    rpiProcessing: data.rpi.counts?.processing ?? data.rpi.processing.length,
    rpiSuccess: data.rpi.counts?.success ?? data.rpi.success.length,
    rpiErrors: data.rpi.counts?.errors ?? data.rpi.errors.length,
    docsProcessing: data.docs.counts?.processing ?? data.docs.processing.length,
    docsSuccess: data.docs.counts?.success ?? data.docs.success.length,
    docsErrors: data.docs.counts?.errors ?? data.docs.errors.length
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

  const controlWorkers = async (queue: "rpi" | "docs" | "all", action: "pause" | "resume") => {
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
              onClick={() => controlWorkers("all", state.rpiPaused && state.docsPaused ? "resume" : "pause")}
              disabled={loading}
              className="gap-2"
            >
              {state.rpiPaused && state.docsPaused ? <PlayCircle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
              {state.rpiPaused && state.docsPaused ? "Retomar Workers" : "Pausar Workers"}
            </Button>
            <Button variant="outline" onClick={bootstrapRpi} disabled={loading} className="gap-2">
              <Files className="w-4 h-4" />
              Enfileirar 5 anos de RPI
            </Button>
            <Button variant="outline" onClick={fetchQueues} disabled={loading} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>

        <Tabs value={mainTab} onValueChange={setMainTab}>
          <TabsList>
            <TabsTrigger value="rpi" className="gap-2">
              <Files className="w-4 h-4" />
              Fila RPI
            </TabsTrigger>
            <TabsTrigger value="docs" className="gap-2">
              <FileDown className="w-4 h-4" />
              Fila Docs
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
                  <TabsContent value="errors"><RpiTable rows={data.rpi.errors} onRetry={retryRpiJob} /></TabsContent>
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
                  <TabsContent value="errors"><DocsTable rows={data.docs.errors} onRetry={retryDocsJob} /></TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
