import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Card } from "@/components/ui/card";
import { Calendar, MapPin } from "lucide-react";

export const Route = createFileRoute("/events")({
  head: () => ({
    meta: [
      { title: "Podujatia · MAXITICKET" },
      { name: "description", content: "Objavte všetky podujatia, koncerty, festivaly a kultúru na MAXITICKET." },
    ],
  }),
  component: EventsPage,
});

function EventsPage() {
  const { data: events, isLoading } = useQuery({
    queryKey: ["public-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("status", "published")
        .order("event_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 pt-32 pb-20">
        <div className="mb-10">
          <h1 className="font-display text-5xl font-bold tracking-tight">Podujatia</h1>
          <p className="text-muted-foreground mt-2">Všetky aktuálne podujatia na jednom mieste.</p>
        </div>

        {isLoading ? (
          <div className="text-muted-foreground">Načítavam…</div>
        ) : !events || events.length === 0 ? (
          <Card className="p-12 text-center bg-card/60 border-dashed border-border/50">
            <Calendar className="size-10 text-muted-foreground mx-auto mb-3" />
            <div className="font-semibold">Žiadne publikované podujatia</div>
            <p className="text-sm text-muted-foreground mt-1">Pozri sa neskôr alebo skontroluj organizer dashboard.</p>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {events.map((e) => (
              <Link to="/events/$id" params={{ id: e.id }} key={e.id} className="group">
                <Card className="overflow-hidden bg-card/60 border-border/50 transition group-hover:border-primary/40 group-hover:shadow-glow">
                  <div
                    className="aspect-video bg-muted bg-cover bg-center"
                    style={e.image_url ? { backgroundImage: `url(${e.image_url})` } : undefined}
                  />
                  <div className="p-5 space-y-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">{e.category}</span>
                    <h3 className="font-display font-semibold text-lg leading-tight">{e.title}</h3>
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Calendar className="size-3.5" /> {e.event_date} · {e.event_time}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <MapPin className="size-3.5" /> {e.venue}, {e.city}
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
