import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTablePage, type Column } from "@/components/admin/DataTablePage";

export const Route = createFileRoute("/admin/events/events")({
  head: () => ({ meta: [{ title: "Podujatia · MAXITICKET Admin" }] }),
  component: Page,
});

const columns: Column[] = [
  { key: "title", label: "Názov" },
  { key: "category", label: "Kategória" },
  { key: "event_date", label: "Dátum" },
  { key: "city", label: "Mesto" },
  { key: "venue", label: "Miesto" },
  { key: "status", label: "Stav", type: "status" },
];

function Page() {
  const { data: rows = [] } = useQuery({
    queryKey: ["admin-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, category, event_date, city, venue, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((e) => ({
        ...e,
        status: e.status === "published" ? "Active" : "Pending",
      }));
    },
  });

  return (
    <DataTablePage
      title="Podujatia"
      subtitle="Všetky podujatia v systéme — z reálnej databázy."
      columns={columns}
      rows={rows as Record<string, unknown>[]}
    />
  );
}
