import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { getEvent, EVENTS_EVENT, type EventItem } from "@/lib/local-db";
import { getLayout, listLayouts, type HallLayout } from "@/lib/layouts-db";
import {
  getInventory,
  INV_EVENT,
  releaseExpired,
  createOrder,
  reserveSeats,
  type SeatInventoryRow,
} from "@/lib/ticketing-db";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, MapPin, ArrowLeft, Ticket, Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";

const CustomerSeatingMap = lazy(() =>
  import("@/components/CustomerSeatingMap").then((m) => ({ default: m.CustomerSeatingMap })),
);

export const Route = createFileRoute("/events/$id")({
  head: () => ({ meta: [{ title: "Podujatie · MAXITICKET" }] }),
  component: EventDetail,
});

type Selected = { seat_id: string; label: string; price: number; is_vip: boolean };

function parseSeatLabel(label: string) {
  const parts = label.split("·").map((part) => part.trim());
  const sector = parts.find((part) => !part.toLowerCase().startsWith("rad")) ?? "Sektor";
  const row = parts.find((part) => part.toLowerCase().startsWith("rad"))?.replace(/^Rad\s*/i, "") ?? "—";
  const number = parts[parts.length - 1] && /^\d+$/.test(parts[parts.length - 1]) ? parts[parts.length - 1] : "—";
  return { sector, row, number };
}

function defaultLayoutForEvent(event: EventItem): HallLayout {
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
  const [event, setEvent] = useState<EventItem | undefined>(undefined);
  const [layout, setLayout] = useState<HallLayout | null>(null);
  const [inventory, setInventory] = useState<SeatInventoryRow[]>([]);
  const [selected, setSelected] = useState<Selected[]>([]);
  const [qty, setQty] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = () => {
      releaseExpired();
      const e = getEvent(id);
      setEvent(e);
      if (!e) {
        setLayout(null);
        setInventory([]);
        setLoaded(true);
        return;
      }
      const layouts = listLayouts();
      const explicitLayout = e.venue_layout_id ? getLayout(e.venue_layout_id) : undefined;
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
      setInventory(getInventory(id));
      setLoaded(true);
    };
    load();
    const t = setInterval(load, 15000);
    window.addEventListener(EVENTS_EVENT, load);
    window.addEventListener(INV_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      clearInterval(t);
      window.removeEventListener(EVENTS_EVENT, load);
      window.removeEventListener(INV_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, [id]);

  const isMap = !!layout && event?.sale_type !== "standing";
  const basePrice = event?.base_price ?? Number(event?.tickets?.[0]?.price ?? 0);
  const vipPrice = event?.vip_price ?? basePrice;

  const toggleSeat = (s: Selected) => {
    setSelected((prev) =>
      prev.some((x) => x.seat_id === s.seat_id)
        ? prev.filter((x) => x.seat_id !== s.seat_id)
        : [...prev, s],
    );
  };

  const total = isMap ? selected.reduce((sum, s) => sum + s.price, 0) : qty * basePrice;

  const checkout = () => {
    if (!event) return;
    setSubmitting(true);
    try {
      const items = isMap
        ? selected.map((s) => ({ seat_id: s.seat_id, label: s.label, price: s.price }))
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
        items,
        total_amount: total,
      });
      if (isMap) {
        const ok = reserveSeats(
          event.id,
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
              className="aspect-[21/9] rounded-2xl bg-muted bg-cover bg-center mb-8"
              style={event.image_url ? { backgroundImage: `url(${event.image_url})` } : undefined}
            />
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-6">
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                    {event.category}
                  </span>
                  <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight mt-2">
                    {event.title}
                  </h1>
                  <div className="flex flex-wrap gap-4 mt-4 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="size-4" /> {event.event_date} · {event.event_time}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="size-4" /> {event.venue}, {event.city}
                    </span>
                  </div>
                  {event.description && (
                    <p className="text-foreground/80 leading-relaxed mt-6 whitespace-pre-line">
                      {event.description}
                    </p>
                  )}
                </div>

                {isMap && layout ? (
                  <div>
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
              </div>

              <Card className="hidden p-6 bg-card/60 border-border/50 h-fit lg:sticky lg:top-[120px] lg:block">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="font-display font-semibold text-xl">Košík</h2>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {isMap ? selected.length : qty} ks
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mb-4 line-clamp-1">{event.title}</div>

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
                                  <div className="mt-1 text-[10px] font-semibold text-yellow-500">VIP</div>
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
                              <span className="font-display font-semibold">€{s.price.toFixed(2)}</span>
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

                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Počet vstupeniek</span>
                  <span className="font-semibold">{isMap ? selected.length : qty}</span>
                </div>
                <div className="mt-4 pt-4 border-t border-border/40 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Celková cena</span>
                  <span className="font-display text-2xl font-bold">€{total.toFixed(2)}</span>
                </div>

                <Button
                  onClick={checkout}
                  disabled={submitting || (isMap && selected.length === 0)}
                  className="w-full mt-5 bg-gradient-flame text-primary-foreground shadow-glow"
                >
                  <Ticket className="size-4 mr-2" />
                  Pokračovať do checkoutu
                </Button>

                {isMap && (
                  <div className="mt-3 text-[11px] text-muted-foreground text-center">
                    Vybrané miesta: {selected.length}
                  </div>
                )}
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
                disabled={submitting || (isMap && selected.length === 0)}
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
