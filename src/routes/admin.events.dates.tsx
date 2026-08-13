import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CalendarClock, Pencil, Plus, Trash2, Ban, RotateCcw, Copy } from "lucide-react";
import {
  listAllEventDates,
  upsertEventDate,
  deleteEventDate,
  type EventDateWithEvent,
} from "@/lib/event-dates.functions";
import { useEvents } from "@/hooks/use-events";

export const Route = createFileRoute("/admin/events/dates")({
  head: () => ({ meta: [{ title: "Termíny · vipky.sk Admin" }] }),
  component: Page,
});

type Form = {
  id?: string;
  event_id: string;
  event_date: string;
  event_time: string;
  status: "on_sale" | "cancelled";
  total_tickets: string;
  note: string;
};

const emptyForm: Form = {
  event_id: "",
  event_date: "",
  event_time: "19:00",
  status: "on_sale",
  total_tickets: "",
  note: "",
};

const dayNames = ["ne", "po", "ut", "st", "št", "pi", "so"];

function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${dayNames[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

function toForm(d: EventDateWithEvent): Form {
  return {
    id: d.id,
    event_id: d.event_id,
    event_date: d.event_date,
    event_time: d.event_time,
    status: d.status,
    total_tickets: d.total_tickets ? String(d.total_tickets) : "",
    note: d.note ?? "",
  };
}

function Page() {
  const qc = useQueryClient();
  const fetchDates = useServerFn(listAllEventDates);
  const saveDate = useServerFn(upsertEventDate);
  const removeDate = useServerFn(deleteEventDate);
  const { data: events = [] } = useEvents({ scope: "mine" });

  const [when, setWhen] = useState<"upcoming" | "past" | "all">("upcoming");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Form | null>(null);

  const dates = useQuery({
    queryKey: ["event-dates", when, search],
    queryFn: () => fetchDates({ data: { when, search: search || undefined } }),
  });

  const saveMutation = useMutation({
    mutationFn: (form: Form) =>
      saveDate({
        data: {
          id: form.id,
          event_id: form.event_id,
          event_date: form.event_date,
          event_time: form.event_time,
          status: form.status,
          total_tickets: form.total_tickets ? Number(form.total_tickets) : null,
          note: form.note || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event-dates"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success("Termín uložený");
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeDate({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event-dates"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success("Termín zmazaný");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const rows = useMemo(() => dates.data ?? [], [dates.data]);

  // Termíny zoskupené po podujatiach — organizátor rozmýšľa v predstaveniach,
  // nie v samostatných dátumoch.
  const grouped = useMemo(() => {
    const map = new Map<string, EventDateWithEvent[]>();
    for (const r of rows) {
      const list = map.get(r.event_id) || [];
      list.push(r);
      map.set(r.event_id, list);
    }
    return [...map.entries()];
  }, [rows]);

  const openNew = (eventId?: string) =>
    setEditing({ ...emptyForm, event_id: eventId ?? events[0]?.id ?? "" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Termíny</h1>
          <p className="text-muted-foreground mt-1">
            Jedno podujatie môže mať viac dátumov. Kupujúci si termín vyberie a sedadlá sa držia
            zvlášť pre každý z nich.
          </p>
        </div>
        <Button
          onClick={() => openNew()}
          disabled={events.length === 0}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          <Plus className="size-4 mr-2" /> Nový termín
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Hľadať podujatie, miesto alebo mesto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={when} onValueChange={(v) => setWhen(v as typeof when)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="upcoming">Nadchádzajúce</SelectItem>
            <SelectItem value="past">Odohrané</SelectItem>
            <SelectItem value="all">Všetky</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "termín" : rows.length < 5 ? "termíny" : "termínov"}
        </span>
      </div>

      {dates.isLoading && (
        <Card className="bg-card/60 border-border/50 p-10 text-center text-muted-foreground">
          <Loader2 className="mx-auto size-5 animate-spin" />
        </Card>
      )}

      {!dates.isLoading && grouped.length === 0 && (
        <Card className="bg-card/60 border-dashed p-10 text-center text-muted-foreground">
          Žiadne termíny v tomto výbere.
        </Card>
      )}

      {grouped.map(([eventId, list]) => (
        <Card key={eventId} className="bg-card/60 border-border/50 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
            <div>
              <div className="font-semibold">
                {list[0].event_title}
                {list[0].event_status === "draft" && (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    koncept
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {list[0].venue}
                {list[0].city ? `, ${list[0].city}` : ""}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => openNew(eventId)}>
              <Plus className="size-3.5 mr-1.5" /> Pridať termín
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Termín</th>
                  <th className="px-4 py-3 font-medium">Stav</th>
                  <th className="px-4 py-3 font-medium text-right">Kapacita</th>
                  <th className="px-4 py-3 font-medium text-right">Predané</th>
                  <th className="px-4 py-3 font-medium text-right">Držané</th>
                  <th className="px-4 py-3 font-medium text-right">Tržba</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className="border-b border-border/30 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium">
                        <CalendarClock className="size-3.5 text-muted-foreground" />
                        {formatDate(d.event_date)}
                        <span className="text-muted-foreground">{d.event_time}</span>
                      </div>
                      {d.note && (
                        <div className="text-xs text-muted-foreground mt-0.5">{d.note}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {d.status === "cancelled" ? (
                        <Badge variant="destructive" className="text-[10px]">
                          zrušený
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 text-[10px]">
                          v predaji
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {d.total_tickets ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{d.sold}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {d.reserved || "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {d.revenue ? `€${d.revenue.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setEditing(toForm(d))}>
                          <Pencil className="size-3.5 mr-1.5" /> Upraviť
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Duplikovať o týždeň neskôr"
                          onClick={() => {
                            const next = new Date(`${d.event_date}T00:00:00`);
                            next.setDate(next.getDate() + 7);
                            const { id: _omit, ...rest } = toForm(d);
                            setEditing({
                              ...rest,
                              status: "on_sale",
                              event_date: next.toISOString().slice(0, 10),
                            });
                          }}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title={d.status === "cancelled" ? "Vrátiť do predaja" : "Zrušiť termín"}
                          onClick={() =>
                            saveMutation.mutate({
                              ...toForm(d),
                              status: d.status === "cancelled" ? "on_sale" : "cancelled",
                            })
                          }
                        >
                          {d.status === "cancelled" ? (
                            <RotateCcw className="size-3.5" />
                          ) : (
                            <Ban className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Zmazať termín ${formatDate(d.event_date)}?`)) {
                              deleteMutation.mutate(d.id);
                            }
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Upraviť termín" : "Nový termín"}</DialogTitle>
            <DialogDescription>
              Obsadenosť sedadiel aj kapacita sa počítajú zvlášť pre každý termín.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Podujatie</Label>
                <Select
                  value={editing.event_id}
                  onValueChange={(v) => setEditing({ ...editing, event_id: v })}
                  disabled={!!editing.id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Vyber podujatie" />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Dátum</Label>
                <Input
                  type="date"
                  value={editing.event_date}
                  onChange={(e) => setEditing({ ...editing, event_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Čas</Label>
                <Input
                  type="time"
                  value={editing.event_time}
                  onChange={(e) => setEditing({ ...editing, event_time: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Kapacita termínu</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="ako podujatie"
                  value={editing.total_tickets}
                  onChange={(e) => setEditing({ ...editing, total_tickets: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Prázdne = použije sa kapacita podujatia.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Stav</Label>
                <Select
                  value={editing.status}
                  onValueChange={(v) => setEditing({ ...editing, status: v as Form["status"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on_sale">V predaji</SelectItem>
                    <SelectItem value="cancelled">Zrušený</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Poznámka</Label>
                <Textarea
                  rows={2}
                  placeholder="napr. matiné alebo predstavenie s tlmočením do posunkovej reči"
                  value={editing.note}
                  onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => editing && saveMutation.mutate(editing)}
              disabled={
                saveMutation.isPending ||
                !editing?.event_id ||
                !editing?.event_date ||
                !editing?.event_time
              }
            >
              {saveMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Uložiť
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
