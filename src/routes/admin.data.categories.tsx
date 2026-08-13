import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listEventCategories,
  upsertEventCategory,
  deleteEventCategory,
  type EventCategoryRecord,
} from "@/lib/event-categories.functions";
import { useEvents } from "@/hooks/use-events";
import { pocetPodujati } from "@/lib/plural";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Eye, CalendarPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/data/categories")({
  head: () => ({ meta: [{ title: "Kategórie podujatí · vipky.sk Admin" }] }),
  component: Page,
});

type Form = {
  id?: string;
  name: string;
  description: string;
  sort_order: string;
  active: boolean;
};

const emptyForm: Form = { name: "", description: "", sort_order: "100", active: true };

function Page() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchCategories = useServerFn(listEventCategories);
  const saveCategory = useServerFn(upsertEventCategory);
  const removeCategory = useServerFn(deleteEventCategory);

  const [editing, setEditing] = useState<Form | null>(null);
  const [detail, setDetail] = useState<EventCategoryRecord | null>(null);

  const categories = useQuery({
    queryKey: ["event-categories"],
    queryFn: () => fetchCategories({ data: {} }),
  });
  // Detail kategórie vypisuje podujatia, ktoré do nej patria.
  const { data: events = [] } = useEvents({ scope: "all" });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["event-categories"] });
    // Ponuka vo formulári podujatia aj katalóg čítajú tie isté názvy.
    qc.invalidateQueries({ queryKey: ["events"] });
  };

  const saveMutation = useMutation({
    mutationFn: (form: Form) =>
      saveCategory({
        data: {
          id: form.id,
          name: form.name,
          description: form.description || null,
          sort_order: Number(form.sort_order) || 100,
          active: form.active,
        },
      }),
    onSuccess: (_r, form) => {
      invalidate();
      toast.success(form.id ? "Kategória upravená" : "Kategória pridaná");
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeCategory({ data: { id } }),
    onSuccess: (res) => {
      invalidate();
      toast.success(
        res.deactivated
          ? `Kategóriu používa ${pocetPodujati(res.events_count)} — namiesto zmazania je deaktivovaná.`
          : "Zmazané",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const rows = categories.data ?? [];

  const toForm = (c: EventCategoryRecord): Form => ({
    id: c.id,
    name: c.name,
    description: c.description ?? "",
    sort_order: String(c.sort_order),
    active: c.active,
  });

  const addEventTo = (c: EventCategoryRecord) =>
    navigate({
      to: "/admin/data/categories/$categoryId/events/new",
      params: { categoryId: c.id },
    });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Kategórie podujatí</h1>
          <p className="text-muted-foreground mt-1">
            Ponuka, z ktorej sa vyberá pri zakladaní podujatia, a podľa ktorej sa filtruje katalóg.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditing({ ...emptyForm })}>
            <Plus className="size-4 mr-1.5" /> Pridať kategóriu
          </Button>
          <Button
            className="bg-gradient-flame text-primary-foreground shadow-glow"
            onClick={() => {
              if (rows.length === 0) return toast.error("Najprv vytvor kategóriu");
              addEventTo(rows[0]);
            }}
          >
            <CalendarPlus className="size-4 mr-1.5" /> Pridať podujatie do kategórie
          </Button>
        </div>
      </div>

      {categories.isLoading ? (
        <Card className="p-10 text-center bg-card/60 border-border/50">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center bg-card/60 border-dashed">
          <div className="font-semibold">Žiadne kategórie</div>
          <p className="text-sm text-muted-foreground mt-1">Začni pridaním prvej kategórie.</p>
        </Card>
      ) : (
        <Card className="bg-card/60 border-border/50 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left p-3">Názov</th>
                <th className="text-left p-3">Slug</th>
                <th className="text-left p-3">Popis</th>
                <th className="text-right p-3">Poradie</th>
                <th className="text-right p-3">Podujatí</th>
                <th className="text-right p-3">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-border/20 hover:bg-muted/10">
                  <td className="p-3 font-medium">
                    {c.name}
                    {!c.active && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        skrytá
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground font-mono text-xs">{c.slug}</td>
                  <td className="p-3 text-muted-foreground truncate max-w-[280px]">
                    {c.description ?? "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {c.sort_order}
                  </td>
                  <td className="p-3 text-right tabular-nums">{c.events_count}</td>
                  <td className="p-3 text-right space-x-1 whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setDetail(c)}>
                      <Eye className="size-3.5 mr-1" /> Detail
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(toForm(c))}>
                      <Pencil className="size-3.5 mr-1" /> Upraviť
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => addEventTo(c)}>
                      <CalendarPlus className="size-3.5 mr-1" /> Pridať podujatie
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Zmazať kategóriu „${c.name}"?`)) deleteMutation.mutate(c.id);
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Upraviť kategóriu" : "Nová kategória"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Názov</Label>
                <Input
                  autoFocus
                  maxLength={80}
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Premenovanie sa prepíše aj do podujatí, ktoré kategóriu používajú. Slug si systém
                  odvodí sám.
                </p>
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
                  <Label>Zobrazovať v ponuke</Label>
                  <div className="flex h-10 items-center">
                    <Switch
                      checked={editing.active}
                      onCheckedChange={(v) => setEditing({ ...editing, active: v })}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Popis</Label>
                <Textarea
                  rows={3}
                  maxLength={500}
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
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
              disabled={saveMutation.isPending || !editing?.name.trim()}
              className="bg-gradient-flame text-primary-foreground shadow-glow"
            >
              {saveMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              {editing?.id ? "Uložiť" : "Vytvoriť"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Slug</div>
                <div className="font-mono">{detail.slug}</div>
              </div>
              {detail.description && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Popis
                  </div>
                  <div>{detail.description}</div>
                </div>
              )}
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Podujatia v kategórii ({detail.events_count})
                </div>
                <ul className="space-y-1">
                  {events
                    .filter((e) => e.category === detail.name)
                    .map((e) => (
                      <li
                        key={e.id}
                        className="flex items-center justify-between border-b border-border/30 py-1"
                      >
                        <span>{e.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {e.event_date} · {e.city}
                        </span>
                      </li>
                    ))}
                  {detail.events_count === 0 && (
                    <li className="text-muted-foreground text-xs">Zatiaľ žiadne podujatia.</li>
                  )}
                </ul>
              </div>
              <DialogFooter>
                <Button asChild variant="outline">
                  <Link
                    to="/admin/data/categories/$categoryId/events/new"
                    params={{ categoryId: detail.id }}
                  >
                    <CalendarPlus className="size-4 mr-1.5" /> Pridať podujatie
                  </Link>
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
