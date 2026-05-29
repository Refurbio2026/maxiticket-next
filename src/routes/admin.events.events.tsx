import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getEvents, deleteEvent, upsertEvent, emit, EVENTS_EVENT, type EventItem } from "@/lib/local-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/events/events")({
  head: () => ({ meta: [{ title: "Podujatia · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const [events, setEvents] = useState<EventItem[]>([]);

  useEffect(() => {
    const load = () => setEvents(getEvents());
    load();
    window.addEventListener(EVENTS_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(EVENTS_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  const setStatus = (e: EventItem, status: "draft" | "published") => {
    upsertEvent({ ...e, status });
    emit(EVENTS_EVENT);
    toast.success(status === "published" ? "Schválené a publikované" : "Stiahnuté ako koncept");
  };

  const remove = (id: string) => {
    if (!confirm("Naozaj zmazať podujatie?")) return;
    deleteEvent(id);
    emit(EVENTS_EVENT);
    toast.success("Zmazané");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Podujatia</h1>
        <p className="text-muted-foreground mt-1">Všetky podujatia v systéme.</p>
      </div>
      {events.length === 0 ? (
        <Card className="p-12 text-center bg-card/60 border-dashed">
          <div className="font-semibold">Žiadne podujatia</div>
        </Card>
      ) : (
        <Card className="bg-card/60 border-border/50 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left p-3">Názov</th>
                <th className="text-left p-3">Kategória</th>
                <th className="text-left p-3">Dátum</th>
                <th className="text-left p-3">Mesto</th>
                <th className="text-left p-3">Stav</th>
                <th className="text-right p-3">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-border/20 hover:bg-muted/10">
                  <td className="p-3 font-medium">{e.title}</td>
                  <td className="p-3 text-muted-foreground">{e.category}</td>
                  <td className="p-3 text-muted-foreground">{e.event_date}</td>
                  <td className="p-3 text-muted-foreground">{e.city}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      e.status === "published"
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "bg-muted text-muted-foreground border-border/50"
                    }`}>
                      {e.status === "published" ? "Publikované" : "Koncept"}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-2">
                    {e.status === "draft" ? (
                      <Button size="sm" variant="outline" onClick={() => setStatus(e, "published")}>Schváliť</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setStatus(e, "draft")}>Zamietnuť</Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => remove(e.id)}>Zmazať</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
