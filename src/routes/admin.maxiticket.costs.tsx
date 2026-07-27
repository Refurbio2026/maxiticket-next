import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/maxiticket/costs")({
  head: () => ({ meta: [{ title: "Náklady organizátorov · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.invoice as Column[];
  const rows = buildRows(48, "maxiticket.costs");
  return (
    <DataTablePage
      title="Náklady organizátorov"
      subtitle="Náklady, poplatky a provízie naúčtované organizátorom."
      columns={columns}
      rows={rows}
    />
  );
}
