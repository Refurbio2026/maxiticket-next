// Formulár podujatia zdieľaný adminom a organizátorom.
//
// Organizátor mal dovtedy len zakladanie (organizer.events.new) a raz vytvorené
// podujatie už nevedel opraviť — chýbajúci typ predaja, sálu ani ceny zón si
// nemal kde doplniť. Tento dialóg je ten istý formulár ako v adminovi; režim
// `organizer` z neho len uberá to, na čo organizátor nemá právo ani stránku:
// výber vlastníka a odkazy do administrácie.
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ImageIcon, Loader2, Plus, Trash2, Upload } from "lucide-react";

import { type SaleType } from "@/lib/local-db";
import { useI18n } from "@/hooks/use-i18n";
import { useLayouts } from "@/hooks/use-layouts";
import { useUpsertEvent, type EventRecord } from "@/hooks/use-events";
import { listVenues } from "@/lib/venues.functions";
import { listOrganizers } from "@/lib/events.functions";
import { listEventCategories } from "@/lib/event-categories.functions";
import { listEventGroups } from "@/lib/event-groups.functions";
import { uploadEventImage } from "@/lib/event-images.functions";
import {
  listPriceCategories,
  listEventZonePrices,
  setEventZonePrices,
} from "@/lib/price-categories.functions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

/** Riadok v editore typov vstupeniek. Čísla držíme ako text, nech sa dá pole vyprázdniť. */
export type TicketRow = { id?: string; name: string; price: string; quantity: string };

