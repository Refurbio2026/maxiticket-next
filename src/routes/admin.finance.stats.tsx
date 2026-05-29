import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/finance/stats")({
  head: () => ({ meta: [{ title: "Finančné štatistiky · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.invoice as Column[];
  const rows = buildRows(48, "finance.stats");
  return (
    <DataTablePage
      title="Finančné štatistiky"
      subtitle="Agregované finančné ukazovatele."
      columns={columns}
      rows={rows}
    />
  );
}
