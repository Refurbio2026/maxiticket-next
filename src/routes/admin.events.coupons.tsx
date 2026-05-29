import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/events/coupons")({
  head: () => ({ meta: [{ title: "Zľavové kupóny · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.invoice as Column[];
  const rows = buildRows(48, "events.coupons");
  return (
    <DataTablePage
      title="Zľavové kupóny"
      subtitle="Vytvorené kupóny a ich využitie."
      columns={columns}
      rows={rows}
    />
  );
}
