import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, MapPin, ArrowLeft, Ticket } from "lucide-react";

export const Route = createFileRoute("/events/$id")({
  head: () => ({ meta: [{ title: "Podujatie · MAXITICKET" }] }),
  component: EventDetail,
});

function EventDetail() {
  const { id } = Route.useParams();

  const { data, isLoading } = useQuery({
    queryKey: ["event", id],
    queryFn: async () => {
      const [{ data: event }, { data: tickets }] = await Promise.all([
        supabase.from("events").select("*").eq("id", id).maybeSingle(),
        supabase.from("ticket_types").select("*").eq("event_id", id).order("price"),
      ]);
      return { event, tickets: tickets ?? [] };
    },
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 pt-28 pb-20">
        <Link to="/events" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6">
          <ArrowLeft className="size-4" /> Späť na podujatia
        </Link>
        {isLoading ? (
          <div className="text-muted-foreground">Načítavam…</div>
        ) : !data?.event ? (
          <Card className="p-12 text-center bg-card/60 border-dashed">
            <div className="font-semibold">Podujatie sa nenašlo</div>
          </Card>
        ) : (
          <>
            <div
              className="aspect-[21/9] rounded-2xl bg-muted bg-cover bg-center mb-8"
              style={data.event.image_url ? { backgroundImage: `url(${data.event.image_url})` } : undefined}
            />
            <div className="grid lg:grid-cols-[1fr_360px] gap-10">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">{data.event.category}</span>
                <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight mt-2">{data.event.title}</h1>
                <div className="flex flex-wrap gap-4 mt-4 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><Calendar className="size-4" /> {data.event.event_date} · {data.event.event_time}</span>
                  <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" /> {data.event.venue}, {data.event.city}</span>
                </div>
                {data.event.description && (
                  <p className="text-foreground/80 leading-relaxed mt-8 whitespace-pre-line">{data.event.description}</p>
                )}
              </div>
              <Card className="p-6 bg-card/60 border-border/50 h-fit sticky top-28">
                <h2 className="font-display font-semibold text-lg mb-4">Vstupenky</h2>
                {data.tickets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Vstupenky budú onedlho v predaji.</p>
                ) : (
                  <div className="space-y-3">
                    {data.tickets.map((t) => (
                      <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/20">
                        <div>
                          <div className="font-medium text-sm">{t.name}</div>
                          <div className="text-xs text-muted-foreground">Dostupné: {t.quantity}</div>
                        </div>
                        <div className="font-display font-bold">€{Number(t.price).toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                )}
                <Button className="w-full mt-5 bg-gradient-flame text-primary-foreground shadow-glow">
                  <Ticket className="size-4 mr-2" /> Kúpiť vstupenky
                </Button>
              </Card>
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
