import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEvent, type EventRecord } from "@/hooks/use-events";
import { getSeatAvailability } from "@/lib/event-dates.functions";
import { listEventPerformers } from "@/lib/performers.functions";
import { useLayouts } from "@/hooks/use-layouts";
import type { HallLayout } from "@/lib/layout-types";
import {
  getInventory,
  INV_EVENT,
  releaseExpired,
  createOrder,
  reserveSeats,
  holdSeat,
  releaseHeldSeat,
  extendHolds,
  releaseAllHolds,
  type SeatInventoryRow,
} from "@/lib/ticketing-db";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Calendar,
  MapPin,
  ArrowLeft,
  Ticket,
  Minus,
  Plus,
  X,
  Clock,
  User,
  ShieldCheck,
  QrCode,
  Mail,
  Info,
  Music,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

const CustomerSeatingMap = lazy(() =>
  import("@/components/CustomerSeatingMap").then((m) => ({ default: m.CustomerSeatingMap })),
);

export const Route = createFileRoute("/events/$id")({
  head: () => ({ meta: [{ title: "Podujatie · vipky.sk" }] }),
  component: EventDetail,
});

type Selected = { seat_id: string; label: string; price: number; is_vip: boolean };

const dayNames = ["nedeľa", "pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota"];
const monthNames = [
  "januára",
  "februára",
  "marca",
  "apríla",
  "mája",
  "júna",
  "júla",
  "augusta",
  "septembra",
  "októbra",
  "novembra",
  "decembra",
];

function formatLongDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${dayNames[d.getDay()]} ${d.getDate()}. ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
}

function formatShortDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()}. ${d.getMonth() + 1}.`;
}

function parseSeatLabel(label: string) {
  const parts = label.split("·").map((part) => part.trim());
  const sector = parts.find((part) => !part.toLowerCase().startsWith("rad")) ?? "Sektor";
  const row =
    parts.find((part) => part.toLowerCase().startsWith("rad"))?.replace(/^Rad\s*/i, "") ?? "—";
  const number =
    parts[parts.length - 1] && /^\d+$/.test(parts[parts.length - 1])
      ? parts[parts.length - 1]
      : "—";
  return { sector, row, number };
}

function defaultLayoutForEvent(event: EventRecord): HallLayout {
  const now = new Date().toISOString();
  return {
    id: `default-layout-${event.id}`,
    name: event.venue || "Sála",
    type: "koncertna-hala",
    city: event.city,
    capacity: 120,
    shapes: [
      {
        id: `stage-${event.id}`,
        kind: "stage",
        x: 120,
        y: 20,
        width: 420,
        height: 58,
        label: "PÓDIUM",
      },
      {
        id: `sector-main-${event.id}`,
        kind: "sector",
        x: 80,
        y: 110,
        width: 500,
        height: 330,
        label: "Hlavný sektor",
      },
      {
        id: `seats-main-${event.id}`,
        kind: "seats",
        x: 125,
        y: 140,
        width: 390,
        height: 300,
        rows: 10,
        cols: 12,
        seatSize: 22,
        startRow: 1,
        startSeat: 1,
        label: "Sektor A",
        priceCategory: "Regular",
      },
    ],
    curveGroups: [],
    created_at: now,
    updated_at: now,
  };
}

function hasSelectableSeats(layout?: HallLayout | null): layout is HallLayout {
  return !!layout?.shapes.some((shape) => shape.kind === "seats" && !shape.blocked);
}

function EventDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  // Podujatie prichádza z databázy; rozloženie sály a obsadenosť sedadiel
  // zatiaľ ostávajú v localStorage (migrujú sa v neskoršej fáze).
  const { data: eventData, isLoading } = useEvent(id);
  const event = eventData ?? undefined;
  const { data: layouts = [] } = useLayouts();
  const [layout, setLayout] = useState<HallLayout | null>(null);
  const [localHolds, setLocalHolds] = useState<SeatInventoryRow[]>([]);
  const [selected, setSelected] = useState<Selected[]>([]);
  const [qty, setQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [dateId, setDateId] = useState<string>("");
  const loaded = !isLoading;

  // Kupuje sa konkrétny termín. Predvolí sa najbližší v predaji — pri
  // jednodňovom podujatí je to jediná možnosť a výber sa vôbec nezobrazí.
  const sellableDates = useMemo(() => {
    // Odohraný termín sa nekupuje. Porovnávame na deň, aby dnešné večerné
    // predstavenie ostalo v predaji ešte aj popoludní.
    const today = new Date().toISOString().slice(0, 10);
    return (event?.dates ?? []).filter((d) => d.status === "on_sale" && d.event_date >= today);
  }, [event]);
  const activeDate = sellableDates.find((d) => d.id === dateId) ?? sellableDates[0];

  useEffect(() => {
    if (!activeDate) return;
    if (dateId !== activeDate.id) setDateId(activeDate.id);
  }, [activeDate, dateId]);

  // Obsadenosť ťaháme z databázy, aby dvaja kupujúci na dvoch počítačoch videli
  // ten istý stav; localStorage vie len o vlastnom prehliadači.
  const fetchAvailability = useServerFn(getSeatAvailability);
  const availability = useQuery({
    queryKey: ["seat-availability", activeDate?.id ?? null],
    enabled: !!activeDate,
    refetchInterval: 15_000,
    queryFn: () => fetchAvailability({ data: { event_date_id: activeDate!.id } }),
  });

  const fetchPerformers = useServerFn(listEventPerformers);
  const performers = useQuery({
    queryKey: ["event-performers", id],
    enabled: !!id,
    queryFn: () => fetchPerformers({ data: { event_id: id } }),
  });

  useEffect(() => {
    const load = () => {
      releaseExpired();
      const e = event;
      if (!e || !activeDate) {
        setLayout(null);
        setLocalHolds([]);
        return;
      }
      const explicitLayout = e.venue_layout_id
        ? layouts.find((l) => l.id === e.venue_layout_id)
        : undefined;
      const matchedLayout = layouts.find((l) => l.name.toLowerCase() === e.venue.toLowerCase());
      const fallbackLayout =
        e.sale_type !== "standing" ? (layouts[0] ?? defaultLayoutForEvent(e)) : undefined;
      const resolvedLayout = explicitLayout ?? matchedLayout ?? fallbackLayout ?? null;
      setLayout(
        hasSelectableSeats(resolvedLayout)
          ? resolvedLayout
          : e.sale_type !== "standing"
            ? defaultLayoutForEvent(e)
            : null,
      );
      setLocalHolds(getInventory(activeDate.id));
    };
    load();
    const t = setInterval(load, 15000);
    window.addEventListener(INV_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      clearInterval(t);
      window.removeEventListener(INV_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, [id, event, layouts, activeDate]);

  // Mapa vidí obsadené sedadlá z databázy aj tie, ktoré si práve drží tento
  // košík — inak by vlastný výber vyzeral ako voľné miesto.
  const inventory = useMemo<SeatInventoryRow[]>(() => {
    const rows = new Map<string, SeatInventoryRow>();
    for (const t of availability.data?.taken ?? []) {
      rows.set(t.seat_id, {
        event_date_id: activeDate?.id ?? "",
        seat_id: t.seat_id,
        status: t.status,
        price: 0,
      });
    }
    for (const h of localHolds) rows.set(h.seat_id, h);
    return [...rows.values()];
  }, [availability.data, localHolds, activeDate]);

  const isMap = !!layout && event?.sale_type !== "standing";
  const basePrice = event?.base_price ?? Number(event?.tickets?.[0]?.price ?? 0);
  const vipPrice = event?.vip_price ?? basePrice;
  const priceFrom = Math.min(...[basePrice, vipPrice].filter((p) => p > 0)) || basePrice;

  // Dostupnosť: pri mape sedadiel je kapacita počet sedadiel v rozložení,
  // inak kapacita termínu (a až keď nie je nastavená, kapacita podujatia).
  const totalCapacity =
    layout?.shapes
      .filter((s) => s.kind === "seats")
      .reduce((sum, s) => sum + ((s as any).rows ?? 0) * ((s as any).cols ?? 0), 0) ??
    activeDate?.total_tickets ??
    event?.total_tickets ??
    0;
  const takenCount = isMap
    ? inventory.filter((r) => r.status !== "available").length
    : (availability.data?.taken_count ?? 0);
  const availableCount = Math.max(0, totalCapacity - takenCount);
  const lowAvailability = totalCapacity > 0 && availableCount / totalCapacity < 0.2;

  const toggleSeat = (s: Selected) => {
    if (!event || !activeDate) return;
    const already = selected.some((x) => x.seat_id === s.seat_id);
    if (already) {
      releaseHeldSeat(activeDate.id, s.seat_id);
      setSelected((prev) => prev.filter((x) => x.seat_id !== s.seat_id));
      return;
    }
    const ok = holdSeat(activeDate.id, s, 2);
    if (!ok) {
      toast.error("Sedadlo si práve berie iný kupujúci. Vyber prosím iné.");
      return;
    }
    setSelected((prev) => [...prev, s]);
  };

  // Refresh holds every 60s while the cart is open, and release them when
  // the user leaves the page without proceeding to checkout.
  useEffect(() => {
    if (!activeDate || selected.length === 0) return;
    const held = activeDate.id;
    const t = setInterval(() => extendHolds(held, 2), 60_000);
    const onUnload = () => releaseAllHolds(held);
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      clearInterval(t);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
  }, [activeDate, selected.length]);

  const total = isMap ? selected.reduce((sum, s) => sum + s.price, 0) : qty * basePrice;

  const checkout = () => {
    if (!event) return;
    if (!activeDate) {
      toast.error("Toto podujatie nemá termín v predaji.");
      return;
    }
    setSubmitting(true);
    try {
      const items = isMap
        ? selected.map((s) => ({
            seat_id: s.seat_id,
            label: s.label,
            price: s.price,
            is_vip: s.is_vip,
          }))
        : Array.from({ length: qty }).map((_, i) => ({
            label: `Vstupenka ${i + 1}`,
            price: basePrice,
          }));
      if (items.length === 0) {
        toast.error("Vyber aspoň jednu vstupenku");
        setSubmitting(false);
        return;
      }
      const order = createOrder({
        event_id: event.id,
        event_date_id: activeDate.id,
        items,
        total_amount: total,
      });
      if (isMap) {
        const ok = reserveSeats(
          activeDate.id,
          selected.map((s) => ({
            seat_id: s.seat_id,
            label: s.label,
            price: s.price,
            is_vip: s.is_vip,
          })),
          order.id,
          10,
        );
        if (!ok) {
          toast.error("Niektoré sedadlá už nie sú dostupné. Skús znova.");
          setSubmitting(false);
          return;
        }
      }
      navigate({ to: "/checkout/$orderId", params: { orderId: order.id } });
    } finally {
      setSubmitting(false);
    }
  };

  const sortedSelected = useMemo(
    () => [...selected].sort((a, b) => a.label.localeCompare(b.label)),
    [selected],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 pt-28 pb-20">
        <Link
          to="/events"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6"
        >
          <ArrowLeft className="size-4" /> Späť na podujatia
        </Link>
        {!loaded ? (
          <div className="text-muted-foreground">Načítavam…</div>
        ) : !event ? (
          <Card className="p-12 text-center bg-card/60 border-dashed">
            <div className="font-semibold">Podujatie sa nenašlo</div>
          </Card>
        ) : (
          <>
            <div
              className="relative aspect-[21/9] rounded-2xl bg-muted bg-cover bg-center mb-8 overflow-hidden"
              style={event.image_url ? { backgroundImage: `url(${event.image_url})` } : undefined}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-6 md:p-8 text-white">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Badge className="bg-primary text-primary-foreground border-0">
                    {event.category}
                  </Badge>
                  {lowAvailability && availableCount > 0 && (
                    <Badge variant="destructive" className="border-0">
                      Posledné vstupenky
                    </Badge>
                  )}
                  {availableCount === 0 && totalCapacity > 0 && (
                    <Badge variant="secondary" className="border-0">
                      Vypredané
                    </Badge>
                  )}
                </div>
                <h1 className="font-display text-3xl md:text-5xl font-bold tracking-tight drop-shadow">
                  {event.title}
                </h1>
                <div className="flex flex-wrap gap-4 mt-3 text-sm text-white/90">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="size-4" />
                    {activeDate ? formatLongDate(activeDate.event_date) : event.event_date}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="size-4" /> {activeDate?.event_time ?? event.event_time}
                  </span>
                  {sellableDates.length > 1 && (
                    <span className="inline-flex items-center gap-1.5">
                      <Ticket className="size-4" /> {sellableDates.length} termínov
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-4" /> {event.venue}, {event.city}
                  </span>
                </div>
              </div>
            </div>

            {/* Key info strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
              <InfoTile
                icon={<Ticket className="size-4" />}
                label="Cena od"
                value={`€${priceFrom.toFixed(2)}`}
              />
              <InfoTile
                icon={<Info className="size-4" />}
                label="Dostupnosť"
                value={
                  totalCapacity > 0
                    ? availableCount === 0
                      ? "Vypredané"
                      : `${availableCount} voľných`
                    : "K dispozícii"
                }
                accent={lowAvailability ? "warn" : undefined}
              />
              <InfoTile
                icon={<User className="size-4" />}
                label="Organizátor"
                value={event.organizer_name || "vipky.sk partner"}
              />
              <InfoTile icon={<MapPin className="size-4" />} label="Miesto" value={event.venue} />
            </div>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-w-0 space-y-6">
                {event.description && (
                  <div>
                    <h2 className="font-display font-semibold text-lg mb-2">O podujatí</h2>
                    <p className="text-foreground/80 leading-relaxed whitespace-pre-line">
                      {event.description}
                    </p>
                  </div>
                )}

                {event.group_name && (
                  <Link
                    to="/events"
                    search={{ group: event.group_name }}
                    className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-4 py-2 text-sm hover:border-primary/50 transition-colors"
                  >
                    <Layers className="size-4 text-primary" />
                    Súčasť série <strong>{event.group_name}</strong>
                    <span className="text-muted-foreground">— zobraziť celú →</span>
                  </Link>
                )}

                {(performers.data ?? []).length > 0 && (
                  <div>
                    <h2 className="font-display font-semibold text-lg mb-3">Účinkujú</h2>
                    <div className="flex flex-wrap gap-3">
                      {(performers.data ?? []).map((p) => (
                        <Link
                          key={p.id}
                          to="/artists"
                          className="flex items-center gap-2.5 rounded-full border border-border/60 bg-card/60 pl-1.5 pr-4 py-1.5 hover:border-primary/50 transition-colors"
                        >
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt=""
                              className="size-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="size-8 rounded-full bg-muted/50 grid place-items-center">
                              <Music className="size-3.5 text-muted-foreground" />
                            </div>
                          )}
                          <div className="leading-tight">
                            <div className="text-sm font-semibold">{p.name}</div>
                            {p.genre && (
                              <div className="text-[11px] text-muted-foreground">{p.genre}</div>
                            )}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {sellableDates.length > 1 && (
                  <div>
                    <h2 className="font-display font-semibold text-lg mb-3">Vyber termín</h2>
                    <div className="flex flex-wrap gap-2">
                      {sellableDates.map((d) => {
                        const active = d.id === activeDate?.id;
                        return (
                          <button
                            key={d.id}
                            onClick={() => {
                              if (active) return;
                              // Sedadlá platia vždy len pre jeden termín, takže
                              // pri prepnutí sa výber aj držané miesta zahodia.
                              if (activeDate) releaseAllHolds(activeDate.id);
                              setSelected([]);
                              setDateId(d.id);
                            }}
                            className={`rounded-xl border px-4 py-2.5 text-left transition ${
                              active
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border/50 bg-card/40 hover:border-primary/50"
                            }`}
                          >
                            <div className="font-display font-semibold">
                              {formatShortDate(d.event_date)}{" "}
                              <span className="text-sm font-normal text-muted-foreground">
                                {d.event_time}
                              </span>
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {dayNames[new Date(`${d.event_date}T00:00:00`).getDay()]}
                              {d.note ? ` · ${d.note}` : ""}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {sellableDates.length === 0 && (
                  <Card className="p-6 bg-card/60 border-dashed text-sm text-muted-foreground">
                    Podujatie momentálne nemá termín v predaji.
                  </Card>
                )}

                {isMap && layout ? (
                  <div className="min-w-0">
                    <h2 className="font-display font-semibold text-lg mb-3">
                      Vyber sedadlá v hale
                    </h2>
                    <Suspense
                      fallback={<div className="h-[520px] rounded-xl bg-muted animate-pulse" />}
                    >
                      <CustomerSeatingMap
                        layout={layout}
                        basePrice={basePrice}
                        vipPrice={vipPrice}
                        inventory={inventory}
                        selected={selected.map((s) => s.seat_id)}
                        onToggle={toggleSeat}
                        customerSeatMapMode
                      />
                    </Suspense>
                  </div>
                ) : (
                  <Card className="p-6 bg-card/60 border-border/50">
                    <h2 className="font-display font-semibold text-lg mb-3">Vstupenky</h2>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">
                          {event.sale_type === "standing" ? "Státie" : "Sedenie"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          €{basePrice.toFixed(2)} / ks
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => setQty(Math.max(1, qty - 1))}
                        >
                          <Minus className="size-4" />
                        </Button>
                        <div className="w-10 text-center font-semibold">{qty}</div>
                        <Button size="icon" variant="outline" onClick={() => setQty(qty + 1)}>
                          <Plus className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Venue map */}
                <div>
                  <h2 className="font-display font-semibold text-lg mb-3">Ako sa tam dostať</h2>
                  <div className="rounded-xl overflow-hidden border border-border/50 aspect-[16/9] bg-muted">
                    <iframe
                      title="Mapa miesta"
                      width="100%"
                      height="100%"
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      src={`https://www.google.com/maps?q=${encodeURIComponent(
                        `${event.venue}, ${event.address ?? ""} ${event.city}`,
                      )}&output=embed`}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {event.venue}
                    {event.address ? `, ${event.address}` : ""}, {event.city}
                  </p>
                </div>

                {/* Conditions + FAQ */}
                <div>
                  <h2 className="font-display font-semibold text-lg mb-3">
                    Podmienky vstupu a časté otázky
                  </h2>
                  <Accordion
                    type="single"
                    collapsible
                    className="rounded-xl border border-border/50 bg-card/40"
                  >
                    <AccordionItem value="entry" className="px-4">
                      <AccordionTrigger className="text-sm font-semibold">
                        Podmienky vstupu
                      </AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground space-y-1">
                        <p>
                          • Vstup je povolený od 16 rokov, deti do 12 rokov v sprievode dospelého.
                        </p>
                        <p>• Pri vstupe ukáž QR kód z emailu alebo z tejto stránky.</p>
                        <p>• Dvere sa otvárajú 60 minút pred začiatkom podujatia.</p>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="ticket" className="px-4">
                      <AccordionTrigger className="text-sm font-semibold">
                        Musím vstupenku tlačiť?
                      </AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground">
                        Nie. Stačí QR kód na mobile. Ak chceš, vstupenku si vieš stiahnuť aj ako
                        PDF.
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="refund" className="px-4">
                      <AccordionTrigger className="text-sm font-semibold">
                        Môžem vstupenku vrátiť alebo vymeniť?
                      </AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground">
                        Vstupenky sú nevratné. V prípade zrušenia podujatia ti automaticky vrátime
                        celú sumu.
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="payment" className="px-4 border-b-0">
                      <AccordionTrigger className="text-sm font-semibold">
                        Aké spôsoby platby akceptujete?
                      </AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground">
                        Platobné karty Visa, Mastercard a Apple/Google Pay. Všetky platby sú
                        šifrované.
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </div>

              <Card className="hidden lg:block p-6 bg-card/60 border-border/50 h-fit lg:sticky lg:top-[120px]">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="font-display font-semibold text-xl">Košík</h2>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {isMap ? selected.length : qty} ks
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mb-4">
                  <div className="line-clamp-1">{event.title}</div>
                  {activeDate && (
                    <div className="mt-0.5">
                      {formatLongDate(activeDate.event_date)} · {activeDate.event_time}
                    </div>
                  )}
                </div>

                {isMap ? (
                  selected.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                      Vyberte sedadlo z mapy
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {sortedSelected.map((s) => {
                        const meta = parseSeatLabel(s.label);
                        return (
                          <div
                            key={s.seat_id}
                            className="rounded-md border border-border/40 bg-muted/20 p-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 text-sm">
                                <div className="font-medium truncate">{meta.sector}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  Rad {meta.row} · Sedadlo {meta.number}
                                </div>
                                {s.is_vip && (
                                  <div className="mt-1 text-[10px] font-semibold text-yellow-500">
                                    VIP
                                  </div>
                                )}
                              </div>
                              <button
                                aria-label="Odstrániť sedadlo"
                                onClick={() => toggleSeat(s)}
                                className="size-7 inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              >
                                <X className="size-4" />
                              </button>
                            </div>
                            <div className="mt-2 flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Cena sedadla</span>
                              <span className="font-display font-semibold">
                                €{s.price.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  <div className="rounded-md border border-border/40 bg-muted/20 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Počet vstupeniek</span>
                      <span className="font-semibold">{qty}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-muted-foreground">Cena za kus</span>
                      <span className="font-display font-semibold">€{basePrice.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                <div className="mt-4 pt-4 border-t border-border/40 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Celková cena</span>
                  <span className="font-display text-2xl font-bold">€{total.toFixed(2)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground text-right mt-0.5">
                  vrátane DPH · žiadne skryté poplatky
                </div>

                <Button
                  onClick={checkout}
                  disabled={submitting || !activeDate || (isMap && selected.length === 0)}
                  className="w-full mt-5 bg-gradient-flame text-primary-foreground shadow-glow"
                  size="lg"
                >
                  <Ticket className="size-4 mr-2" />
                  Kúpiť vstupenky
                </Button>

                <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                  <div className="flex flex-col items-center text-center gap-1 p-1.5 rounded-md border border-border/40">
                    <ShieldCheck className="size-3.5 text-emerald-500" />
                    Bezpečná platba
                  </div>
                  <div className="flex flex-col items-center text-center gap-1 p-1.5 rounded-md border border-border/40">
                    <QrCode className="size-3.5 text-primary" />
                    QR vstupenka
                  </div>
                  <div className="flex flex-col items-center text-center gap-1 p-1.5 rounded-md border border-border/40">
                    <Mail className="size-3.5 text-primary" />
                    Email do 1 min.
                  </div>
                </div>
              </Card>
            </div>

            {/* Mobile sticky bottom bar */}
            <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur px-4 py-3 flex items-center gap-3 shadow-[0_-4px_20px_rgba(0,0,0,0.15)]">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-muted-foreground">
                  {isMap ? `${selected.length} sedadiel vybraných` : `${qty} ks vstupeniek`}
                </div>
                <div className="font-display text-xl font-bold leading-none">
                  €{total.toFixed(2)}
                </div>
              </div>
              <Button
                onClick={checkout}
                disabled={submitting || !activeDate || (isMap && selected.length === 0)}
                className="bg-gradient-flame text-primary-foreground shadow-glow"
              >
                <Ticket className="size-4 mr-2" />
                Do checkoutu
              </Button>
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

function InfoTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: "warn";
}) {
  return (
    <div
      className={`rounded-xl border bg-card/50 p-3 ${
        accent === "warn" ? "border-amber-500/50" : "border-border/50"
      }`}
    >
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5">
        <span className="text-primary">{icon}</span> {label}
      </div>
      <div
        className={`font-display font-semibold text-base md:text-lg mt-1 truncate ${
          accent === "warn" ? "text-amber-600 dark:text-amber-400" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
