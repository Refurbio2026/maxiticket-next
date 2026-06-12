import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/maxiticket/organizers")({
  head: () => ({ meta: [{ title: "Organizátori · vstupenky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.organizer as Column[];
  const rows = buildRows(48, "maxiticket.organizers");
  return (
    <DataTablePage
      title="Organizátori"
      subtitle="Zoznam všetkých organizátorov na platforme."
      columns={columns}
      rows={rows}
    />
  );
}
