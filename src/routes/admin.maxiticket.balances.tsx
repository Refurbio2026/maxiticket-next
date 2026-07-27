import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/maxiticket/balances")({
  head: () => ({ meta: [{ title: "Bilancie · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.invoice as Column[];
  const rows = buildRows(48, "maxiticket.balances");
  return (
    <DataTablePage
      title="Bilancie"
      subtitle="Otvorené a uzavreté bilancie organizátorov."
      columns={columns}
      rows={rows}
    />
  );
}
