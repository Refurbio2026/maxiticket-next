import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/data/rows")({
  head: () => ({ meta: [{ title: "Rad / Loc2 · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "data.rows");
  return (
    <DataTablePage
      title="Rad / Loc2"
      subtitle="Definície radov."
      columns={columns}
      rows={rows}
    />
  );
}
