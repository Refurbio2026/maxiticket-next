import { createFileRoute } from "@tanstack/react-router";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";
import { buildRows, commonColumns } from "@/lib/admin-mock";

export const Route = createFileRoute("/admin/system/users")({
  head: () => ({ meta: [{ title: "Používatelia · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const columns = commonColumns.user as Column[];
  const rows = buildRows(48, "system.users");
  return (
    <DataTablePage
      title="Používatelia"
      subtitle="Používatelia s prístupom do admin konzoly."
      columns={columns}
      rows={rows}
    />
  );
}
