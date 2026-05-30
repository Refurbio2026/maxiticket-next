import { createFileRoute, Link, Outlet, useRouterState, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { getEvents, EVENTS_EVENT, type EventItem } from "@/lib/local-db";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { Calendar, MapPin, Search, SlidersHorizontal, X } from "lucide-react";

export const Route = createFileRoute("/events")({
  head: () => ({
    meta: [
      { title: "Podujatia · MAXITICKET" },
      { name: "description", content: "Objavte všetky podujatia, koncerty, festivaly a kultúru na MAXITICKET." },
    ],
  }),
  component: EventsPage,
});

const ALL = "__all__";

function priceOf(e: EventItem) {
  return Number(e.base_price ?? e.tickets?.[0]?.price ?? 0);
}

function EventsPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [events, setEvents] = useState<EventItem[]>([]);

  // filters
  const [q, setQ] = useState("");
  const [city, setCity] = useState<string>(ALL);
  const [category, setCategory] = useState<string>(ALL);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  useEffect(() => {
    const load = () =>
      setEvents(
        getEvents()
          .filter((e) => e.status === "published")
          .sort((a, b) => a.event_date.localeCompare(b.event_date)),
      );
    load();
    window.addEventListener(EVENTS_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(EVENTS_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  const { cities, categories, priceCeiling } = useMemo(() => {
    const c = new Set<string>();
    const k = new Set<string>();
    let max = 0;
    events.forEach((e) => {
      if (e.city) c.add(e.city);
      if (e.category) k.add(e.category);
      const p = priceOf(e);
      if (p > max) max = p;
    });
    return {
      cities: Array.from(c).sort(),
      categories: Array.from(k).sort(),
      priceCeiling: Math.max(50, Math.ceil(max / 10) * 10),
    };
  }, [events]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return events.filter((e) => {
      if (qq && !`${e.title} ${e.venue} ${e.city}`.toLowerCase().includes(qq)) return false;
      if (city !== ALL && e.city !== city) return false;
      if (category !== ALL && e.category !== category) return false;
      if (dateFrom && e.event_date < dateFrom) return false;
      if (dateTo && e.event_date > dateTo) return false;
      if (maxPrice != null && priceOf(e) > maxPrice) return false;
      return true;
    });
  }, [events, q, city, category, dateFrom, dateTo, maxPrice]);

  const reset = () => {
    setQ(""); setCity(ALL); setCategory(ALL);
    setDateFrom(""); setDateTo(""); setMaxPrice(null);
  };
  const activeFilters =
    (q ? 1 : 0) + (city !== ALL ? 1 : 0) + (category !== ALL ? 1 : 0) +
    (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (maxPrice != null ? 1 : 0);

  if (pathname !== "/events") return <Outlet />;

  const filterPanel = (
    <div className="space-y-5">
      <FilterBlock label="Vyhľadávanie">
        <div className="relative">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Názov, miesto…"
            className="pl-9"
          />
        </div>
      </FilterBlock>

      <FilterBlock label="Mesto">
        <Select value={city} onValueChange={setCity}>
          <SelectTrigger><SelectValue placeholder="Všetky" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Všetky mestá</SelectItem>
            {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterBlock>

      <FilterBlock label="Kategória">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue placeholder="Všetky" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Všetky kategórie</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterBlock>

      <FilterBlock label="Dátum od">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
      </FilterBlock>
      <FilterBlock label="Dátum do">
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </FilterBlock>

      <FilterBlock label={`Max. cena: €${maxPrice ?? priceCeiling}`}>
        <Slider
          min={0}
          max={priceCeiling}
          step={5}
          value={[maxPrice ?? priceCeiling]}
          onValueChange={(v) => setMaxPrice(v[0])}
        />
      </FilterBlock>

      {activeFilters > 0 && (
        <Button variant="outline" size="sm" onClick={reset} className="w-full gap-1.5">
          <X className="size-3.5" /> Vyčistiť filtre ({activeFilters})
        </Button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 pt-32 pb-20">
        <div className="mb-8">
          <h1 className="font-display text-5xl font-bold tracking-tight">Podujatia</h1>
          <p className="text-muted-foreground mt-2">
            {filtered.length} {filtered.length === 1 ? "podujatie" : filtered.length < 5 ? "podujatia" : "podujatí"} · všetko na jednom mieste
          </p>
        </div>

        <div className="lg:hidden mb-4">
          <Button variant="outline" onClick={() => setShowMobileFilters((v) => !v)} className="gap-2 w-full">
            <SlidersHorizontal className="size-4" />
            Filtre {activeFilters > 0 && <span className="ml-1 rounded-full bg-primary text-primary-foreground text-[10px] px-2 py-0.5">{activeFilters}</span>}
          </Button>
          {showMobileFilters && (
            <Card className="mt-3 p-5 bg-card/60 border-border/50">{filterPanel}</Card>
          )}
        </div>

        <div className="grid lg:grid-cols-[260px_1fr] gap-8">
          <aside className="hidden lg:block">
            <Card className="p-5 bg-card/60 border-border/50 sticky top-24">{filterPanel}</Card>
          </aside>

          <div>
            {filtered.length === 0 ? (
              <Card className="p-12 text-center bg-card/60 border-dashed border-border/50">
                <Calendar className="size-10 text-muted-foreground mx-auto mb-3" />
                <div className="font-semibold">Žiadne podujatia nezodpovedajú filtrom</div>
                <p className="text-sm text-muted-foreground mt-1">Skús zmeniť kritériá vyhľadávania.</p>
                {activeFilters > 0 && (
                  <Button variant="outline" size="sm" onClick={reset} className="mt-4 gap-1.5">
                    <X className="size-3.5" /> Vyčistiť filtre
                  </Button>
                )}
              </Card>
            ) : (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {filtered.map((e) => (
                  <Card key={e.id} className="overflow-hidden bg-card/60 border-border/50 hover:border-primary/40 hover:shadow-glow transition group">
                    <Link
                      to="/events/$id"
                      params={{ id: e.id }}
                      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <div
                        className="aspect-video bg-muted bg-cover bg-center group-hover:scale-[1.02] transition-transform"
                        style={e.image_url ? { backgroundImage: `url(${e.image_url})` } : undefined}
                      />
                      <div className="p-5 space-y-2">
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">{e.category}</span>
                        <h3 className="font-display font-semibold text-lg leading-tight">{e.title}</h3>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Calendar className="size-3.5" /> {e.event_date} · {e.event_time}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <MapPin className="size-3.5" /> {e.venue}, {e.city}
                        </div>
                        <div className="pt-2 flex items-center justify-between">
                          <div className="text-sm">
                            <span className="text-muted-foreground">od </span>
                            <span className="font-display font-bold text-base">€{priceOf(e).toFixed(2)}</span>
                          </div>
                          <span className={cn(buttonVariants({ size: "sm" }), "bg-gradient-flame text-primary-foreground shadow-glow")}>
                            Kúpiť vstupenky
                          </span>
                        </div>
                      </div>
                    </Link>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function FilterBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
