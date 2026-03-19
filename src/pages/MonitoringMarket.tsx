import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import AppLayout from "@/components/AppLayout";
import { FilterBar, PageHeader, SectionCard, TypeBadge } from "@/components/platform/components";
import { marketSignals } from "@/data/platformMock";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function MonitoringMarket() {
  return (
    <AppLayout>
      <PageHeader
        title="Monitoramento de Mercado"
        subtitle="Movimentação tecnológica e competitiva orientada por sinais."
        breadcrumbs={[{ label: "Monitoramentos" }, { label: "Mercado" }]}
        actions={
          <>
            <Button variant="outline">Gerar relatório</Button>
            <Button className="bg-slate-900 hover:bg-slate-800">Novo monitoramento</Button>
          </>
        }
        filters={
          <FilterBar
            fields={
              <>
                <Input placeholder="Cliente" />
                <Input placeholder="Período" />
                <Input placeholder="Tipo" />
                <Input placeholder="País" />
                <Input placeholder="Fonte" />
                <Input placeholder="Classe" />
              </>
            }
          />
        }
      />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi title="Monitoramentos ativos" value="24" />
        <Kpi title="Novos depósitos" value="74" />
        <Kpi title="Titulares emergentes" value="11" />
        <Kpi title="Termos em alta" value="17" />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard title="Evolução de depósitos por mês" className="xl:col-span-6">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={marketSignals}>
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="deposits" stroke="#0f172a" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard title="Distribuição por classe/tema" className="xl:col-span-6">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={marketSignals}>
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="ai" fill="#0e7490" />
                <Bar dataKey="biotech" fill="#1d4ed8" />
                <Bar dataKey="materials" fill="#7c3aed" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SectionCard title="Ocorrências recentes" className="xl:col-span-8">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titular</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Tema</TableHead>
                <TableHead>Classe</TableHead>
                <TableHead>País</TableHead>
                <TableHead>Fonte</TableHead>
                <TableHead>Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["Helix Storage Inc.", "WO2026022445A1", "Baterias sólidas", "H01M", "WO", "WIPO"],
                ["NanoPulse Lab", "US20260118890A1", "Dispositivos médicos", "A61B", "US", "USPTO"],
                ["Solvatech GmbH", "EP4528811A1", "Polímeros", "C08K", "EP", "EPO"],
              ].map((row) => (
                <TableRow key={row[1]}>
                  <TableCell>{row[0]}</TableCell>
                  <TableCell className="font-mono text-xs">{row[1]}</TableCell>
                  <TableCell>{row[2]}</TableCell>
                  <TableCell>{row[3]}</TableCell>
                  <TableCell>{row[4]}</TableCell>
                  <TableCell>{row[5]}</TableCell>
                  <TableCell><Button size="sm" variant="outline">Transformar em insight</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
        <SectionCard title="Insights estratégicos" className="xl:col-span-4">
          <div className="space-y-2">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-medium">Movimentos do concorrente</p>
              <p className="text-xs text-slate-500">Helix cresceu 38% em famílias H01M no trimestre.</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-medium">Áreas quentes</p>
              <p className="text-xs text-slate-500">Baterias e biomateriais representam 57% dos novos depósitos.</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-medium">Inventores recorrentes</p>
              <p className="text-xs text-slate-500">K. Yamada e L. Duarte aparecem em 4 famílias distintas.</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-medium">Termos em ascensão</p>
              <div className="mt-2 flex flex-wrap gap-1">
                <TypeBadge label="solid electrolyte" />
                <TypeBadge label="closed loop telemetry" />
                <TypeBadge label="bioactive polymer" />
              </div>
            </div>
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
