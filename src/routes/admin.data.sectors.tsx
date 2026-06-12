import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/data/sectors")({
  head: () => ({ meta: [{ title: "Sektor / Loc1 · vstupenky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "data.sectors");
  return (
    <DataTablePage
      title="Sektor / Loc1"
      subtitle="Sektory hľadiska."
      columns={columns}
      rows={rows}
    />
  );
}
