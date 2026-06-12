import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/maxiticket/devices")({
  head: () => ({ meta: [{ title: "Zariadenia / čítačky · vstupenky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.device as Column[];
  const rows = buildRows(48, "maxiticket.devices");
  return (
    <DataTablePage
      title="Zariadenia / čítačky"
      subtitle="Skenery a vstupné terminály na podujatiach."
      columns={columns}
      rows={rows}
    />
  );
}
