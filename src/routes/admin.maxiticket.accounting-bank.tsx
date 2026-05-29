import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/maxiticket/accounting-bank")({
  head: () => ({ meta: [{ title: "Účtovanie · banka · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.invoice as Column[];
  const rows = buildRows(48, "maxiticket.accounting-bank");
  return (
    <DataTablePage
      title="Účtovanie · banka"
      subtitle="Importované výpisy z banky a párovanie."
      columns={columns}
      rows={rows}
    />
  );
}
