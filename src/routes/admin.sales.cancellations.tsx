import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/sales/cancellations")({
  head: () => ({ meta: [{ title: "Storno · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.sale as Column[];
  const rows = buildRows(48, "sales.cancellations");
  return (
    <DataTablePage
      title="Storno"
      subtitle="Stornované objednávky a refundácie."
      columns={columns}
      rows={rows}
    />
  );
}
