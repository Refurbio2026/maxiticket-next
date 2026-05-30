import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  listLayouts,
  deleteLayout,
  duplicateLayout,
  emptyLayout,
  upsertLayout,
  computeCapacity,
  HALL_TYPE_LABEL,
  LAYOUTS_EVENT,
  type HallLayout,
  type HallType,
} from "@/lib/layouts-db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import {
  Plus,
  Pencil,
  Copy,
  Trash2,
  LayoutGrid,
  ChevronRight,
  Wand2,
  Users as UsersIcon,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/events/hall-layouts")({
  head: () => ({ meta: [{ title: "Definície rozloženia haly · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const navigate = useNavigate();
  const [items, setItems] = useState<HallLayout[]>([]);
  const [openNew, setOpenNew] = useState(false);
  const [form, setForm] = useState<{ name: string; type: HallType; city: string }>({
    name: "",
    type: "koncertna-hala",
    city: "",
  });

  useEffect(() => {
    const refresh = () => setItems(listLayouts());
    refresh();
    window.addEventListener(LAYOUTS_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LAYOUTS_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const openEditorBlank = () => {
    const l = emptyLayout("Nová hala");
    upsertLayout(l);
    navigate({ to: "/admin/events/hall-layouts/$id", params: { id: l.id } });
  };

  const createFromForm = () => {
    if (!form.name.trim()) {
      toast.error("Zadaj názov haly");
      return;
    }
    const l = emptyLayout(form.name.trim());
    l.type = form.type;
    l.city = form.city.trim() || undefined;
    upsertLayout(l);
    setOpenNew(false);
    setForm({ name: "", type: "koncertna-hala", city: "" });
    navigate({ to: "/admin/events/hall-layouts/$id", params: { id: l.id } });
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link to="/admin" className="hover:text-foreground">Admin</Link>
        <ChevronRight className="h-3 w-3" />
        <span>Podujatia</span>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Definície rozloženia haly</span>
      </nav>

      {/* Hero */}
      <div className="rounded-xl border border-border/40 bg-gradient-to-br from-primary/10 via-card to-card p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <LayoutGrid className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Definície rozloženia haly</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Vizuálny editor sektorov, radov a sedadiel. Vytvor mapu sály — štadión, kino,
              divadlo, festival — a použi ju pri predaji vstupeniek.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={openEditorBlank} className="gap-2">
              <Wand2 className="h-4 w-4" />
              Editor hál
            </Button>
            <Button onClick={() => setOpenNew(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Vytvoriť nové rozloženie
            </Button>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {items.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-4 p-12 text-center border-dashed">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LayoutGrid className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Zatiaľ nemáš žiadne rozloženie</h2>
            <p className="text-sm text-muted-foreground max-w-md">
              Vytvor prvú halu — pomenuj ju, vyber typ priestoru a pokračuj rovno do
              vizuálneho editora.
            </p>
          </div>
          <Button size="lg" onClick={() => setOpenNew(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Vytvoriť prvú halu
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((l) => {
            const cap = l.capacity ?? computeCapacity(l.shapes);
            return (
              <Card
                key={l.id}
                className="group relative overflow-hidden p-0 transition hover:border-primary/40 hover:shadow-md"
              >
                <Link
                  to="/admin/events/hall-layouts/$id"
                  params={{ id: l.id }}
                  className="block"
                >
                  <div className="aspect-[16/9] bg-gradient-to-br from-muted/40 to-muted/10 border-b border-border/40 flex items-center justify-center">
                    <LayoutGrid className="h-10 w-10 text-muted-foreground/40 group-hover:text-primary/60 transition" />
                  </div>
                  <div className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold leading-tight truncate">{l.name}</h3>
                      <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {HALL_TYPE_LABEL[l.type]}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {l.city ?? "—"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <UsersIcon className="h-3 w-3" />
                        {cap} miest
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground/80">
                      Aktualizované {new Date(l.updated_at).toLocaleString("sk-SK")}
                    </div>
                  </div>
                </Link>
                <div className="flex border-t border-border/40 divide-x divide-border/40">
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="flex-1 rounded-none gap-1.5"
                  >
                    <Link to="/admin/events/hall-layouts/$id" params={{ id: l.id }}>
                      <Pencil className="h-3.5 w-3.5" />
                      Upraviť
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 rounded-none gap-1.5"
                    onClick={() => {
                      duplicateLayout(l.id);
                      toast.success("Hala duplikovaná");
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Duplikovať
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 rounded-none gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Zmazať halu „${l.name}“?`)) {
                        deleteLayout(l.id);
                        toast.success("Hala zmazaná");
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Zmazať
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* New layout dialog */}
      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nové rozloženie haly</DialogTitle>
            <DialogDescription>
              Vyplň základné údaje. Detailné rozloženie sektorov a sedadiel pridáš v editore.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="hall-name">Názov haly *</Label>
              <Input
                id="hall-name"
                placeholder="napr. Tipos aréna"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Typ priestoru</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v as HallType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(HALL_TYPE_LABEL) as HallType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {HALL_TYPE_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hall-city">Mesto</Label>
              <Input
                id="hall-city"
                placeholder="napr. Bratislava"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenNew(false)}>
              Zrušiť
            </Button>
            <Button onClick={createFromForm} className="gap-2">
              <Wand2 className="h-4 w-4" />
              Otvoriť editor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
