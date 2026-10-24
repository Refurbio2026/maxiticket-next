import { useMemo, useState } from "react";
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
import { cislo, getPublicStats } from "@/lib/public-stats.functions";
import { HeroKolaz } from "@/components/site/HeroKolaz";
import hero from "@/assets/hero-concert.jpg";

/**
 * Od koľkých kupujúcich sa odznak „Práve teraz" vôbec zobrazí.
 *
 * Pri jednom alebo dvoch to nie je sociálny dôkaz, ale priznanie, že je tu
 * ticho — a pri nule by to bolo smiešne.
 */
const ODZNAK_OD = 5;

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
  const kupujucich = live?.count ?? 0;

  // Čísla pod vyhľadávaním sú z databázy. Predtým tu boli napísané naprdlo
  // („1.2M+ predaných vstupeniek") a nesedeli s realitou ani o jeden rád.
  const fetchStats = useServerFn(getPublicStats);
  const { data: statistiky } = useQuery({
    queryKey: ["public-stats"],
    queryFn: () => fetchStats(),
    staleTime: 5 * 60_000,
  });
  const cisla = useMemo(() => {
    if (!statistiky) return [];
    return [
      { v: cislo(statistiky.vstupeniek), l: "vydaných vstupeniek" },
      { v: cislo(statistiky.vPredaji), l: "podujatí v predaji" },
      { v: cislo(statistiky.mesta.length), l: statistiky.mesta.length === 1 ? "mesto" : "miest" },
    ].filter((x) => x.v !== "0");
  }, [statistiky]);

  // Ponuka miest vo vyhľadávaní aj koláž vychádzajú z publikovaných podujatí.
  const { data: publishedEvents = [] } = useEvents();
  const cities = useMemo(
    () => Array.from(new Set(publishedEvents.map((e) => e.city).filter(Boolean))).sort(),
    [publishedEvents],
  );

  // Do koláže idú najbližšie podujatia, prednostne tie s obrázkom — karta bez
  // obrázka vyzerá v koláži ako chyba.
  const doKolaze = useMemo(() => {
    const dnes = new Date().toISOString().slice(0, 10);
    const buduce = publishedEvents
      .filter((e) => e.event_date >= dnes)
      .sort((a, b) => a.event_date.localeCompare(b.event_date));
    return [...buduce.filter((e) => e.image_url), ...buduce.filter((e) => !e.image_url)].slice(
      0,
      4,
    );
  }, [publishedEvents]);

  // Prvé tri najbližšie podujatia do štítkov pod vyhľadávaním.
  const najblizsie = useMemo(() => doKolaze.slice(0, 3), [doKolaze]);

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

      <div className="relative mx-auto max-w-7xl px-4">
        <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10">
          {/* --- text --- */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-6 inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-accent animate-pulse" />
              Vstupenka s QR kódom e-mailom hneď po zaplatení
            </div>

            {/*
              Riadky sú `inline-block` s drobným vnútorným odsadením. Dôvod:
              `leading-[1.06]` je tesné a pri slovenčine by chvost „ý“ alebo „j“
              z prvého riadku sadol na mäkčeň či dĺžeň druhého. Odsadenie zväčší
              inline box, takže sa riadky nedotknú, a pritom zostáva presne to
              riadkovanie, ktoré má byť.
            */}
            <h1 className="font-display text-[clamp(2.75rem,6.2vw,5.5rem)] font-bold leading-[1.06] tracking-[-0.02em]">
              <span className="inline-block py-[0.045em]">Každý zážitok</span>
              <br />
              <span className="inline-block py-[0.045em]">
                má svoj <span className="text-gradient-flame">vstup.</span>
              </span>
            </h1>

            <p className="mt-7 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">
              Koncerty, festivaly, šport, divadlo, stand-up — kupuj vstupenky bezpečne, okamžite a
              bez skrytých poplatkov.
            </p>

            {/* vyhľadávanie */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.7 }}
              className="mt-11 glass flex max-w-3xl flex-col gap-2 rounded-2xl p-2 shadow-card-premium md:flex-row"
            >
              <div className="flex min-h-12 flex-1 items-center gap-3 px-4">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={onKey}
                  placeholder="Hľadaj koncert, festival, klub..."
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>

              <CityPicker city={city} setCity={setCity} cities={cities} />

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="hidden min-h-12 items-center gap-3 border-l border-border px-4 text-sm transition-colors hover:text-foreground md:flex"
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
                    <div className="border-t border-border p-2">
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
                className="h-12 rounded-xl bg-gradient-flame px-6 text-primary-foreground hover:opacity-90"
              >
                Nájsť
                <ArrowRight className="size-4" />
              </Button>
            </motion.div>

            {/* filtre na mobile — na desktope ich nahrádza riadok vyhľadávania */}
            <div className="mt-3 flex flex-wrap gap-2 md:hidden">
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
            {/*
              Štítky sú skutočné najbližšie podujatia. Predtým tu boli napísané
              naprdlo názvy („Pohoda 2026", „HC Slovan"), ktoré sme nepredávali —
              klik na ne viedol na prázdne vyhľadávanie.
            */}
            {najblizsie.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="mr-1 text-muted-foreground">Najbližšie:</span>
                {najblizsie.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => navigate({ to: "/events/$id", params: { id: e.id } })}
                    className="max-w-[16rem] truncate rounded-full border border-border px-3 py-1 transition-colors hover:border-primary hover:text-primary"
                    title={e.title}
                  >
                    {e.title}
                  </button>
                ))}
              </div>
            )}

            {/* Čísla sú podradené nadpisu a sú z databázy; nulu nezobrazujeme. */}
            {cisla.length > 0 && (
              <div className="mt-20 grid max-w-xl grid-cols-3 gap-6 border-t border-black/5 pt-8 dark:border-white/10">
                {cisla.map((x) => (
                  <div key={x.l}>
                    <div className="font-display text-4xl font-semibold tracking-tight text-foreground/90">
                      {x.v}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{x.l}</div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* --- koláž --- */}
          <div className="relative hidden lg:block">
            {/*
              Odznak je vnútri kontajnera, nie pri okraji obrazovky — predtým
              visel na `right-[8%]` a pri úzkom okne sa orezal.
            */}
            {kupujucich >= ODZNAK_OD && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="absolute right-0 top-0 z-40 animate-float"
              >
                <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3">
                  <div className="grid size-10 place-items-center rounded-xl bg-accent/20">
                    <Sparkles className="size-5 text-accent" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Práve teraz</div>
                    <div className="text-sm font-medium">{kupujucich} ľudí kupuje lístky</div>
                  </div>
                </div>
              </motion.div>
            )}

            <div className="pt-14">
              <HeroKolaz podujatia={doKolaze} />
            </div>
          </div>
        </div>
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
