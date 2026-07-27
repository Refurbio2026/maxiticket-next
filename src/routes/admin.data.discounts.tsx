import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/data/discounts")({
  head: () => ({ meta: [{ title: "Zľavy · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "data.discounts");
  return (
    <DataTablePage
      title="Zľavy"
      subtitle="Konkrétne zľavy a percentá."
      columns={columns}
      rows={rows}
    />
  );
}
