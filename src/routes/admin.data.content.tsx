import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/data/content")({
  head: () => ({ meta: [{ title: "Obsah / stránky · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "data.content");
  return (
    <DataTablePage
      title="Obsah / stránky"
      subtitle="Statické stránky a marketingový obsah."
      columns={columns}
      rows={rows}
    />
  );
}
