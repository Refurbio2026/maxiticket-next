import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/events/events")({
  head: () => ({ meta: [{ title: "Podujatia · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.event as Column[];
  const rows = buildRows(48, "events.events");
  return (
    <DataTablePage
      title="Podujatia"
      subtitle="Všetky podujatia v systéme."
      columns={columns}
      rows={rows}
    />
  );
}
