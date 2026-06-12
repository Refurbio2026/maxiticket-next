import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/maxiticket/protocols")({
  head: () => ({ meta: [{ title: "Vyúčtovacie protokoly · vstupenky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.invoice as Column[];
  const rows = buildRows(48, "maxiticket.protocols");
  return (
    <DataTablePage
      title="Vyúčtovacie protokoly"
      subtitle="Podpísané protokoly o vyúčtovaní vstupeniek."
      columns={columns}
      rows={rows}
    />
  );
}
