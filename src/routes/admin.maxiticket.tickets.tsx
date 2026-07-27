import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/maxiticket/tickets")({
  head: () => ({ meta: [{ title: "Vstupenky organizátorov · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.sale as Column[];
  const rows = buildRows(48, "maxiticket.tickets");
  return (
    <DataTablePage
      title="Vstupenky organizátorov"
      subtitle="Vydané vstupenky a ich aktuálny stav."
      columns={columns}
      rows={rows}
    />
  );
}
