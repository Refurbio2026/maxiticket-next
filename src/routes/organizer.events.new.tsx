import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { upsertEvent, uid, emit, EVENTS_EVENT, type EventItem } from "@/lib/local-db";
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
  head: () => ({ meta: [{ title: "Nové podujatie · vipky.sk" }] }),
  component: NewEventPage,
});

const CATEGORIES = ["Koncert", "Festival", "Šport", "Konferencia", "Divadlo", "Stand-up", "Kultúra"];

type Tt = { name: string; price: string; quantity: string };

function NewEventPage() {
  const { t } = useI18n();
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
    address: "",
    description: "",
    image_url: "",
    status: "draft" as "draft" | "published",
  });
  const [tickets, setTickets] = useState<Tt[]>([
    { name: "Štandard", price: "20", quantity: "100" },
  ]);

  const upd = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  if (user && user.role === "user") {
    return (
      <Card className="p-12 text-center bg-card/60 border-dashed border-border/50 max-w-2xl">
        <h2 className="font-display text-2xl font-semibold mb-2">{t("orgEventsNew.noPermissionTitle")}</h2>
        <p className="text-muted-foreground">
          {t("orgEventsNew.noPermissionText")}
        </p>
      </Card>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    const event: EventItem = {
      id: uid(),
      organizer_id: user.id,
      organizer_name: user.full_name ?? user.email,
      title: form.title,
      category: form.category,
      event_date: form.event_date,
      event_time: form.event_time,
      venue: form.venue,
      city: form.city,
      address: form.address || undefined,
      description: form.description || undefined,
      image_url: form.image_url || undefined,
      status: form.status,
      created_at: new Date().toISOString(),
      tickets: tickets
        .filter((t) => t.name.trim())
        .map((t) => ({
          id: uid(),
          name: t.name,
          price: Number(t.price) || 0,
          quantity: Number(t.quantity) || 0,
        })),
    };
    upsertEvent(event);
    emit(EVENTS_EVENT);
    setBusy(false);
    toast.success(t("orgEventsNew.toastCreated"));
    navigate({ to: "/organizer/events" });
  };

  return (
    <form onSubmit={submit} className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-tight">{t("orgEventsNew.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("orgEventsNew.subtitle")}</p>
      </div>

      <Card className="p-6 bg-card/60 border-border/50 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 space-y-2">
            <Label>{t("orgEventsNew.labelName")}</Label>
            <Input required value={form.title} onChange={(e) => upd("title", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("orgEventsNew.labelCategory")}</Label>
            <Select value={form.category} onValueChange={(v) => upd("category", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("orgEventsNew.labelStatus")}</Label>
            <Select value={form.status} onValueChange={(v: "draft" | "published") => upd("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">{t("orgEventsNew.statusDraft")}</SelectItem>
                <SelectItem value="published">{t("orgEventsNew.statusPublished")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("orgEventsNew.labelDate")}</Label>
            <Input type="date" required value={form.event_date} onChange={(e) => upd("event_date", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("orgEventsNew.labelTime")}</Label>
            <Input type="time" required value={form.event_time} onChange={(e) => upd("event_time", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("orgEventsNew.labelVenue")}</Label>
            <Input required value={form.venue} onChange={(e) => upd("venue", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("orgEventsNew.labelCity")}</Label>
            <Input required value={form.city} onChange={(e) => upd("city", e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-2">
            <Label>{t("orgEventsNew.labelAddress")}</Label>
            <Input value={form.address} onChange={(e) => upd("address", e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-2">
            <Label>{t("orgEventsNew.labelImageUrl")}</Label>
            <Input placeholder="https://…" value={form.image_url} onChange={(e) => upd("image_url", e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-2">
            <Label>{t("orgEventsNew.labelDescription")}</Label>
            <Textarea rows={5} value={form.description} onChange={(e) => upd("description", e.target.value)} />
          </div>
        </div>
      </Card>

      <Card className="p-6 bg-card/60 border-border/50 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">{t("orgEventsNew.ticketTypesTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("orgEventsNew.ticketTypesHint")}</p>
          </div>
          <Button type="button" variant="outline" size="sm"
            onClick={() => setTickets((t) => [...t, { name: "", price: "0", quantity: "0" }])}>
            <Plus className="size-4 mr-1.5" /> {t("orgEventsNew.addTicketType")}
          </Button>
        </div>
        <div className="space-y-3">
          {tickets.map((t, i) => (
            <TicketRow key={i} t={t} i={i} tickets={tickets} setTickets={setTickets} />
          ))}
        </div>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => navigate({ to: "/organizer" })}>{t("orgEventsNew.cancel")}</Button>
        <Button type="submit" disabled={busy} className="bg-gradient-flame text-primary-foreground shadow-glow">
          {busy ? t("orgEventsNew.saving") : t("orgEventsNew.save")}
        </Button>
      </div>
    </form>
  );
}

function TicketRow({
  t: ticket, i, tickets, setTickets,
}: {
  t: Tt;
  i: number;
  tickets: Tt[];
  setTickets: React.Dispatch<React.SetStateAction<Tt[]>>;
}) {
  const { t } = useI18n();
  return (
    <div className="grid sm:grid-cols-[1fr_120px_120px_auto] gap-2 items-end">
      <div className="space-y-1">
        <Label className="text-xs">{t("orgEventsNew.ticketName")}</Label>
        <Input value={ticket.name} onChange={(e) => setTickets((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t("orgEventsNew.ticketPrice")}</Label>
        <Input type="number" min="0" step="0.01" value={ticket.price}
          onChange={(e) => setTickets((arr) => arr.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t("orgEventsNew.ticketQuantity")}</Label>
        <Input type="number" min="0" value={ticket.quantity}
          onChange={(e) => setTickets((arr) => arr.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
      </div>
      <Button type="button" variant="ghost" size="icon"
        onClick={() => setTickets((arr) => arr.filter((_, j) => j !== i))}
        disabled={tickets.length === 1}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
