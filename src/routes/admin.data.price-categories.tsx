import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/data/price-categories")({
  head: () => ({ meta: [{ title: "Cenové kategórie · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "data.price-categories");
  return (
    <DataTablePage
      title="Cenové kategórie"
      subtitle="Cenové triedy (VIP, Standard, Stage, …)."
      columns={columns}
      rows={rows}
    />
  );
}
