import AppLayout from "@/components/AppLayout";
import { PageHeader, SectionCard, StatusBadge } from "@/components/platform/components";
import { rpiHistory } from "@/data/platformMock";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function RpiHistory() {
  return (
    <AppLayout>
      <PageHeader
        title="Histórico RPI"
        subtitle="Edições processadas, desempenho e taxa de erro."
        breadcrumbs={[{ label: "Base" }, { label: "Histórico RPI" }]}
      />
      <SectionCard title="Execuções recentes">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Edição</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Importados</TableHead>
              <TableHead>Falhas</TableHead>
              <TableHead>Duração</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rpiHistory.map((row) => (
              <TableRow key={row.edition}>
                <TableCell>#{row.edition}</TableCell>
                <TableCell>{row.date}</TableCell>
                <TableCell>{row.imported}</TableCell>
                <TableCell>{row.failed}</TableCell>
                <TableCell>{row.duration}</TableCell>
                <TableCell><StatusBadge label={row.status} variant="stable" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    </AppLayout>
  );
}
