import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type SaleType } from "@/lib/local-db";
import {
  useEvents,
  useUpsertEvent,
  useDeleteEvent,
  toEventInput,
  type EventRecord,
} from "@/hooks/use-events";
import { useLayouts } from "@/hooks/use-layouts";
import { listVenues } from "@/lib/venues.functions";
import { listOrganizers } from "@/lib/events.functions";
import { listEventCategories } from "@/lib/event-categories.functions";
import {
  listPriceCategories,
  listEventZonePrices,
  setEventZonePrices,
} from "@/lib/price-categories.functions";
import { listEventGroups } from "@/lib/event-groups.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Sparkles, ExternalLink, QrCode, Loader2, Pencil, Trash2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { renderEventTicketsPdf } from "@/lib/ticket-pdf.functions";
import { downloadBase64 } from "@/lib/download";

export const Route = createFileRoute("/admin/events/events")({
  head: () => ({ meta: [{ title: "Podujatia · vipky.sk Admin" }] }),
  component: Page,
});

/** Riadok v editore typov vstupeniek. Čísla držíme ako text, nech sa dá pole vyprázdniť. */
type TicketRow = { id?: string; name: string; price: string; quantity: string };

type FormState = {
  /** Prázdne = zakladá sa nové podujatie. */
  id?: string;
  title: string;
  category: string;
  group_id: string;
  /** Za koho admin podujatie zakladá; prázdne = za seba. */
  organizer_id: string;
  event_date: string;
  event_time: string;
  venue_id: string;
  /** Miesto nie je v číselníku — názov a mesto sa píšu ručne. */
  venue_manual: boolean;
  venue: string;
  city: string;
  description: string;
  image_url: string;
  status: "draft" | "published";
  sale_type: SaleType;
  venue_layout_id: string;
  base_price: string;
  vip_price: string;
  total_tickets: string;
  tickets: TicketRow[];
  /** Cena zóny sály; kľúč je id zóny, prázdny reťazec = zóna sa neúčtuje zvlášť. */
  zone_prices: Record<string, string>;
  /** Koľko termínov podujatie má — riadi, či sa dátum vo formulári vôbec uloží. */
  date_count: number;
};

/** Hodnota pre „miesto nie je v číselníku" — Select neznesie prázdny string. */
const CUSTOM_VENUE = "__custom__";
/** Hodnota pre „podujatie zakladám sám za seba". */
const OWN_ACCOUNT = "__me__";

const blankForm = (): FormState => ({
  title: "",
  category: "Koncert",
  group_id: "",
  organizer_id: OWN_ACCOUNT,
  event_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  event_time: "19:00",
  venue_id: "",
  venue_manual: false,
  venue: "",
  city: "",
  description: "",
  image_url: "",
  status: "published",
  sale_type: "seating_map",
  venue_layout_id: "",
  base_price: "25",
  vip_price: "55",
  total_tickets: "100",
  tickets: [{ name: "Štandard", price: "25", quantity: "100" }],
  zone_prices: {},
  date_count: 0,
});

/** Naplní formulár existujúcim podujatím. */
function formFromEvent(e: EventRecord): FormState {
  return {
    id: e.id,
    title: e.title,
    category: e.category,
    group_id: e.group_id ?? "",
    organizer_id: e.organizer_id,
    event_date: e.event_date,
    event_time: (e.event_time || "").slice(0, 5),
    venue_id: e.venue_id ?? "",
    // Bez väzby na číselník sa názov aj mesto píšu ručne — inak by ich uloženie
    // prepísalo prázdnymi hodnotami.
    venue_manual: !e.venue_id,
    venue: e.venue ?? "",
    city: e.city ?? "",
    description: e.description ?? "",
    image_url: e.image_url ?? "",
    status: e.status,
    sale_type: (e.sale_type ?? "standing") as SaleType,
    venue_layout_id: e.venue_layout_id ?? "",
    base_price: e.base_price != null ? String(e.base_price) : "0",
    vip_price: e.vip_price != null ? String(e.vip_price) : "0",
    total_tickets: e.total_tickets != null ? String(e.total_tickets) : "0",
    tickets: (e.tickets ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      price: String(t.price),
      quantity: String(t.quantity),
    })),
    zone_prices: {},
    date_count: e.dates?.length ?? 0,
  };
}

