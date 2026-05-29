import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/sales/sales")({
  head: () => ({ meta: [{ title: "Predaj · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.sale as Column[];
  const rows = buildRows(48, "sales.sales");
  return (
    <DataTablePage
      title="Predaj"
      subtitle="Všetky predajné transakcie."
      columns={columns}
      rows={rows}
    />
  );
}
