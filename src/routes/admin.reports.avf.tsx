import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/reports/avf")({
  head: () => ({ meta: [{ title: "AVF Reporty · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.invoice as Column[];
  const rows = buildRows(48, "reports.avf");
  return (
    <DataTablePage
      title="AVF Reporty"
      subtitle="Audio-video-formát reporty."
      columns={columns}
      rows={rows}
    />
  );
}
