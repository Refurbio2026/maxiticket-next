import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Calendar, MapPin, Eye, FileText } from "lucide-react";

export const Route = createFileRoute("/organizer/")({
  head: () => ({ meta: [{ title: "Organizer dashboard · MAXITICKET" }] }),
  component: OrganizerHome,
});

function OrganizerHome() {
  const { user } = useAuth();
  const { data: events, isLoading } = useQuery({
    queryKey: ["organizer-events", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("organizer_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Tvoje podujatia</h1>
          <p className="text-muted-foreground mt-1">Spravuj všetko, čo organizuješ.</p>
        </div>
        <Button asChild className="bg-gradient-flame text-primary-foreground shadow-glow">
          <Link to="/organizer/events/new"><Plus className="size-4 mr-2" /> Pridať podujatie</Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Načítavam…</div>
      ) : !events || events.length === 0 ? (
        <Card className="p-12 text-center bg-card/60 border-dashed border-border/50">
          <Calendar className="size-10 text-muted-foreground mx-auto mb-3" />
          <div className="font-semibold">Zatiaľ žiadne podujatia</div>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Vytvor svoje prvé podujatie a začni predávať vstupenky.</p>
          <Button asChild className="bg-gradient-flame text-primary-foreground">
            <Link to="/organizer/events/new"><Plus className="size-4 mr-2" /> Vytvoriť podujatie</Link>
          </Button>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((e) => (
            <Card key={e.id} className="overflow-hidden bg-card/60 border-border/50 group">
              <div
                className="aspect-video bg-muted bg-cover bg-center"
                style={e.image_url ? { backgroundImage: `url(${e.image_url})` } : undefined}
              />
              <div className="p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                    e.status === "published"
                      ? "bg-primary/15 text-primary border-primary/30"
                      : "bg-muted text-muted-foreground border-border/50"
                  }`}>
                    {e.status === "published" ? "Publikované" : "Koncept"}
                  </span>
                  <span className="text-xs text-muted-foreground">{e.category}</span>
                </div>
                <h3 className="font-display font-semibold text-lg leading-tight">{e.title}</h3>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="size-3.5" /> {e.event_date} · {e.event_time}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <MapPin className="size-3.5" /> {e.venue}, {e.city}
                </div>
                {e.status === "published" && (
                  <Button asChild variant="ghost" size="sm" className="mt-2">
                    <Link to="/events/$id" params={{ id: e.id }}><Eye className="size-3.5 mr-1.5" /> Zobraziť</Link>
                  </Button>
                )}
                {e.status === "draft" && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-2">
                    <FileText className="size-3.5" /> Verejne neviditeľné
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
