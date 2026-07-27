import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/data/discount-categories")({
  head: () => ({ meta: [{ title: "Kategórie zliav · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "data.discount-categories");
  return (
    <DataTablePage
      title="Kategórie zliav"
      subtitle="Kategórie zliav (Študent, ZŤP, Senior, …)."
      columns={columns}
      rows={rows}
    />
  );
}
