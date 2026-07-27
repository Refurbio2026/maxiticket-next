import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/maxiticket/accounting-checks")({
  head: () => ({ meta: [{ title: "Účtovanie · kontroly · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.invoice as Column[];
  const rows = buildRows(48, "maxiticket.accounting-checks");
  return (
    <DataTablePage
      title="Účtovanie · kontroly"
      subtitle="Automatické kontroly nezhôd v účtovaní."
      columns={columns}
      rows={rows}
    />
  );
}
