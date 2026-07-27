import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/data/groups")({
  head: () => ({ meta: [{ title: "Skupiny podujatí · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "data.groups");
  return (
    <DataTablePage
      title="Skupiny podujatí"
      subtitle="Skupiny pre viacdielne podujatia."
      columns={columns}
      rows={rows}
    />
  );
}
