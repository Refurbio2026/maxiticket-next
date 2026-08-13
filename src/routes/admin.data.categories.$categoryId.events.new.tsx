import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { listEventCategories } from "@/lib/event-categories.functions";
import { listOrganizers } from "@/lib/events.functions";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useUpsertEvent } from "@/hooks/use-events";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/admin/data/categories/$categoryId/events/new")({
  head: () => ({ meta: [{ title: "Nové podujatie · vipky.sk Admin" }] }),
  component: NewEventForCategory,
});

type FormState = {
  title: string;
  event_date: string;
  event_time: string;
  venue: string;
  city: string;
  organizer_id: string;
  description: string;
  image_url: string;
  price: string;
  quantity: string;
  status: "draft" | "published";
};

function NewEventForCategory() {
  const { categoryId } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Kategória je v databáze; ponuku aj názov si vypýtame zo servera.
  const fetchCategories = useServerFn(listEventCategories);
  const { data: categories = [] } = useQuery({
    queryKey: ["event-categories", "active"],
    queryFn: () => fetchCategories({ data: { only_active: true } }),
  });
  const category = useMemo(
    () => categories.find((c) => c.id === categoryId),
    [categories, categoryId],
  );
  const upsert = useUpsertEvent();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>({
    title: "",
    event_date: "",
    event_time: "19:00",
    venue: "",
    city: "",
    organizer_id: "",
    description: "",
    image_url: "",
    price: "20",
    quantity: "100",
    status: "draft",
  });

  // Reálni organizátori z databázy (demo účty z localStorage tu nefungujú —
  // ich id nie sú UUID a server by ich odmietol).
  const fetchOrganizers = useServerFn(listOrganizers);
  const { data: organizers = [] } = useQuery({
    queryKey: ["organizers"],
    queryFn: () => fetchOrganizers({ data: undefined }),
  });

  useEffect(() => {
    if (organizers.length === 0) return;
    setForm((f) => ({ ...f, organizer_id: f.organizer_id || organizers[0].id }));
  }, [organizers]);

  const upd = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  if (!category) {
    return (
      <Card className="p-12 text-center bg-card/60 border-dashed border-border/50 max-w-2xl">
        <h2 className="font-display text-xl font-semibold mb-2">Kategória neexistuje</h2>
        <p className="text-muted-foreground mb-4">Vráť sa do zoznamu kategórií.</p>
        <Button asChild variant="outline">
          <Link to="/admin/data/categories">Späť na kategórie</Link>
        </Button>
      </Card>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error("Názov je povinný");
    if (!form.event_date) return toast.error("Dátum je povinný");
    if (!form.city.trim()) return toast.error("Mesto je povinné");
    const price = Number(form.price);
    const quantity = Number(form.quantity);
    if (Number.isNaN(price) || price < 0) return toast.error("Cena musí byť číslo");
    if (Number.isNaN(quantity) || quantity < 0 || !Number.isInteger(quantity))
      return toast.error("Počet vstupeniek musí byť celé číslo");

    const org = organizers.find((o) => o.id === form.organizer_id) ?? user;
    if (!org) return toast.error("Vyber organizátora");

    setBusy(true);
    try {
      // `organizer_id` server rešpektuje len adminovi — táto obrazovka je v admin zóne.
      await upsert.mutateAsync({
        organizer_id: org.id,
        title: form.title.trim(),
        category: category.name,
        event_date: form.event_date,
        event_time: form.event_time || "19:00",
        venue: form.venue.trim() || "—",
        city: form.city.trim(),
        description: form.description.trim() || null,
        image_url: form.image_url.trim() || null,
        status: form.status,
        tickets: [{ name: "Štandard", price, quantity }],
      });
      toast.success("Podujatie vytvorené");
      navigate({ to: "/admin/events/events" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Podujatie sa nepodarilo vytvoriť");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6 max-w-4xl">
      <div>
        <Button asChild type="button" variant="ghost" size="sm" className="mb-3">
          <Link to="/admin/data/categories">
            <ChevronLeft className="size-4 mr-1" /> Späť na kategórie
          </Link>
        </Button>
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
          Kategória · {category.name}
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Nové podujatie</h1>
        <p className="text-muted-foreground mt-1">Kategória je predvyplnená podľa výberu.</p>
      </div>

      <Card className="p-6 bg-card/60 border-border/50 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 space-y-2">
            <Label>Názov podujatia *</Label>
            <Input
              required
              maxLength={120}
              value={form.title}
              onChange={(e) => upd("title", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Kategória *</Label>
            <Input value={category.name} disabled />
          </div>
          <div className="space-y-2">
            <Label>Stav *</Label>
            <Select
              value={form.status}
              onValueChange={(v: "draft" | "published") => upd("status", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Koncept</SelectItem>
                <SelectItem value="published">Publikované</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Dátum *</Label>
            <Input
              type="date"
              required
              value={form.event_date}
              onChange={(e) => upd("event_date", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Čas *</Label>
            <Input
              type="time"
              required
              value={form.event_time}
              onChange={(e) => upd("event_time", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Miesto konania *</Label>
            <Input
              required
              maxLength={120}
              value={form.venue}
              onChange={(e) => upd("venue", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Mesto *</Label>
            <Input
              required
              maxLength={80}
              value={form.city}
              onChange={(e) => upd("city", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2 space-y-2">
            <Label>Organizátor *</Label>
            <Select value={form.organizer_id} onValueChange={(v) => upd("organizer_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Vyber organizátora" />
              </SelectTrigger>
              <SelectContent>
                {organizers.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.full_name} {o.email ? `· ${o.email}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Cena vstupenky (€) *</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.price}
              onChange={(e) => upd("price", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Počet vstupeniek *</Label>
            <Input
              type="number"
              min="0"
              step="1"
              required
              value={form.quantity}
              onChange={(e) => upd("quantity", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2 space-y-2">
            <Label>URL obrázka</Label>
            <Input
              placeholder="https://…"
              maxLength={500}
              value={form.image_url}
              onChange={(e) => upd("image_url", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2 space-y-2">
            <Label>Popis</Label>
            <Textarea
              rows={5}
              maxLength={2000}
              value={form.description}
              onChange={(e) => upd("description", e.target.value)}
            />
          </div>
        </div>
      </Card>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: "/admin/data/categories" })}
        >
          Zrušiť
        </Button>
        <Button
          type="submit"
          disabled={busy}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          {busy ? "Ukladám…" : "Uložiť podujatie"}
        </Button>
      </div>
    </form>
  );
}
