import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/maxiticket/refund-types")({
  head: () => ({ meta: [{ title: "Typy refundácií · vstupenky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "maxiticket.refund-types");
  return (
    <DataTablePage
      title="Typy refundácií"
      subtitle="Číselník dôvodov a typov refundácií."
      columns={columns}
      rows={rows}
    />
  );
}