function Page() {
  // Admin vidí všetky podujatia vrátane konceptov (vynucuje to server podľa roly).
  const { data: events = [] } = useEvents({ scope: "all" });
  const upsert = useUpsertEvent();
  const del = useDeleteEvent();
  const { data: layouts = [] } = useLayouts();
  const fetchVenues = useServerFn(listVenues);
  const { data: venues = [] } = useQuery({
    queryKey: ["venues"],
    queryFn: () => fetchVenues({ data: undefined as never }),
  });
  // Kategórie sú číselník v databáze — spravujú sa v Dáta → Kategórie podujatí.
  const fetchCategories = useServerFn(listEventCategories);
  // Skupiny (série) sú číselník v databáze — spravujú sa v Dáta → Skupiny podujatí.
  const fetchGroups = useServerFn(listEventGroups);
  const { data: groups = [] } = useQuery({
    queryKey: ["event-groups", "active"],
    queryFn: () => fetchGroups({ data: { only_active: true } }),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["event-categories", "active"],
    queryFn: () => fetchCategories({ data: { only_active: true } }),
  });
  // Cenové zóny sály; cenu dostávajú až tu, v konkrétnom podujatí.
  const fetchZones = useServerFn(listPriceCategories);
  const { data: zones = [] } = useQuery({
    queryKey: ["price-categories", "active"],
    queryFn: () => fetchZones({ data: { only_active: true } }),
  });
  const fetchZonePrices = useServerFn(listEventZonePrices);
  const saveZonePrices = useServerFn(setEventZonePrices);
  const fetchOrganizers = useServerFn(listOrganizers);
  const { data: organizers = [] } = useQuery({
    queryKey: ["organizers"],
    queryFn: () => fetchOrganizers({ data: undefined as never }),
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm());
  const [qrLoading, setQrLoading] = useState<string | null>(null);
  const renderPdf = useServerFn(renderEventTicketsPdf);

  const downloadQrs = async (e: EventRecord) => {
    setQrLoading(e.id);
    try {
      // Server overí vlastníctvo podujatia a vráti hotové PDF — QR kódy
      // ani údaje kupujúcich sa tak nedostanú k nepovolanému.
      const res = await renderPdf({ data: { event_id: e.id } });
      downloadBase64(res.filename, res.base64);
      toast.success("PDF s vstupenkami stiahnuté.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Nepodarilo sa vygenerovať PDF.");
    } finally {
      setQrLoading(null);
    }
  };

  const setStatus = async (e: EventRecord, status: "draft" | "published") => {
    try {
      await upsert.mutateAsync(toEventInput(e, { status }));
      toast.success(status === "published" ? "Publikované" : "Stiahnuté ako koncept");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Zmena stavu zlyhala");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Naozaj zmazať podujatie?")) return;
    try {
      await del.mutateAsync(id);
      toast.success("Zmazané");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Zmazanie zlyhalo");
    }
  };

  const openNew = () => {
    const fresh = blankForm();
    if (layouts.length > 0) fresh.venue_layout_id = layouts[0].id;
    setForm(fresh);
    setOpen(true);
  };

  const openEdit = async (e: EventRecord) => {
    setForm(formFromEvent(e));
    setOpen(true);
    try {
      const prices = await fetchZonePrices({ data: { event_id: e.id } });
      setForm((f) =>
        f.id === e.id
          ? {
              ...f,
              zone_prices: Object.fromEntries(
                prices.map((p) => [p.price_category_id, String(p.price)]),
              ),
            }
          : f,
      );
    } catch {
      /* ceny zón sú doplnok — bez nich sa formulár stále dá uložiť */
    }
  };

  const editing = !!form.id;

  const setTicket = (index: number, patch: Partial<TicketRow>) =>
    setForm((f) => ({
      ...f,
      tickets: f.tickets.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));
  const addTicket = () =>
    setForm((f) => ({ ...f, tickets: [...f.tickets, { name: "", price: "0", quantity: "0" }] }));
  const removeTicket = (index: number) =>
    setForm((f) => ({ ...f, tickets: f.tickets.filter((_, i) => i !== index) }));

  const submit = async () => {
    if (!form.title.trim()) return toast.error("Vyplň názov podujatia");
    if (!form.venue_id && (!form.venue.trim() || !form.city.trim())) {
      return toast.error("Vyber miesto konania alebo ho zadaj ručne");
    }
    if (form.sale_type === "seating_map" && !form.venue_layout_id) {
      return toast.error("Vyber rozloženie haly z Editora hál");
    }
    if (form.tickets.some((t) => !t.name.trim())) {
      return toast.error("Každý typ vstupenky potrebuje názov");
    }
    try {
      const saved = await upsert.mutateAsync({
        id: form.id,
        // `organizer_id` rešpektuje server len adminovi; prázdne = podujatie
        // ostane tomu, komu patrí (resp. pri zakladaní prihlásenému).
        organizer_id: form.organizer_id === OWN_ACCOUNT ? undefined : form.organizer_id,
        title: form.title.trim(),
        category: form.category,
        group_id: form.group_id || null,
        event_date: form.event_date,
        event_time: form.event_time,
        venue_id: form.venue_id || null,
        venue: form.venue.trim(),
        city: form.city.trim(),
        description: form.description.trim() || null,
        image_url: form.image_url.trim() || null,
        status: form.status,
        sale_type: form.sale_type,
        venue_layout_id: form.sale_type === "seating_map" ? form.venue_layout_id : null,
        base_price: Number(form.base_price) || 0,
        vip_price: Number(form.vip_price) || 0,
        total_tickets: Number(form.total_tickets) || 0,
        // Zoznam typov je úplný: čo tu nie je, server zmaže. Preto sa pri
        // úprave posielajú aj s `id` — bez neho by sa predané typy zahodili.
        tickets: form.tickets.map((t) => ({
          id: t.id,
          name: t.name.trim(),
          price: Number(t.price) || 0,
          quantity: Number(t.quantity) || 0,
        })),
      });
      // Ceny zón sa ukladajú zvlášť — potrebujú id podujatia, ktoré pri
      // zakladaní vzniká až teraz.
      const zonePrices = Object.entries(form.zone_prices)
        .filter(([, v]) => v.trim() !== "")
        .map(([price_category_id, v]) => ({ price_category_id, price: Number(v) || 0 }));
      if (zonePrices.length > 0 || editing) {
        await saveZonePrices({ data: { event_id: saved.id, prices: zonePrices } });
      }

      setOpen(false);
      toast.success(editing ? "Podujatie uložené" : "Podujatie vytvorené");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Podujatie sa nepodarilo uložiť");
    }
  };

  const seedTest = async () => {
    if (layouts.length === 0) {
      toast.error("Najprv vytvor rozloženie haly v Editore hál.");
      return;
    }
    const layout = layouts[0];
    try {
      await upsert.mutateAsync({
        title: "Test koncert s mapou sedenia",
        category: "Koncert",
        group_id: "",
        event_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
        event_time: "20:00",
        venue: layout.name,
        city: layout.city || "Bratislava",
        description:
          "Testovacie podujatie vytvorené pre overenie celého predajného flow s mapou sedenia.",
        image_url: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1600&q=80",
        status: "published",
        sale_type: "seating_map",
        venue_layout_id: layout.id,
        base_price: 25,
        vip_price: 55,
        total_tickets: 100,
        tickets: [{ name: "Štandard", price: 25, quantity: 100 }],
      });
      toast.success("Testovacie podujatie vytvorené a publikované");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Testovacie podujatie sa nepodarilo vytvoriť",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Podujatia</h1>
          <p className="text-muted-foreground mt-1">Všetky podujatia v systéme.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={seedTest} className="gap-1.5">
            <Sparkles className="size-4" /> Test koncert s mapou sedenia
          </Button>
          <Button onClick={openNew} className="gap-1.5 bg-gradient-flame text-primary-foreground">
            <Plus className="size-4" /> Pridať podujatie
          </Button>
        </div>
      </div>

      {events.length === 0 ? (
        <Card className="p-12 text-center bg-card/60 border-dashed">
          <div className="font-semibold">Žiadne podujatia</div>
          <p className="text-sm text-muted-foreground mt-1">
            Použi tlačidlo „Pridať podujatie" alebo vytvor testovacie.
          </p>
        </Card>
      ) : (
        <Card className="bg-card/60 border-border/50 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left p-3">Názov</th>
                <th className="text-left p-3">Kategória</th>
                <th className="text-left p-3">Dátum</th>
                <th className="text-left p-3">Typ</th>
                <th className="text-left p-3">Stav</th>
                <th className="text-right p-3">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-border/20 hover:bg-muted/10">
                  <td className="p-3 font-medium">{e.title}</td>
                  <td className="p-3 text-muted-foreground">{e.category}</td>
                  <td className="p-3 text-muted-foreground">
                    {e.event_date} · {e.event_time}
                    {e.dates && e.dates.length > 1 && (
                      <Link
                        to="/admin/events/dates"
                        className="ml-2 text-primary hover:underline whitespace-nowrap"
                      >
                        +{e.dates.length - 1} ďalších
                      </Link>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {e.sale_type === "seating_map"
                      ? "Mapa sedenia"
                      : e.sale_type === "seating"
                        ? "Sedenie"
                        : e.sale_type === "standing"
                          ? "Státie"
                          : "—"}
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        e.status === "published"
                          ? "bg-primary/15 text-primary border-primary/30"
                          : "bg-muted text-muted-foreground border-border/50"
                      }`}
                    >
                      {e.status === "published" ? "Publikované" : "Koncept"}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-1">
                    <Link to="/events/$id" params={{ id: e.id }} target="_blank">
                      <Button size="sm" variant="ghost" className="gap-1">
                        <ExternalLink className="size-3.5" />
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => downloadQrs(e)}
                      disabled={qrLoading === e.id}
                      title="Stiahnuť QR kódy predaných lístkov (PDF)"
                    >
                      {qrLoading === e.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <QrCode className="size-3.5" />
                      )}
                      QR lístky
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => openEdit(e)}
                    >
                      <Pencil className="size-3.5" /> Upraviť
                    </Button>
                    {e.status === "draft" ? (
                      <Button size="sm" variant="outline" onClick={() => setStatus(e, "published")}>
                        Publikovať
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setStatus(e, "draft")}>
                        Stiahnuť
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(e.id)}
                    >
                      Zmazať
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Upraviť podujatie" : "Nové podujatie"}</DialogTitle>
          </DialogHeader>
          <div className="grid sm:grid-cols-2 gap-4 py-2">
            <Field label="Názov podujatia" className="sm:col-span-2">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="Kategória">
              <Select
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                  {/* Kategória zrušená v číselníku by inak z formulára zmizla
                      a uloženie by ju podujatiu ticho prepísalo. */}
                  {form.category && !categories.some((c) => c.name === form.category) && (
                    <SelectItem value={form.category}>{form.category}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Séria / skupina">
              <Select
                value={form.group_id || "none"}
                onValueChange={(v) => setForm({ ...form, group_id: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— bez skupiny —</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Organizátor">
              <Select
                value={form.organizer_id}
                onValueChange={(v) => setForm({ ...form, organizer_id: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OWN_ACCOUNT}>Ja (admin)</SelectItem>
                  {organizers.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.full_name}
                      {o.email ? ` · ${o.email}` : ""}
                    </SelectItem>
                  ))}
                  {/* Vlastník bez roly organizátora by inak zo zoznamu vypadol
                      a uloženie by podujatie ticho prepísalo na iného. */}
                  {form.organizer_id !== OWN_ACCOUNT &&
                    !organizers.some((o) => o.id === form.organizer_id) && (
                      <SelectItem value={form.organizer_id}>Súčasný vlastník</SelectItem>
                    )}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Dátum">
              <Input
                type="date"
                value={form.event_date}
                onChange={(e) => setForm({ ...form, event_date: e.target.value })}
                disabled={form.date_count > 1}
              />
              <p className="text-[11px] text-muted-foreground">
                {form.date_count > 1 ? (
                  <>
                    Podujatie má {form.date_count} termínov — meň ich v{" "}
                    <Link to="/admin/events/dates" className="text-primary hover:underline">
                      Termínoch
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    {editing ? "Posunie jediný termín" : "Prvý termín"}. Ďalšie pridáš v{" "}
                    <Link to="/admin/events/dates" className="text-primary hover:underline">
                      Termínoch
                    </Link>
                    .
                  </>
                )}
              </p>
            </Field>
            <Field label="Čas začiatku">
              <Input
                type="time"
                value={form.event_time}
                onChange={(e) => setForm({ ...form, event_time: e.target.value })}
                disabled={form.date_count > 1}
              />
            </Field>
            <Field label="Miesto konania" className="sm:col-span-2">
              <Select
                value={form.venue_id || (form.venue_manual ? CUSTOM_VENUE : "")}
                onValueChange={(v) => {
                  if (v === CUSTOM_VENUE) {
                    setForm({ ...form, venue_id: "", venue_manual: true });
                    return;
                  }
                  // Z miesta si vezmeme adresu aj jeho predvolenú sálu, nech sa
                  // to nemusí klikať druhýkrát.
                  const place = venues.find((x) => x.id === v);
                  setForm({
                    ...form,
                    venue_id: v,
                    venue_manual: false,
                    venue: place?.name ?? form.venue,
                    city: place?.city ?? form.city,
                    venue_layout_id: place?.default_layout_id ?? form.venue_layout_id,
                    sale_type: place?.default_layout_id ? "seating_map" : form.sale_type,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Vyber miesto" />
                </SelectTrigger>
                <SelectContent>
                  {venues.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} · {v.city}
                      {v.default_layout_name ? ` · ${v.default_layout_name}` : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_VENUE}>Zadať ručne…</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.venue_manual && (
              <>
                <Field label="Názov miesta">
                  <Input
                    value={form.venue}
                    onChange={(e) => setForm({ ...form, venue: e.target.value })}
                  />
                </Field>
                <Field label="Mesto">
                  <Input
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </Field>
              </>
            )}
            <Field label="URL obrázka" className="sm:col-span-2">
              <Input
                value={form.image_url}
                onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                placeholder="https://…"
              />
            </Field>
            <Field label="Popis" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <Field label="Stav">
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as "draft" | "published" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Koncept</SelectItem>
                  <SelectItem value="published">Publikované</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Typ predaja">
              <Select
                value={form.sale_type}
                onValueChange={(v) => setForm({ ...form, sale_type: v as SaleType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standing">Státie</SelectItem>
                  <SelectItem value="seating">Sedenie</SelectItem>
                  <SelectItem value="seating_map">Sedenie s mapou</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.sale_type === "seating_map" && (
              <Field label="Rozloženie haly" className="sm:col-span-2">
                {layouts.length === 0 ? (
                  <div className="text-xs text-destructive">
                    Žiadne rozloženie. Vytvor ho v{" "}
                    <Link to="/admin/events/venue-layouts" className="underline">
                      Editore hál
                    </Link>
                    .
                  </div>
                ) : (
                  <Select
                    value={form.venue_layout_id}
                    onValueChange={(v) => setForm({ ...form, venue_layout_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Vyber rozloženie" />
                    </SelectTrigger>
                    <SelectContent>
                      {layouts.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}
            <Field label="Cena vstupenky (€)">
              <Input
                type="number"
                min={0}
                step={0.5}
                value={form.base_price}
                onChange={(e) => setForm({ ...form, base_price: e.target.value })}
              />
            </Field>
            <Field label="VIP cena (€)">
              <Input
                type="number"
                min={0}
                step={0.5}
                value={form.vip_price}
                onChange={(e) => setForm({ ...form, vip_price: e.target.value })}
              />
            </Field>
            <Field label="Počet vstupeniek">
              <Input
                type="number"
                min={0}
                step={1}
                value={form.total_tickets}
                onChange={(e) => setForm({ ...form, total_tickets: e.target.value })}
              />
            </Field>

            {form.sale_type === "seating_map" && zones.length > 0 && (
              <div className="sm:col-span-2 space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ceny zón sály
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Zóny priraďuješ sedadlám v Editore hál. Prázdna cena znamená, že sa zóna neúčtuje
                  zvlášť — sedadlo dostane VIP alebo základnú cenu vyššie.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {zones.map((z) => (
                    <div key={z.id} className="flex items-center gap-2">
                      <span
                        className="size-3 shrink-0 rounded-full border border-border/50"
                        style={{ background: z.color ?? "transparent" }}
                      />
                      <span className="flex-1 text-sm truncate">{z.name}</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        placeholder="—"
                        className="w-28"
                        value={form.zone_prices[z.id] ?? ""}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            zone_prices: { ...form.zone_prices, [z.id]: e.target.value },
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="sm:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Typy vstupeniek
                </Label>
                <Button size="sm" variant="outline" onClick={addTicket} className="gap-1.5">
                  <Plus className="size-3.5" /> Pridať typ
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Uplatnia sa pri predaji bez mapy sedenia a v pokladni. Pri mape sedenia rozhoduje
                cena vstupenky a VIP cena vyššie.
              </p>
              {form.tickets.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                  Žiadny typ. Kupujúci potom platí základnú cenu.
                </p>
              ) : (
                <div className="space-y-2">
                  {form.tickets.map((t, i) => (
                    <div key={t.id ?? `new-${i}`} className="flex items-end gap-2">
                      <div className="flex-1 min-w-0 space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Názov</Label>
                        <Input
                          value={t.name}
                          placeholder="napr. Parter"
                          onChange={(e) => setTicket(i, { name: e.target.value })}
                        />
                      </div>
                      <div className="w-24 space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Cena (€)</Label>
                        <Input
                          type="number"
                          min={0}
                          step={0.5}
                          value={t.price}
                          onChange={(e) => setTicket(i, { price: e.target.value })}
                        />
                      </div>
                      <div className="w-24 space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Kapacita</Label>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={t.quantity}
                          onChange={(e) => setTicket(i, { quantity: e.target.value })}
                        />
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeTicket(i)}
                        title="Odstrániť typ"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Zrušiť
            </Button>
            <Button
              onClick={submit}
              disabled={upsert.isPending}
              className="bg-gradient-flame text-primary-foreground"
            >
              {upsert.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              {editing ? "Uložiť zmeny" : "Uložiť podujatie"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
