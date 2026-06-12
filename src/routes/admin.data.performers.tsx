import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/data/performers")({
  head: () => ({ meta: [{ title: "Účinkujúci · vstupenky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "data.performers");
  return (
    <DataTablePage
      title="Účinkujúci"
      subtitle="Umelci, kapely, hostia a tímy."
      columns={columns}
      rows={rows}
    />
  );
}
