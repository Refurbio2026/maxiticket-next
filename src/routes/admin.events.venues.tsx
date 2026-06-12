import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/events/venues")({
  head: () => ({ meta: [{ title: "Miesta konania · vstupenky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "events.venues");
  return (
    <DataTablePage
      title="Miesta konania"
      subtitle="Haly, štadióny a kultúrne miesta."
      columns={columns}
      rows={rows}
    />
  );
}
