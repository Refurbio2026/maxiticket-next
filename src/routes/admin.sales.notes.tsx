import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/sales/notes")({
  head: () => ({ meta: [{ title: "Poznámky · vstupenky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "sales.notes");
  return (
    <DataTablePage
      title="Poznámky"
      subtitle="Interné poznámky k objednávkam."
      columns={columns}
      rows={rows}
    />
  );
}
