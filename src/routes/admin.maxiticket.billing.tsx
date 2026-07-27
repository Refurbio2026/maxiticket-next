import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/maxiticket/billing")({
  head: () => ({ meta: [{ title: "Zostavy / fakturovanie · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.invoice as Column[];
  const rows = buildRows(48, "maxiticket.billing");
  return (
    <DataTablePage
      title="Zostavy / fakturovanie"
      subtitle="Mesačné fakturačné zostavy pre organizátorov."
      columns={columns}
      rows={rows}
    />
  );
}
