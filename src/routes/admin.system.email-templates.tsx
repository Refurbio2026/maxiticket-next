import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/system/email-templates")({
  head: () => ({ meta: [{ title: "Emailové šablóny · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.simple as Column[];
  const rows = buildRows(48, "system.email-templates");
  return (
    <DataTablePage
      title="Emailové šablóny"
      subtitle="Šablóny transakčných emailov."
      columns={columns}
      rows={rows}
    />
  );
}
