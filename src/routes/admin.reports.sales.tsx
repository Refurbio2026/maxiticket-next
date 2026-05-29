import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/reports/sales")({
  head: () => ({ meta: [{ title: "Reporty predajov · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.invoice as Column[];
  const rows = buildRows(48, "reports.sales");
  return (
    <DataTablePage
      title="Reporty predajov"
      subtitle="Predaje za obdobie, segment a organizátora."
      columns={columns}
      rows={rows}
    />
  );
}
