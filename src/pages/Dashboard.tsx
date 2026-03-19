import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  FileWarning,
  Network,
  Radar,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import AppLayout from "@/components/AppLayout";
import { PageHeader, RiskBadge, ScoreBadge, SectionCard, StatCard, StatusBadge } from "@/components/platform/components";
import { clients, collisions, kpiDashboard, marketSignals, processEvents, workers } from "@/data/platformMock";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const eventsByType = [
    { name: "Colidência", value: 46, color: "#0e7490" },
    { name: "Processo", value: 32, color: "#1d4ed8" },
    { name: "Mercado", value: 21, color: "#7c3aed" },
    { name: "Pesquisa", value: 18, color: "#0f766e" },
  ];

  return (
    <AppLayout>
      <PageHeader
        title="Dashboard de Inteligência"
        subtitle="Priorize risco, prazos e movimentação competitiva em uma visão operacional única."
        breadcrumbs={[{ label: "Dashboard" }]}
        actions={<Button className="bg-slate-900 hover:bg-slate-800">Gerar briefing executivo</Button>}
      />

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
        <StatCard title="Clientes ativos" value={String(kpiDashboard.activeClients)} detail="+4 no trimestre" icon={<Users className="h-4 w-4" />} trend="up" />
        <StatCard title="Pesquisas em andamento" value={String(kpiDashboard.activeResearches)} detail="6 com prazo < 5 dias" icon={<Radar className="h-4 w-4" />} trend="stable" />
        <StatCard title="Patentes monitoradas" value={String(kpiDashboard.monitoredPatents)} detail="+8.2% vs mês anterior" icon={<Database className="h-4 w-4" />} trend="up" />
        <StatCard title="Colisões pendentes" value={String(kpiDashboard.pendingCollisions)} detail="11 sem responsável" icon={<ShieldAlert className="h-4 w-4" />} trend="down" />
        <StatCard title="Exigências críticas" value={String(kpiDashboard.criticalRequirements)} detail="2 vencem em 48h" icon={<FileWarning className="h-4 w-4" />} trend="down" />
        <StatCard title="Monitoramentos mercado" value={String(kpiDashboard.activeMarketMonitoring)} detail="4 novos esta semana" icon={<Network className="h-4 w-4" />} trend="up" />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard title="Ações recomendadas hoje" className="xl:col-span-4" description="Itens de maior impacto operacional">
          <div className="space-y-3">
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="text-sm font-medium text-rose-900">Validar colisão crítica WO2026022445A1</p>
              <p className="text-xs text-rose-700">Cliente BioSyn Energia · responsável sugerido Júlia Costa</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">Gerar tarefa de resposta da exigência 6.1</p>
              <p className="text-xs text-amber-700">Processo BR102020014552-2 · prazo em 5 dias</p>
            </div>
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
              <p className="text-sm font-medium text-cyan-900">Revisar tendência em baterias sólidas</p>
              <p className="text-xs text-cyan-700">24 novos depósitos no período</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Eventos por período" className="xl:col-span-5" description="Volume semanal consolidado">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={marketSignals}>
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="deposits" fill="#0f172a" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Categoria de monitoramento" className="xl:col-span-3" description="Distribuição dos alertas ativos">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={eventsByType} dataKey="value" innerRadius={48} outerRadius={78}>
                  {eventsByType.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard title="Colisões recentes" className="xl:col-span-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Risco</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collisions.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.client}</TableCell>
                  <TableCell className="font-mono text-xs">{row.document}</TableCell>
                  <TableCell><ScoreBadge score={row.score} /></TableCell>
                  <TableCell><RiskBadge value={row.risk} /></TableCell>
                  <TableCell><StatusBadge label={row.status} variant={row.status === "confirmado" ? "stable" : "attention"} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>

        <SectionCard title="Prazos críticos" className="xl:col-span-3">
          <div className="space-y-2">
            {processEvents.map((event) => (
              <div key={event.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium">{event.client}</p>
                <p className="text-xs text-slate-500">{event.process}</p>
                <div className="mt-2 flex items-center justify-between">
                  <StatusBadge label={`${event.daysLeft} dias`} variant={event.daysLeft <= 7 ? "critical" : "attention"} />
                  <p className="text-xs text-slate-500">{event.eventType}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Status técnico" className="xl:col-span-3">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Última RPI processada</span>
              <span className="font-semibold">#2819</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Fila pendente</span>
              <span className="font-semibold">{workers.reduce((acc, current) => acc + current.pending, 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Workers ativos</span>
              <span className="font-semibold">{workers.filter((item) => item.online).length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Falhas recentes</span>
              <span className="font-semibold text-rose-600">{workers.reduce((acc, current) => acc + current.failures, 0)}</span>
            </div>
            <div className="rounded-lg bg-slate-900 p-3 text-slate-100">
              <p className="text-xs text-slate-300">Saúde geral</p>
              <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Operação estável</p>
            </div>
          </div>
        </SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard title="Ranking de clientes por atividade" className="xl:col-span-7">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Monitoramentos</TableHead>
                <TableHead>Demandas abertas</TableHead>
                <TableHead>Última atividade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">{client.name}</TableCell>
                  <TableCell>{client.monitorings}</TableCell>
                  <TableCell>{client.openDemands}</TableCell>
                  <TableCell>{client.lastActivity}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>

        <SectionCard title="Mercado por tema" className="xl:col-span-5">
          <div className="space-y-3">
            {[
              { label: "Baterias de estado sólido", value: 24, variation: "+18%" },
              { label: "Biomateriais antibacterianos", value: 17, variation: "+11%" },
              { label: "Visão computacional industrial", value: 12, variation: "+7%" },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-slate-500">Novos depósitos no período</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">{item.value}</p>
                  <p className="text-xs text-emerald-600">{item.variation}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SectionCard title="Comunicados RPI recentes">
          <div className="space-y-2 text-sm">
            <p className="flex items-center justify-between rounded-lg border border-slate-200 p-2"><span>RPI #2819 publicada</span><Clock3 className="h-4 w-4 text-slate-400" /></p>
            <p className="flex items-center justify-between rounded-lg border border-slate-200 p-2"><span>Despacho 6.1 identificado (32 processos)</span><AlertTriangle className="h-4 w-4 text-amber-500" /></p>
            <p className="flex items-center justify-between rounded-lg border border-slate-200 p-2"><span>Atualização de anuidades (14 processos)</span><Activity className="h-4 w-4 text-cyan-500" /></p>
          </div>
        </SectionCard>
      </section>
    </AppLayout>
  );
}
