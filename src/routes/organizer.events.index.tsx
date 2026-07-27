import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  getEvents, upsertEvent, deleteEvent, emit, EVENTS_EVENT, type EventItem,
} from "@/lib/local-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Eye, Trash2, CheckCircle2, FileText, Calendar, MapPin } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/events/")({
  head: () => ({ meta: [{ title: "Moje podujatia · vipky.sk" }] }),
  component: OrganizerEvents,
});

function OrganizerEvents() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventItem[]>([]);

  const load = () => {
    if (!user) return setEvents([]);
    setEvents(
      getEvents().filter((e) => user.role === "admin" || e.organizer_id === user.id),
    );
  };

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener(EVENTS_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENTS_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const togglePublish = (e: EventItem) => {
    upsertEvent({ ...e, status: e.status === "published" ? "draft" : "published" });
    emit(EVENTS_EVENT);
    toast.success(e.status === "published" ? "Podujatie skryté" : "Podujatie publikované");
  };

  const remove = (id: string) => {
    if (!confirm("Naozaj zmazať podujatie?")) return;
    deleteEvent(id);
    emit(EVENTS_EVENT);
    toast.success("Podujatie zmazané");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Moje podujatia</h1>
          <p className="text-muted-foreground mt-1">Spravuj koncepty, publikované podujatia a vstupenky.</p>
        </div>
        <Button asChild className="bg-gradient-flame text-primary-foreground shadow-glow">
          <Link to="/organizer/events/new"><Plus className="size-4 mr-2" /> Pridať podujatie</Link>
        </Button>
      </div>

      {events.length === 0 ? (
        <Card className="p-12 text-center bg-card/60 border-dashed border-border/50">
          <Calendar className="size-10 text-muted-foreground mx-auto mb-3" />
          <div className="font-semibold">Zatiaľ žiadne podujatia</div>
          <p className="text-sm text-muted-foreground mt-1">Začni pridaním prvého podujatia.</p>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((e) => (
            <Card key={e.id} className="overflow-hidden bg-card/60 border-border/50 flex flex-col">
              <div
                className="aspect-video bg-muted bg-cover bg-center"
                style={e.image_url ? { backgroundImage: `url(${e.image_url})` } : undefined}
              />
              <div className="p-5 space-y-2 flex-1 flex flex-col">
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
                <div className="flex flex-wrap gap-2 mt-auto pt-3">
                  {e.status === "published" && (
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/events/$id" params={{ id: e.id }}><Eye className="size-3.5 mr-1.5" /> Zobraziť</Link>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => togglePublish(e)}>
                    {e.status === "published"
                      ? <><FileText className="size-3.5 mr-1.5" /> Skryť</>
                      : <><CheckCircle2 className="size-3.5 mr-1.5" /> Publikovať</>}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(e.id)} className="text-destructive hover:text-destructive">
                    <Trash2 className="size-3.5 mr-1.5" /> Zmazať
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
