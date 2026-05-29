import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/events/new")({
  head: () => ({ meta: [{ title: "Nové podujatie · MAXITICKET" }] }),
  component: NewEventPage,
});

const CATEGORIES = ["Koncert", "Festival", "Šport", "Konferencia", "Divadlo", "Stand-up", "Kultúra"];

type Tt = { name: string; price: string; quantity: string };

function NewEventPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    category: CATEGORIES[0],
    event_date: "",
    event_time: "",
    venue: "",
    city: "",
    description: "",
    image_url: "",
    status: "draft" as "draft" | "published",
  });
  const [tickets, setTickets] = useState<Tt[]>([
    { name: "Štandard", price: "20", quantity: "100" },
  ]);

  const upd = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    const { data: event, error } = await supabase
      .from("events")
      .insert({
        organizer_id: user.id,
        title: form.title,
        category: form.category,
        event_date: form.event_date,
        event_time: form.event_time,
        venue: form.venue,
        city: form.city,
        description: form.description || null,
        image_url: form.image_url || null,
        status: form.status,
      })
      .select()
      .single();
    if (error || !event) {
      setBusy(false);
      toast.error(error?.message ?? "Nepodarilo sa uložiť podujatie");
      return;
    }
    const ttRows = tickets
      .filter((t) => t.name.trim())
      .map((t) => ({
        event_id: event.id,
        name: t.name,
        price: Number(t.price) || 0,
        quantity: Number(t.quantity) || 0,
      }));
    if (ttRows.length) {
      const { error: tErr } = await supabase.from("ticket_types").insert(ttRows);
      if (tErr) {
        toast.error("Podujatie uložené, ale typy vstupeniek zlyhali: " + tErr.message);
      }
    }
    setBusy(false);
    toast.success("Podujatie vytvorené");
    navigate({ to: "/organizer" });
  };

  return (
    <form onSubmit={submit} className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-tight">Nové podujatie</h1>
        <p className="text-muted-foreground mt-1">Vyplň základné údaje a typy vstupeniek.</p>
      </div>

      <Card className="p-6 bg-card/60 border-border/50 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 space-y-2">
            <Label>Názov podujatia *</Label>
            <Input required value={form.title} onChange={(e) => upd("title", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Kategória *</Label>
            <Select value={form.category} onValueChange={(v) => upd("category", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Stav *</Label>
            <Select value={form.status} onValueChange={(v: "draft" | "published") => upd("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Koncept</SelectItem>
                <SelectItem value="published">Publikované</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Dátum *</Label>
            <Input type="date" required value={form.event_date} onChange={(e) => upd("event_date", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Čas *</Label>
            <Input type="time" required value={form.event_time} onChange={(e) => upd("event_time", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Miesto konania *</Label>
            <Input required value={form.venue} onChange={(e) => upd("venue", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Mesto *</Label>
            <Input required value={form.city} onChange={(e) => upd("city", e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-2">
            <Label>URL obrázka podujatia</Label>
            <Input placeholder="https://…" value={form.image_url} onChange={(e) => upd("image_url", e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-2">
            <Label>Popis</Label>
            <Textarea rows={5} value={form.description} onChange={(e) => upd("description", e.target.value)} />
          </div>
        </div>
      </Card>

      <Card className="p-6 bg-card/60 border-border/50 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Typy vstupeniek</h2>
            <p className="text-sm text-muted-foreground">Aspoň jeden typ s cenou a kapacitou.</p>
          </div>
          <Button type="button" variant="outline" size="sm"
            onClick={() => setTickets((t) => [...t, { name: "", price: "0", quantity: "0" }])}>
            <Plus className="size-4 mr-1.5" /> Pridať typ
          </Button>
        </div>
        <div className="space-y-3">
          {tickets.map((t, i) => (
            <div key={i} className="grid sm:grid-cols-[1fr_120px_120px_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Názov</Label>
                <Input value={t.name} onChange={(e) => setTickets((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cena (€)</Label>
                <Input type="number" min="0" step="0.01" value={t.price}
                  onChange={(e) => setTickets((arr) => arr.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Počet</Label>
                <Input type="number" min="0" value={t.quantity}
                  onChange={(e) => setTickets((arr) => arr.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
              </div>
              <Button type="button" variant="ghost" size="icon"
                onClick={() => setTickets((arr) => arr.filter((_, j) => j !== i))}
                disabled={tickets.length === 1}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => navigate({ to: "/organizer" })}>Zrušiť</Button>
        <Button type="submit" disabled={busy} className="bg-gradient-flame text-primary-foreground shadow-glow">
          {busy ? "Ukladám…" : "Uložiť podujatie"}
        </Button>
      </div>
    </form>
  );
}
