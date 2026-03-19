import { CalendarDays, FilePlus2 } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import {
  FilterBar,
  PageHeader,
  SectionCard,
  StatusBadge,
  UrgencyBadge,
} from "@/components/platform/components";
import { processEvents } from "@/data/platformMock";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function MonitoringProcess() {
  return (
    <AppLayout>
      <PageHeader
        title="Monitoramento de Processo"
        subtitle="Controle ciclo processual, urgências e execução operacional."
        breadcrumbs={[{ label: "Monitoramentos" }, { label: "Processo" }]}
        actions={
          <>
            <Button variant="outline" className="gap-1"><FilePlus2 className="h-4 w-4" />Gerar tarefa</Button>
            <Button className="bg-slate-900 hover:bg-slate-800">Virar demanda CRM</Button>
          </>
        }
        filters={
          <FilterBar
            fields={
              <>
                <Input placeholder="Cliente" />
                <Input placeholder="Tipo de evento" />
                <Input placeholder="Urgência" />
                <Input placeholder="Responsável" />
                <Input placeholder="Status" />
                <Input placeholder="Período" />
              </>
            }
          />
        }
      />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi title="Exigências abertas" value="23" />
        <Kpi title="Prazo em até 7 dias" value="9" />
        <Kpi title="Anuidades próximas" value="14" />
        <Kpi title="Sem responsável" value="3" />
        <Kpi title="Novos comunicados" value="12" />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard title="Eventos processuais" className="xl:col-span-9">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Processo</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Titular</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead>Dias</TableHead>
                <TableHead>Urgência</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {processEvents.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.client}</TableCell>
                  <TableCell className="font-mono text-xs">{row.process}</TableCell>
                  <TableCell className="max-w-[250px] truncate">{row.title}</TableCell>
                  <TableCell>{row.owner}</TableCell>
                  <TableCell>{row.eventType}</TableCell>
                  <TableCell>{row.code}</TableCell>
                  <TableCell>{row.dueDate}</TableCell>
                  <TableCell>{row.daysLeft}</TableCell>
                  <TableCell><UrgencyBadge value={row.urgency} /></TableCell>
                  <TableCell>{row.assignee}</TableCell>
                  <TableCell><StatusBadge label={row.status} variant={row.status === "resolvido" ? "stable" : "attention"} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>

        <SectionCard title="Mini agenda de prazos" className="xl:col-span-3" description="Próximas janelas críticas">
          <div className="space-y-2">
            {processEvents.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-medium">{item.process}</p>
                <p className="text-xs text-slate-500">{item.eventType} · {item.client}</p>
                <div className="mt-2 flex items-center justify-between">
                  <p className="inline-flex items-center gap-1 text-xs text-slate-500"><CalendarDays className="h-3.5 w-3.5" />{item.dueDate}</p>
                  <UrgencyBadge value={item.urgency} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Timeline do processo">
          <div className="space-y-2 text-sm">
            <div className="rounded-lg border border-slate-200 p-3">19/03 · Comunicado RPI 2819 publicado</div>
            <div className="rounded-lg border border-slate-200 p-3">17/03 · Exigência técnica identificada</div>
            <div className="rounded-lg border border-slate-200 p-3">12/03 · Petição protocolada</div>
            <div className="rounded-lg border border-slate-200 p-3">05/03 · Despacho de mérito recebido</div>
          </div>
        </SectionCard>
        <SectionCard title="Observações e documentos vinculados">
          <div className="space-y-2 text-sm">
            <div className="rounded-lg border border-slate-200 p-3">Memo interno: revisar escopo de reivindicações 1 a 3.</div>
            <div className="rounded-lg border border-slate-200 p-3">Anexo: parecer técnico_v2.pdf</div>
            <div className="rounded-lg border border-slate-200 p-3">Anexo: resposta_exigencia_draft.docx</div>
          </div>
        </SectionCard>
      </section>
    </AppLayout>
  );
}

function Kpi({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
