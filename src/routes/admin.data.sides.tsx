import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/data/sides")({
  head: () => ({ meta: [{ title: "Strana / Side · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "data.sides");
  return (
    <DataTablePage
      title="Strana / Side"
      subtitle="Strany hľadiska (sever, juh, …)."
      columns={columns}
      rows={rows}
    />
  );
}
