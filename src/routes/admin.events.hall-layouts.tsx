import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/events/hall-layouts")({
  head: () => ({ meta: [{ title: "Definície rozloženia haly · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "events.hall-layouts");
  return (
    <DataTablePage
      title="Definície rozloženia haly"
      subtitle="Plány sektorov, radov a miest."
      columns={columns}
      rows={rows}
    />
  );
}
