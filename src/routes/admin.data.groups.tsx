import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listEventGroups,
  upsertEventGroup,
  deleteEventGroup,
  type EventGroupRecord,
} from "@/lib/event-groups.functions";
import { useEvents } from "@/hooks/use-events";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Loader2, FolderTree } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/data/groups")({
  head: () => ({ meta: [{ title: "Skupiny podujatí · vipky.sk Admin" }] }),
  component: Page,
});

type Form = {
  id?: string;
  name: string;
  description: string;
  image_url: string;
  sort_order: string;
  active: boolean;
  event_ids: string[];
};

const emptyForm: Form = {
  name: "",
  description: "",
  image_url: "",
  sort_order: "100",
  active: true,
  event_ids: [],
};

function Page() {
  const qc = useQueryClient();
  const fetchGroups = useServerFn(listEventGroups);
  const saveGroup = useServerFn(upsertEventGroup);
  const removeGroup = useServerFn(deleteEventGroup);

  const [editing, setEditing] = useState<Form | null>(null);

  const groups = useQuery({
    queryKey: ["event-groups"],
    queryFn: () => fetchGroups({ data: {} }),
  });
  const { data: events = [] } = useEvents({ scope: "all" });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["event-groups"] });
    // Katalóg aj formulár podujatia čítajú tú istú väzbu.
    qc.invalidateQueries({ queryKey: ["events"] });
  };

  const save = useMutation({
    mutationFn: (f: Form) =>
      saveGroup({
        data: {
          id: f.id,
          name: f.name,
          description: f.description || null,
          image_url: f.image_url || null,
          sort_order: Number(f.sort_order) || 100,
          active: f.active,
          event_ids: f.event_ids,
        },
      }),
    onSuccess: (_r, f) => {
      invalidate();
      toast.success(f.id ? "Skupina upravená" : "Skupina pridaná");
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeGroup({ data: { id } }),
    onSuccess: (res) => {
      invalidate();
      toast.success(
        res.deactivated
          ? `Skupina má ${res.events_count} podujatí — namiesto zmazania je skrytá.`
          : "Zmazané",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const rows = groups.data ?? [];

  const toForm = (g: EventGroupRecord): Form => ({
    id: g.id,
    name: g.name,
    description: g.description ?? "",
    image_url: g.image_url ?? "",
    sort_order: String(g.sort_order),
    active: g.active,
    event_ids: g.events.map((e) => e.id),
  });

  // Funkčný zápis stavu je tu nutnosť, nie štýl: dve zaškrtnutia v tom istom
  // tiku by pri kopírovaní z premennej `editing` navzájom prepísali výber.
  const toggleEvent = (id: string) => {
    setEditing((prev) => {
      if (!prev) return prev;
      const has = prev.event_ids.includes(id);
      return {
        ...prev,
        event_ids: has ? prev.event_ids.filter((x) => x !== id) : [...prev.event_ids, id],
      };
    });
  };

  // Podujatie patrí najviac do jednej skupiny — cudzie priradenie treba vidieť
  // skôr, než ho niekto nevedomky prevezme.
  const otherGroup = (eventId: string) =>
    rows.find((g) => g.id !== editing?.id && g.events.some((e) => e.id === eventId));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Skupiny podujatí</h1>
          <p className="text-muted-foreground mt-1">
            Série, festivalové ročníky a predplatné cykly. Podujatie patrí najviac do jednej
            skupiny; v katalógu sa podľa nej dá filtrovať.
          </p>
        </div>
        <Button
          className="bg-gradient-flame text-primary-foreground shadow-glow"
          onClick={() => setEditing({ ...emptyForm })}
        >
          <Plus className="size-4 mr-1.5" /> Pridať skupinu
        </Button>
      </div>

      {groups.isLoading ? (
        <Card className="p-10 text-center bg-card/60 border-border/50">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center bg-card/60 border-dashed">
          <FolderTree className="mx-auto size-6 text-muted-foreground mb-2" />
          <div className="font-semibold">Žiadne skupiny</div>
          <p className="text-sm text-muted-foreground mt-1">
            Vytvor sériu a priraď do nej podujatia, ktoré patria k sebe.
          </p>
        </Card>
      ) : (
        <Card className="bg-card/60 border-border/50 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left p-3">Názov</th>
                <th className="text-left p-3">Slug</th>
                <th className="text-left p-3">Podujatia</th>
                <th className="text-right p-3">Poradie</th>
                <th className="text-right p-3">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id} className="border-b border-border/20 hover:bg-muted/10 align-top">
                  <td className="p-3 font-medium">
                    {g.name}
                    {!g.active && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        skrytá
                      </Badge>
                    )}
                    {g.description && (
                      <div className="text-xs text-muted-foreground line-clamp-2 max-w-[280px]">
                        {g.description}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground font-mono text-xs">{g.slug}</td>
                  <td className="p-3 text-muted-foreground max-w-[300px]">
                    {g.events.length === 0 ? (
                      "—"
                    ) : (
                      <div className="space-y-0.5">
                        {g.events.slice(0, 3).map((e) => (
                          <div key={e.id} className="truncate text-xs">
                            {e.title}
                            <span className="text-muted-foreground/70"> · {e.event_date}</span>
                          </div>
                        ))}
                        {g.events.length > 3 && (
                          <div className="text-xs text-muted-foreground/70">
                            +{g.events.length - 3} ďalších
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {g.sort_order}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(toForm(g))}>
                      <Pencil className="size-3.5 mr-1" /> Upraviť
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Zmazať skupinu „${g.name}"?`)) remove.mutate(g.id);
                      }}
                    >
                      <Trash2 className="size-3.5 mr-1" /> Zmazať
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Upraviť skupinu" : "Nová skupina"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Názov</Label>
                <Input
                  autoFocus
                  maxLength={200}
                  placeholder="napr. Letný Open Air 2026"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Poradie v ponuke</Label>
                  <Input
                    type="number"
                    min={0}
                    value={editing.sort_order}
                    onChange={(e) => setEditing({ ...editing, sort_order: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Zobrazovať</Label>
                  <div className="flex h-10 items-center">
                    <Switch
                      checked={editing.active}
                      onCheckedChange={(v) => setEditing({ ...editing, active: v })}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Obrázok (URL)</Label>
                <Input
                  maxLength={1000}
                  placeholder="https://…"
                  value={editing.image_url}
                  onChange={(e) => setEditing({ ...editing, image_url: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Popis</Label>
                <Textarea
                  rows={3}
                  maxLength={2000}
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Podujatia v skupine ({editing.event_ids.length})</Label>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border/50 divide-y divide-border/30">
                  {events.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground">
                      Zatiaľ žiadne podujatia.
                    </div>
                  )}
                  {events.map((e) => {
                    const other = otherGroup(e.id);
                    return (
                      <label
                        key={e.id}
                        className="flex items-center gap-3 p-2.5 hover:bg-muted/20 cursor-pointer"
                      >
                        <Checkbox
                          checked={editing.event_ids.includes(e.id)}
                          onCheckedChange={() => toggleEvent(e.id)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm truncate">{e.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {e.event_date} · {e.city}
                            {e.status !== "published" && " · koncept"}
                          </div>
                        </div>
                        {other && (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            v skupine {other.name}
                          </Badge>
                        )}
                      </label>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Zaškrtnutím prevezmeš podujatie aj z inej skupiny — patriť môže len do jednej.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => editing && save.mutate(editing)}
              disabled={save.isPending || !editing?.name.trim()}
              className="bg-gradient-flame text-primary-foreground shadow-glow"
            >
              {save.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              {editing?.id ? "Uložiť" : "Vytvoriť"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
