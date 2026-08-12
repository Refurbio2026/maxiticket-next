import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Search,
  MapPin,
  Calendar as CalIcon,
  Sparkles,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useEvents } from "@/hooks/use-events";
import { getLiveBuyersCount } from "@/lib/live-stats.functions";
import hero from "@/assets/hero-concert.jpg";

const stats = [
  { v: "1.2M+", l: "predaných vstupeniek" },
  { v: "8 400", l: "podujatí ročne" },
  { v: "120+", l: "miest na Slovensku" },
];

export function Hero() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [city, setCity] = useState<string>("");
  const [date, setDate] = useState<Date | undefined>();

  const fetchBuyers = useServerFn(getLiveBuyersCount);
  const { data: live } = useQuery({
    queryKey: ["live-buyers"],
    queryFn: () => fetchBuyers(),
    refetchInterval: 30_000,
  });

  // Ponuka miest vo vyhľadávaní vychádza z publikovaných podujatí v databáze.
  const { data: publishedEvents = [] } = useEvents();
  const cities = useMemo(
    () => Array.from(new Set(publishedEvents.map((e) => e.city).filter(Boolean))).sort(),
    [publishedEvents],
  );

  const submit = () => {
    const search: Record<string, string> = {};
    if (q.trim()) search.q = q.trim();
    if (city) search.city = city;
    if (date) search.date = format(date, "yyyy-MM-dd");
    navigate({ to: "/events", search });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
  };

  return (
    <section className="relative overflow-hidden pt-32 pb-24 noise">
      <div className="absolute inset-0 bg-hero" />
      <img
        src={hero}
        alt=""
        aria-hidden
        className="absolute inset-0 size-full object-cover opacity-30 mix-blend-screen"
        width={1920}
        height={1080}
      />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent to-background" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="absolute top-32 right-[8%] hidden lg:block animate-float"
      >
        <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="size-10 rounded-xl bg-accent/20 grid place-items-center">
            <Sparkles className="size-5 text-accent" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Práve teraz</div>
            <div className="text-sm font-medium">{live?.count ?? 0} ľudí kupuje lístky</div>
          </div>
        </div>
      </motion.div>

      <div className="relative mx-auto max-w-7xl px-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-4xl"
        >
          <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 text-xs text-muted-foreground mb-6">
            <span className="size-1.5 rounded-full bg-accent animate-pulse" />
            Najmodernejšia ticketing platforma na Slovensku
          </div>

          <h1 className="font-display font-bold tracking-tighter text-[clamp(2.75rem,7vw,6rem)] leading-[0.95]">
            Každý zážitok <br />
            má svoj <span className="text-gradient-flame">vstup.</span>
          </h1>

          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Koncerty, festivaly, šport, divadlo, stand-up — kupuj vstupenky bezpečne, okamžite a bez
            skrytých poplatkov.
          </p>

          {/* search bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.7 }}
            className="mt-10 glass rounded-2xl p-2 max-w-3xl flex flex-col md:flex-row gap-2 shadow-card-premium"
          >
            <div className="flex items-center gap-3 px-4 flex-1 min-h-12">
              <Search className="size-4 text-muted-foreground shrink-0" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                placeholder="Hľadaj koncert, festival, klub..."
                className="bg-transparent outline-none w-full text-sm placeholder:text-muted-foreground"
              />
            </div>

            {/* City */}
            <CityPicker city={city} setCity={setCity} cities={cities} />

            {/* Date */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="hidden md:flex items-center gap-3 px-4 border-l border-border min-h-12 text-sm hover:text-foreground transition-colors"
                >
                  <CalIcon className="size-4 text-muted-foreground" />
                  <span className={cn(date ? "text-foreground" : "text-muted-foreground")}>
                    {date ? format(date, "d. M. yyyy") : "Vyber dátum"}
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
                {date && (
                  <div className="p-2 border-t border-border">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => setDate(undefined)}
                    >
                      Vyčistiť
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            <Button
              onClick={submit}
              className="rounded-xl bg-gradient-flame text-primary-foreground hover:opacity-90 px-6 h-12"
            >
              Nájsť
              <ArrowRight className="size-4" />
            </Button>
          </motion.div>

          {/* mobile filter summary */}
          <div className="mt-3 md:hidden flex flex-wrap gap-2">
            <CityPicker city={city} setCity={setCity} cities={cities} mobile />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <CalIcon className="size-3.5" />
                  {date ? format(date, "d. M.") : "Dátum"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* quick tags */}
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            <span className="text-muted-foreground mr-1">Trending:</span>
            {["Pohoda 2026", "Calypso Bratislava", "HC Slovan", "Lúčnica", "Iné Kafe"].map((t) => (
              <button
                key={t}
                onClick={() => navigate({ to: "/events", search: { q: t } })}
                className="rounded-full border border-border px-3 py-1 hover:border-primary hover:text-primary transition-colors"
              >
                {t}
              </button>
            ))}
          </div>

          <div className="mt-16 grid grid-cols-3 gap-6 max-w-xl">
            {stats.map((s) => (
              <div key={s.l}>
                <div className="font-display text-3xl md:text-4xl font-bold text-gradient-flame">
                  {s.v}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function CityPicker({
  city,
  setCity,
  cities,
  mobile = false,
}: {
  city: string;
  setCity: (v: string) => void;
  cities: string[];
  mobile?: boolean;
}) {
  const triggerDesktop = (
    <button
      type="button"
      className="hidden md:flex items-center gap-3 px-4 border-l border-border min-h-12 text-sm hover:text-foreground transition-colors"
    >
      <MapPin className="size-4 text-muted-foreground" />
      <span className={cn(city ? "text-foreground" : "text-muted-foreground")}>
        {city || "Všetky mestá"}
      </span>
      <ChevronDown className="size-3.5 text-muted-foreground" />
    </button>
  );
  const triggerMobile = (
    <Button variant="outline" size="sm" className="gap-1.5">
      <MapPin className="size-3.5" />
      {city || "Mesto"}
    </Button>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>{mobile ? triggerMobile : triggerDesktop}</PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <button
          onClick={() => setCity("")}
          className={cn(
            "w-full text-left text-sm px-3 py-2 rounded hover:bg-accent",
            !city && "bg-accent/50 font-medium",
          )}
        >
          Všetky mestá
        </button>
        <div className="max-h-72 overflow-y-auto">
          {cities.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Žiadne mestá</div>
          ) : (
            cities.map((c) => (
              <button
                key={c}
                onClick={() => setCity(c)}
                className={cn(
                  "w-full text-left text-sm px-3 py-2 rounded hover:bg-accent",
                  city === c && "bg-accent/50 font-medium",
                )}
              >
                {c}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
