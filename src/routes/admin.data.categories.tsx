import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/data/categories")({
  head: () => ({ meta: [{ title: "Kategórie podujatí · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "data.categories");
  return (
    <DataTablePage
      title="Kategórie podujatí"
      subtitle="Hlavné kategórie (Koncert, Šport, …)."
      columns={columns}
      rows={rows}
    />
  );
}
