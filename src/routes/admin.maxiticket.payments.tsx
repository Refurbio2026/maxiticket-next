import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/maxiticket/payments")({
  head: () => ({ meta: [{ title: "Platby organizátorom · vstupenky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.invoice as Column[];
  const rows = buildRows(48, "maxiticket.payments");
  return (
    <DataTablePage
      title="Platby organizátorom"
      subtitle="Odoslané vyplatenie tržieb organizátorom."
      columns={columns}
      rows={rows}
    />
  );
}
