import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/maxiticket/accounting-report")({
  head: () => ({ meta: [{ title: "Účtovanie · report · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.invoice as Column[];
  const rows = buildRows(48, "maxiticket.accounting-report");
  return (
    <DataTablePage
      title="Účtovanie · report"
      subtitle="Účtovné reporty pre účtovné oddelenie."
      columns={columns}
      rows={rows}
    />
  );
}
