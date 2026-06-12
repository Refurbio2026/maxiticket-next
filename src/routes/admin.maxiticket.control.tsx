import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/maxiticket/control")({
  head: () => ({ meta: [{ title: "Kontrola zostavy · vstupenky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.invoice as Column[];
  const rows = buildRows(48, "maxiticket.control");
  return (
    <DataTablePage
      title="Kontrola zostavy"
      subtitle="Kontrolný prehľad pred uzavretím zostavy."
      columns={columns}
      rows={rows}
    />
  );
}
