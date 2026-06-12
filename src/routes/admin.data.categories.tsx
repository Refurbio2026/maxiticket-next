import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getCategories, upsertCategory, deleteCategory, uid, emit,
  CATEGORIES_EVENT, EVENTS_EVENT, getEvents,
  type EventCategory,
} from "@/lib/local-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Eye, CalendarPlus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/data/categories")({
  head: () => ({ meta: [{ title: "Kategórie podujatí · vstupenky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const navigate = useNavigate();
  const [cats, setCats] = useState<EventCategory[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<EventCategory | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [detail, setDetail] = useState<EventCategory | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", description: "" });

  const load = () => {
    const list = getCategories();
    setCats(list);
    const evts = getEvents();
    const map: Record<string, number> = {};
    for (const c of list) {
      map[c.id] = evts.filter((e) => e.category === c.name).length;
    }
    setCounts(map);
  };

  useEffect(() => {
    load();
    window.addEventListener(CATEGORIES_EVENT, load);
    window.addEventListener(EVENTS_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(CATEGORIES_EVENT, load);
      window.removeEventListener(EVENTS_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", slug: "", description: "" });
    setOpenForm(true);
  };

  const openEdit = (c: EventCategory) => {
    setEditing(c);
    setForm({ name: c.name, slug: c.slug, description: c.description ?? "" });
    setOpenForm(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return toast.error("Názov je povinný");
    const slug = (form.slug.trim() || name.toLowerCase().replace(/\s+/g, "-"))
      .replace(/[^a-z0-9-]/g, "");
    const cat: EventCategory = editing
      ? { ...editing, name, slug, description: form.description.trim() || undefined }
      : {
          id: uid(),
          name,
          slug,
          description: form.description.trim() || undefined,
          created_at: new Date().toISOString(),
        };
    upsertCategory(cat);
    emit(CATEGORIES_EVENT);
    toast.success(editing ? "Kategória upravená" : "Kategória pridaná");
    setOpenForm(false);
  };

  const remove = (c: EventCategory) => {
    if (!confirm(`Zmazať kategóriu „${c.name}"?`)) return;
    deleteCategory(c.id);
    emit(CATEGORIES_EVENT);
    toast.success("Zmazané");
  };

  const addEventTo = (c: EventCategory) => {
    navigate({
      to: "/admin/data/categories/$categoryId/events/new",
      params: { categoryId: c.id },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Kategórie podujatí</h1>
          <p className="text-muted-foreground mt-1">Hlavné kategórie (Koncert, Šport, …) a podujatia v nich.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openCreate}>
            <Plus className="size-4 mr-1.5" /> Pridať kategóriu
          </Button>
          <Button
            className="bg-gradient-flame text-primary-foreground shadow-glow"
            onClick={() => {
              if (cats.length === 0) return toast.error("Najprv vytvor kategóriu");
              addEventTo(cats[0]);
            }}
          >
            <CalendarPlus className="size-4 mr-1.5" /> Pridať podujatie do kategórie
          </Button>
        </div>
      </div>

      {cats.length === 0 ? (
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
                <th className="text-right p-3">Podujatí</th>
                <th className="text-right p-3">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.id} className="border-b border-border/20 hover:bg-muted/10">
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3 text-muted-foreground font-mono text-xs">{c.slug}</td>
                  <td className="p-3 text-muted-foreground truncate max-w-[280px]">{c.description ?? "—"}</td>
                  <td className="p-3 text-right font-mono">{counts[c.id] ?? 0}</td>
                  <td className="p-3 text-right space-x-1 whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setDetail(c)}>
                      <Eye className="size-3.5 mr-1" /> Detail
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                      <Pencil className="size-3.5 mr-1" /> Upraviť
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => addEventTo(c)}>
                      <CalendarPlus className="size-3.5 mr-1" /> Pridať podujatie
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => remove(c)}>
                      <Trash2 className="size-3.5 mr-1" /> Zmazať
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Upraviť kategóriu" : "Nová kategória"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>Názov *</Label>
              <Input required maxLength={80} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input placeholder="auto-z-nazvu" maxLength={80} value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Popis</Label>
              <Textarea rows={3} maxLength={500} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpenForm(false)}>Zrušiť</Button>
              <Button type="submit" className="bg-gradient-flame text-primary-foreground shadow-glow">
                {editing ? "Uložiť" : "Vytvoriť"}
              </Button>
            </DialogFooter>
          </form>
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
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Popis</div>
                  <div>{detail.description}</div>
                </div>
              )}
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Podujatia v kategórii ({counts[detail.id] ?? 0})
                </div>
                <ul className="space-y-1">
                  {getEvents().filter((e) => e.category === detail.name).map((e) => (
                    <li key={e.id} className="flex items-center justify-between border-b border-border/30 py-1">
                      <span>{e.title}</span>
                      <span className="text-xs text-muted-foreground">{e.event_date} · {e.city}</span>
                    </li>
                  ))}
                  {(counts[detail.id] ?? 0) === 0 && (
                    <li className="text-muted-foreground text-xs">Zatiaľ žiadne podujatia.</li>
                  )}
                </ul>
              </div>
              <DialogFooter>
                <Button asChild variant="outline">
                  <Link to="/admin/data/categories/$categoryId/events/new" params={{ categoryId: detail.id }}>
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