export type EventFormState = {
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

/** Musí sedieť s bucketom `event-images` a s `uploadEventImage`. */
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Hodnota pre „miesto nie je v číselníku" — Select neznesie prázdny string. */
const CUSTOM_VENUE = "__custom__";
/** Hodnota pre „podujatie zakladám sám za seba". */
const OWN_ACCOUNT = "__me__";

// Predvolený stav nového podujatia. Admin zakladá najmä sály so sedením a
// publikuje rovno; organizátor mal doteraz vlastný formulár bez typu predaja
// (server ho ukladal ako státie) a s konceptom, aby si podujatie nezverejnil
// omylom — to mu tu ostáva.
const blankEventForm = (mode: "admin" | "organizer"): EventFormState => ({
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
  status: mode === "admin" ? "published" : "draft",
  sale_type: mode === "admin" ? "seating_map" : "standing",
  venue_layout_id: "",
  base_price: "25",
  vip_price: "55",
  total_tickets: "100",
  tickets: [{ name: "Štandard", price: "25", quantity: "100" }],
  zone_prices: {},
  date_count: 0,
});

/** Naplní formulár existujúcim podujatím. */
function eventToForm(e: EventRecord): EventFormState {
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

export type EventFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = zakladá sa nové podujatie. */
  event: EventRecord | null;
  /** `organizer` skryje výber vlastníka a odkazy do administrácie. */
  mode: "admin" | "organizer";
  onSaved?: (id: string) => void;
};

export function EventFormDialog({
  open,
  onOpenChange,
  event,
  mode,
  onSaved,
}: EventFormDialogProps) {
  const { t } = useI18n();
  const isAdmin = mode === "admin";
  const upsert = useUpsertEvent();
  const { data: layouts = [] } = useLayouts();

  const fetchVenues = useServerFn(listVenues);
  const { data: venues = [] } = useQuery({
    queryKey: ["venues"],
    queryFn: () => fetchVenues({ data: undefined as never }),
  });
  // Kategórie sú číselník v databáze — spravujú sa v Dáta → Kategórie podujatí.
  const fetchCategories = useServerFn(listEventCategories);
  const { data: categories = [] } = useQuery({
    queryKey: ["event-categories", "active"],
    queryFn: () => fetchCategories({ data: { only_active: true } }),
  });
  // Skupiny (série) sú číselník v databáze — spravujú sa v Dáta → Skupiny podujatí.
  const fetchGroups = useServerFn(listEventGroups);
  const { data: groups = [] } = useQuery({
    queryKey: ["event-groups", "active"],
    queryFn: () => fetchGroups({ data: { only_active: true } }),
  });
  // Cenové zóny sály; cenu dostávajú až tu, v konkrétnom podujatí.
  const fetchZones = useServerFn(listPriceCategories);
  const { data: zones = [] } = useQuery({
    queryKey: ["price-categories", "active"],
    queryFn: () => fetchZones({ data: { only_active: true } }),
  });
  const fetchZonePrices = useServerFn(listEventZonePrices);
  const saveZonePrices = useServerFn(setEventZonePrices);
  // Zoznam organizátorov smie čítať len admin — organizátorovi by server
  // odpovedal chybou, tak sa naň vôbec nepýtame.
  const fetchOrganizers = useServerFn(listOrganizers);
  const { data: organizers = [] } = useQuery({
    queryKey: ["organizers"],
    queryFn: () => fetchOrganizers({ data: undefined as never }),
    enabled: isAdmin,
  });

  const [form, setForm] = useState<EventFormState>(() => blankEventForm(mode));
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadImage = useServerFn(uploadEventImage);

  // Súbor posielame ako base64 — server funkcie prenášajú JSON, nie multipart.
  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return toast.error(t("eventForm.imageBadType"));
    if (file.size > MAX_IMAGE_BYTES) return toast.error(t("eventForm.imageTooLarge"));
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Súbor sa nepodarilo prečítať."));
        // readAsDataURL vráti „data:<mime>;base64,<obsah>" — server chce len obsah.
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
        reader.readAsDataURL(file);
      });
      const res = await uploadImage({ data: { content_type: file.type, base64 } });
      setForm((f) => ({ ...f, image_url: res.url }));
      toast.success(t("eventForm.imageUploaded"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("eventForm.imageFailed"));
    } finally {
      setUploading(false);
      // Nech sa dá ten istý súbor vybrať znova, keď nahrávanie zlyhá.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Formulár sa napĺňa pri otvorení. Zámerne visí na `event?.id`, nie na celom
  // zázname — inak by refetch zoznamu prepísal rozpísané zmeny.
  const eventId = event?.id ?? null;
  useEffect(() => {
    if (!open) return;
    if (!event) {
      const fresh = blankEventForm(mode);
      if (layouts.length > 0) fresh.venue_layout_id = layouts[0].id;
      setForm(fresh);
      return;
    }
    setForm(eventToForm(event));
    let cancelled = false;
    fetchZonePrices({ data: { event_id: event.id } })
      .then((prices) => {
        if (cancelled) return;
        setForm((f) =>
          f.id === event.id
            ? {
                ...f,
                zone_prices: Object.fromEntries(
                  prices.map((p) => [p.price_category_id, String(p.price)]),
                ),
              }
            : f,
        );
      })
      .catch(() => {
        /* ceny zón sú doplnok — bez nich sa formulár stále dá uložiť */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eventId]);

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
    if (!form.title.trim()) return toast.error(t("eventForm.errName"));
    if (!form.venue_id && (!form.venue.trim() || !form.city.trim())) {
      return toast.error(t("eventForm.errVenue"));
    }
    if (form.sale_type === "seating_map" && !form.venue_layout_id) {
      return toast.error(t("eventForm.errLayout"));
    }
    if (form.tickets.some((x) => !x.name.trim())) {
      return toast.error(t("eventForm.errTicketName"));
    }
    try {
      const saved = await upsert.mutateAsync({
        id: form.id,
        // `organizer_id` rešpektuje server len adminovi; prázdne = podujatie
        // ostane tomu, komu patrí (resp. pri zakladaní prihlásenému).
        organizer_id: isAdmin && form.organizer_id !== OWN_ACCOUNT ? form.organizer_id : undefined,
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
        tickets: form.tickets.map((x) => ({
          id: x.id,
          name: x.name.trim(),
          price: Number(x.price) || 0,
          quantity: Number(x.quantity) || 0,
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

      onOpenChange(false);
      toast.success(editing ? t("eventForm.toastSaved") : t("eventForm.toastCreated"));
      onSaved?.(saved.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("eventForm.toastFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t("eventForm.titleEdit") : t("eventForm.titleNew")}</DialogTitle>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-4 py-2">
          <Field label={t("eventForm.name")} className="sm:col-span-2">
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label={t("eventForm.category")}>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
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
          <Field label={t("eventForm.group")}>
            <Select
              value={form.group_id || "none"}
              onValueChange={(v) => setForm({ ...form, group_id: v === "none" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("eventForm.groupNone")}</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {isAdmin && (
            <Field label={t("eventForm.organizer")}>
              <Select
                value={form.organizer_id}
                onValueChange={(v) => setForm({ ...form, organizer_id: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OWN_ACCOUNT}>{t("eventForm.organizerSelf")}</SelectItem>
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
                      <SelectItem value={form.organizer_id}>
                        {t("eventForm.organizerCurrent")}
                      </SelectItem>
                    )}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t("eventForm.date")}>
            <Input
              type="date"
              value={form.event_date}
              onChange={(e) => setForm({ ...form, event_date: e.target.value })}
              disabled={form.date_count > 1}
            />
            <p className="text-[11px] text-muted-foreground">
              {form.date_count > 1 ? (
                isAdmin ? (
                  <>
                    {t("eventForm.datesMany", { count: form.date_count })}{" "}
                    <Link to="/admin/events/dates" className="text-primary hover:underline">
                      {t("eventForm.datesLink")}
                    </Link>
                    .
                  </>
                ) : (
                  t("eventForm.datesManyOrganizer", { count: form.date_count })
                )
              ) : isAdmin ? (
                <>
                  {editing ? t("eventForm.datesOne") : t("eventForm.datesFirst")}{" "}
                  {t("eventForm.datesMoreIn")}{" "}
                  <Link to="/admin/events/dates" className="text-primary hover:underline">
                    {t("eventForm.datesLink")}
                  </Link>
                  .
                </>
              ) : editing ? (
                t("eventForm.datesOne")
              ) : (
                t("eventForm.datesFirst")
              )}
            </p>
          </Field>
          <Field label={t("eventForm.time")}>
            <Input
              type="time"
              value={form.event_time}
              onChange={(e) => setForm({ ...form, event_time: e.target.value })}
              disabled={form.date_count > 1}
            />
          </Field>
          <Field label={t("eventForm.venue")} className="sm:col-span-2">
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
                <SelectValue placeholder={t("eventForm.venuePick")} />
              </SelectTrigger>
              <SelectContent>
                {venues.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name} · {v.city}
                    {v.default_layout_name ? ` · ${v.default_layout_name}` : ""}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_VENUE}>{t("eventForm.venueCustom")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.venue_manual && (
            <>
              <Field label={t("eventForm.venueName")}>
                <Input
                  value={form.venue}
                  onChange={(e) => setForm({ ...form, venue: e.target.value })}
                />
              </Field>
              <Field label={t("eventForm.city")}>
                <Input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </Field>
            </>
          )}
          <Field label={t("eventForm.image")} className="sm:col-span-2">
            <div className="flex items-start gap-3">
              {form.image_url ? (
                // Náhľad zároveň prezradí nefunkčný odkaz — pri chybe sa skryje.
                <img
                  src={form.image_url}
                  alt=""
                  className="h-20 w-32 shrink-0 rounded-md border border-border/50 object-cover"
                  onError={(e) => {
                    e.currentTarget.style.visibility = "hidden";
                  }}
                />
              ) : (
                <div className="grid h-20 w-32 shrink-0 place-items-center rounded-md border border-dashed border-border/60 text-muted-foreground">
                  <ImageIcon className="size-5" />
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Upload className="size-3.5" />
                    )}
                    {uploading ? t("eventForm.imageUploading") : t("eventForm.imageUpload")}
                  </Button>
                  {form.image_url && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setForm({ ...form, image_url: "" })}
                    >
                      {t("eventForm.imageRemove")}
                    </Button>
                  )}
                </div>
                <Input
                  value={form.image_url}
                  onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  placeholder="https://…"
                />
                <p className="text-[11px] text-muted-foreground">{t("eventForm.imageHint")}</p>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={ALLOWED_IMAGE_TYPES.join(",")}
              className="hidden"
              onChange={(e) => onPickImage(e.target.files?.[0])}
            />
          </Field>
          <Field label={t("eventForm.description")} className="sm:col-span-2">
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <Field label={t("eventForm.status")}>
            <Select
              value={form.status}
              onValueChange={(v) => setForm({ ...form, status: v as "draft" | "published" })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">{t("eventForm.statusDraft")}</SelectItem>
                <SelectItem value="published">{t("eventForm.statusPublished")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("eventForm.saleType")}>
            <Select
              value={form.sale_type}
              onValueChange={(v) => setForm({ ...form, sale_type: v as SaleType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standing">{t("eventForm.saleStanding")}</SelectItem>
                <SelectItem value="seating">{t("eventForm.saleSeating")}</SelectItem>
                <SelectItem value="seating_map">{t("eventForm.saleSeatingMap")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.sale_type === "seating_map" && (
            <Field label={t("eventForm.layout")} className="sm:col-span-2">
              {layouts.length === 0 ? (
                <div className="text-xs text-destructive">
                  {isAdmin ? (
                    <>
                      {t("eventForm.layoutNone")}{" "}
                      <Link to="/admin/events/venue-layouts" className="underline">
                        {t("eventForm.layoutEditorLink")}
                      </Link>
                      .
                    </>
                  ) : (
                    t("eventForm.layoutNoneOrganizer")
                  )}
                </div>
              ) : (
                <Select
                  value={form.venue_layout_id}
                  onValueChange={(v) => setForm({ ...form, venue_layout_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("eventForm.layoutPick")} />
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
          <Field label={t("eventForm.basePrice")}>
            <Input
              type="number"
              min={0}
              step={0.5}
              value={form.base_price}
              onChange={(e) => setForm({ ...form, base_price: e.target.value })}
            />
          </Field>
          <Field label={t("eventForm.vipPrice")}>
            <Input
              type="number"
              min={0}
              step={0.5}
              value={form.vip_price}
              onChange={(e) => setForm({ ...form, vip_price: e.target.value })}
            />
          </Field>
          <Field label={t("eventForm.totalTickets")}>
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
                {t("eventForm.zonesTitle")}
              </Label>
              <p className="text-[11px] text-muted-foreground">
                {isAdmin ? t("eventForm.zonesHint") : t("eventForm.zonesHintOrganizer")}
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
                {t("eventForm.ticketTypes")}
              </Label>
              <Button size="sm" variant="outline" onClick={addTicket} className="gap-1.5">
                <Plus className="size-3.5" /> {t("eventForm.addTicketType")}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">{t("eventForm.ticketTypesHint")}</p>
            {form.tickets.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                {t("eventForm.ticketTypesEmpty")}
              </p>
            ) : (
              <div className="space-y-2">
                {form.tickets.map((x, i) => (
                  <div key={x.id ?? `new-${i}`} className="flex items-end gap-2">
                    <div className="flex-1 min-w-0 space-y-1">
                      <Label className="text-[10px] text-muted-foreground">
                        {t("eventForm.ticketName")}
                      </Label>
                      <Input
                        value={x.name}
                        placeholder={t("eventForm.ticketNamePlaceholder")}
                        onChange={(e) => setTicket(i, { name: e.target.value })}
                      />
                    </div>
                    <div className="w-24 space-y-1">
                      <Label className="text-[10px] text-muted-foreground">
                        {t("eventForm.ticketPrice")}
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        value={x.price}
                        onChange={(e) => setTicket(i, { price: e.target.value })}
                      />
                    </div>
                    <div className="w-24 space-y-1">
                      <Label className="text-[10px] text-muted-foreground">
                        {t("eventForm.ticketCapacity")}
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={x.quantity}
                        onChange={(e) => setTicket(i, { quantity: e.target.value })}
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => removeTicket(i)}
                      title={t("eventForm.ticketRemove")}
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("eventForm.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={upsert.isPending}
            className="bg-gradient-flame text-primary-foreground"
          >
            {upsert.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
            {editing ? t("eventForm.saveEdit") : t("eventForm.saveNew")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
