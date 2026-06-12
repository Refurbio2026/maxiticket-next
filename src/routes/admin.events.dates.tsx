import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/events/dates")({
  head: () => ({ meta: [{ title: "Termíny · vstupenky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.event as Column[];
  const rows = buildRows(48, "events.dates");
  return (
    <DataTablePage
      title="Termíny"
      subtitle="Termíny a časy konania podujatí."
      columns={columns}
      rows={rows}
    />
  );
}
