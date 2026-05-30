import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getEvents, EVENTS_EVENT, type EventItem } from "@/lib/local-db";
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
  const [events, setEvents] = useState<EventItem[]>([]);

  useEffect(() => {
    const load = () =>
      setEvents(
        getEvents()
          .filter((e) => e.status === "published")
          .sort((a, b) => a.event_date.localeCompare(b.event_date)),
      );
    load();
    window.addEventListener(EVENTS_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(EVENTS_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 pt-32 pb-20">
        <div className="mb-10">
          <h1 className="font-display text-5xl font-bold tracking-tight">Podujatia</h1>
          <p className="text-muted-foreground mt-2">Všetky aktuálne podujatia na jednom mieste.</p>
        </div>

        {events.length === 0 ? (
          <Card className="p-12 text-center bg-card/60 border-dashed border-border/50">
            <Calendar className="size-10 text-muted-foreground mx-auto mb-3" />
            <div className="font-semibold">Žiadne publikované podujatia</div>
            <p className="text-sm text-muted-foreground mt-1">Pozri sa neskôr alebo skontroluj organizer dashboard.</p>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {events.map((e) => (
              <Link key={e.id} to="/events/$id" params={{ id: e.id }} className="group">
                <Card className="overflow-hidden bg-card/60 border-border/50 hover:border-primary/40 transition">
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
                    <div className="pt-2 flex items-center justify-between">
                      <div className="text-sm">
                        <span className="text-muted-foreground">od </span>
                        <span className="font-display font-bold text-base">€{Number(e.base_price ?? e.tickets?.[0]?.price ?? 0).toFixed(2)}</span>
                      </div>
                      <span className="text-xs font-semibold text-primary group-hover:underline">Kúpiť vstupenky →</span>
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
