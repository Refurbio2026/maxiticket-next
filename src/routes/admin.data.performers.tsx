import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  listPerformers,
  upsertPerformer,
  deletePerformer,
  type PerformerRecord,
} from "@/lib/performers.functions";
import { useEvents } from "@/hooks/use-events";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Pencil, Trash2, Search, Loader2, Music, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/data/performers")({
  head: () => ({ meta: [{ title: "Účinkujúci · vipky.sk Admin" }] }),
  component: Page,
});

type Form = {
  id?: string;
  name: string;
  genre: string;
  city: string;
  bio: string;
  image_url: string;
  website: string;
  active: boolean;
  event_ids: string[];
};

const emptyForm: Form = {
  name: "",
  genre: "",
  city: "",
  bio: "",
  image_url: "",
  website: "",
  active: true,
  event_ids: [],
};

function Page() {
  const qc = useQueryClient();
  const fetchPerformers = useServerFn(listPerformers);
  const savePerformer = useServerFn(upsertPerformer);
  const removePerformer = useServerFn(deletePerformer);

  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Form | null>(null);

  const performers = useQuery({
    queryKey: ["performers"],
    queryFn: () => fetchPerformers({ data: {} }),
  });
  // Zostava sa priraďuje tu, takže potrebujeme aj koncepty a odohrané podujatia.
  const { data: events = [] } = useEvents({ scope: "all" });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["performers"] });

  const saveMutation = useMutation({
    mutationFn: (form: Form) =>
      savePerformer({
        data: {
          id: form.id,
          name: form.name,
          genre: form.genre || null,
          city: form.city || null,
          bio: form.bio || null,
          image_url: form.image_url || null,
          website: form.website || null,
          active: form.active,
          event_ids: form.event_ids,
        },
      }),
    onSuccess: (_r, form) => {
      invalidate();
      toast.success(form.id ? "Účinkujúci upravený" : "Účinkujúci pridaný");
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removePerformer({ data: { id } }),
    onSuccess: (res) => {
      invalidate();
      toast.success(
        res.deactivated
          ? `Účinkujúci vystupuje na ${res.events_count} ${
              res.events_count === 1 ? "podujatí" : "podujatiach"
            } — namiesto zmazania je skrytý.`
          : "Zmazané",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const rows = useMemo(() => {
    const all = performers.data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((p) =>
      [p.name, p.genre, p.city].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [performers.data, q]);

  const toForm = (p: PerformerRecord): Form => ({
    id: p.id,
    name: p.name,
    genre: p.genre ?? "",
    city: p.city ?? "",
    bio: p.bio ?? "",
    image_url: p.image_url ?? "",
    website: p.website ?? "",
    active: p.active,
    event_ids: p.events.map((e) => e.id),
  });

  const toggleEvent = (id: string) => {
    if (!editing) return;
    const has = editing.event_ids.includes(id);
    setEditing({
      ...editing,
      event_ids: has ? editing.event_ids.filter((x) => x !== id) : [...editing.event_ids, id],
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Účinkujúci</h1>
          <p className="text-muted-foreground mt-1">
            Umelci, kapely, hostia a súbory. Zostava sa zobrazuje na verejnej stránke Umelci.
          </p>
        </div>
        <Button
          className="bg-gradient-flame text-primary-foreground shadow-glow"
          onClick={() => setEditing({ ...emptyForm })}
        >
          <Plus className="size-4 mr-1.5" /> Pridať účinkujúceho
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Hľadať podľa mena, žánru alebo mesta…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
        />
      </div>

      {performers.isLoading ? (
        <Card className="p-10 text-center bg-card/60 border-border/50">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center bg-card/60 border-dashed">
          <Music className="mx-auto size-6 text-muted-foreground mb-2" />
          <div className="font-semibold">
            {q ? "Nikto nezodpovedá hľadaniu" : "Zatiaľ žiadni účinkujúci"}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {q
              ? "Skús iné meno alebo žáner."
              : "Pridaj prvého umelca — objaví sa na verejnej stránke Umelci."}
          </p>
        </Card>
      ) : (
        <Card className="bg-card/60 border-border/50 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left p-3">Meno</th>
                <th className="text-left p-3">Žáner</th>
                <th className="text-left p-3">Mesto</th>
                <th className="text-left p-3">Podujatia</th>
                <th className="text-right p-3">Nadchádzajúce</th>
                <th className="text-right p-3">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-border/20 hover:bg-muted/10 align-top">
                  <td className="p-3 font-medium">
                    <div className="flex items-center gap-2">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt=""
                          className="size-8 rounded-full object-cover border border-border/50"
                        />
                      ) : (
                        <div className="size-8 rounded-full bg-muted/40 grid place-items-center">
                          <Music className="size-3.5 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        {p.name}
                        {!p.active && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            skrytý
                          </Badge>
                        )}
                        <div className="text-[11px] text-muted-foreground font-mono">{p.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-muted-foreground">{p.genre || "—"}</td>
                  <td className="p-3 text-muted-foreground">{p.city || "—"}</td>
                  <td className="p-3 text-muted-foreground max-w-[320px]">
                    {p.events.length === 0 ? (
                      "—"
                    ) : (
                      <div className="space-y-0.5">
                        {p.events.slice(0, 3).map((e) => (
                          <div key={e.id} className="truncate text-xs">
                            {e.title}
                            <span className="text-muted-foreground/70"> · {e.event_date}</span>
                          </div>
                        ))}
                        {p.events.length > 3 && (
                          <div className="text-xs text-muted-foreground/70">
                            +{p.events.length - 3} ďalších
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">{p.upcoming_count}</td>
                  <td className="p-3 text-right space-x-1 whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(toForm(p))}>
                      <Pencil className="size-3.5 mr-1" /> Upraviť
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Zmazať účinkujúceho „${p.name}"?`))
                          deleteMutation.mutate(p.id);
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
            <DialogTitle>{editing?.id ? "Upraviť účinkujúceho" : "Nový účinkujúci"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Meno / názov</Label>
                  <Input
                    autoFocus
                    maxLength={200}
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Žáner</Label>
                  <Input
                    list="performer-genres"
                    maxLength={80}
                    placeholder="napr. Rock, Rap, Divadlo"
                    value={editing.genre}
                    onChange={(e) => setEditing({ ...editing, genre: e.target.value })}
                  />
                  {/* Ponuka sa skladá z už použitých žánrov — nie je to číselník,
                      len pomôcka proti preklepom. */}
                  <datalist id="performer-genres">
                    {[...new Set((performers.data ?? []).map((p) => p.genre).filter(Boolean))].map(
                      (g) => (
                        <option key={g as string} value={g as string} />
                      ),
                    )}
                  </datalist>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mesto</Label>
                  <Input
                    maxLength={120}
                    value={editing.city}
                    onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Web</Label>
                  <Input
                    maxLength={500}
                    placeholder="https://…"
                    value={editing.website}
                    onChange={(e) => setEditing({ ...editing, website: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Fotka (URL)</Label>
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
                  maxLength={4000}
                  value={editing.bio}
                  onChange={(e) => setEditing({ ...editing, bio: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                <div>
                  <div className="font-medium text-sm">Zobrazovať na webe</div>
                  <p className="text-xs text-muted-foreground">
                    Skrytý účinkujúci ostáva pri podujatiach, len sa nevypisuje.
                  </p>
                </div>
                <Switch
                  checked={editing.active}
                  onCheckedChange={(v) => setEditing({ ...editing, active: v })}
                />
              </div>

              <div className="space-y-2">
                <Label>Vystupuje na podujatiach ({editing.event_ids.length})</Label>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border/50 divide-y divide-border/30">
                  {events.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground">
                      Zatiaľ žiadne podujatia.
                    </div>
                  )}
                  {events.map((e) => (
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
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {editing?.website && (
              <Button asChild variant="ghost" className="mr-auto">
                <a href={editing.website} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4 mr-1.5" /> Otvoriť web
                </a>
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(null)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => editing && saveMutation.mutate(editing)}
              disabled={saveMutation.isPending || !editing?.name.trim()}
              className="bg-gradient-flame text-primary-foreground shadow-glow"
            >
              {saveMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              {editing?.id ? "Uložiť" : "Vytvoriť"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
