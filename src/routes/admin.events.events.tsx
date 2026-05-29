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
  {
    key: "status",
    label: "Stav",
    badge: true,
    badgeMap: { Publikované: "success", Koncept: "muted" },
  },
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
        id: e.id,
        title: e.title,
        category: e.category,
        event_date: e.event_date,
        city: e.city,
        venue: e.venue,
        status: e.status === "published" ? "Publikované" : "Koncept",
      })) as Record<string, string | number>[];
    },
  });

  return (
    <DataTablePage
      title="Podujatia"
      subtitle="Všetky podujatia v systéme — z reálnej databázy."
      columns={columns}
      rows={rows}
    />
  );
}

