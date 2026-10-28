// Stránka série (turné) — jedno predstavenie vo viacerých mestách.
//
// Vzor je z Ticketportalu (overené 28. 10. 2026): v hlavičke rozsah dátumov
// a zoznam miest, pod tým zvislý zoznam predstavení, kde každé má svoj deň,
// čas, miesto, mesto a vlastné tlačidlo Kúpiť. Žiadna rozbaľovačka —
// kupujúci chce vidieť naraz, či sa to hrá aj u neho.
//
// U nás je každé predstavenie turné vlastné podujatie, lebo `event_dates`
// nemá miesto; séria ich drží spolu cez `event_groups`.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Calendar, Clock, Loader2, MapPin, Ticket } from "lucide-react";
import { serieBySlug, type PredstavenieSerie } from "@/lib/serie.functions";
import { den, hodina, rozsah } from "@/lib/terminy-popis";
import { pocetMiest } from "@/lib/serie";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/seria/$slug")({
  head: () => ({ meta: [{ title: "Séria podujatí · eticketo.eu" }] }),
  component: SeriaPage,
});

/** Skratka dňa v týždni — v zozname predstavení pomáha rýchlo nájsť víkend. */
function denVTyzdni(datum: string): string {
  const d = new Date(`${datum}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("sk-SK", { weekday: "short" });
}

const eur = (n: number) =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function SeriaPage() {
  const { slug } = Route.useParams();
  const nacitaj = useServerFn(serieBySlug);
  const { data, isLoading } = useQuery({
    queryKey: ["seria", slug],
    queryFn: () => nacitaj({ data: { slug } }),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <Obal>
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      </Obal>
    );
  }

  if (!data) {
    return (
      <Obal>
        <Card className="p-12 text-center bg-card/60 border-dashed">
          <p className="text-muted-foreground">Takúto sériu nemáme.</p>
          <Link
            to="/events"
            className={cn(buttonVariants({ variant: "outline" }), "mt-5 inline-flex")}
          >
            Prejsť na katalóg
          </Link>
        </Card>
      </Obal>
    );
  }

  const p = data.predstavenia;
  const mesta: string[] = [];
  for (const x of p) if (x.city && !mesta.includes(x.city)) mesta.push(x.city);
  const odDo = p.length ? rozsah(p[0].datum, p[p.length - 1].datum) : null;
  const ceny = p.map((x) => x.cenaOd).filter((c): c is number => typeof c === "number" && c > 0);
  const cenaOd = ceny.length ? Math.min(...ceny) : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      <section className="relative pt-32 pb-10 bg-hero noise overflow-hidden">
        <div className="mx-auto max-w-5xl px-4 relative z-10">
          {data.kategoria && (
            <div className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-3">
              {data.kategoria}
            </div>
          )}
          <h1 className="font-display text-3xl md:text-5xl font-bold tracking-tight leading-tight">
            {data.nazov}
          </h1>

          {/* Rozsah a mestá hneď pod názvom — to je prvé, čo človek hľadá. */}
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {odDo && (
              <span className="inline-flex items-center gap-2">
                <Calendar className="size-4 shrink-0" /> {odDo}
              </span>
            )}
            {mesta.length > 0 && (
              <span className="inline-flex items-center gap-2">
                <MapPin className="size-4 shrink-0" /> {mesta.join(", ")}
              </span>
            )}
            {cenaOd !== null && (
              <span className="inline-flex items-center gap-2">
                <Ticket className="size-4 shrink-0" /> od {eur(cenaOd)}
              </span>
            )}
          </div>

          {data.popis && (
            <p className="mt-5 text-base text-muted-foreground max-w-2xl">{data.popis}</p>
          )}
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-4 py-12">
        <h2 className="font-display text-xl font-bold mb-1">Vstupenky</h2>
        <p className="text-sm text-muted-foreground mb-5">
          {p.length > 0
            ? `${p.length === 1 ? "Jedno predstavenie" : `${p.length} predstavení`}${
                mesta.length > 1 ? ` v ${pocetMiest(mesta.length)}` : ""
              }. Vyber si to svoje.`
            : "Termíny zverejníme."}
        </p>

        {p.length === 0 ? (
          <Card className="p-10 text-center bg-card/60 border-dashed text-muted-foreground">
            Pre túto sériu zatiaľ nie je v predaji žiadne predstavenie.
          </Card>
        ) : (
          <Card className="bg-card/60 border-border/50 divide-y divide-border/40 overflow-hidden">
            {p.map((x) => (
              <Riadok key={x.event_id} p={x} />
            ))}
          </Card>
        )}
      </main>

      <Footer />
    </div>
  );
}

/**
 * Jedno predstavenie. Na telefóne pod sebou (dátum, miesto, tlačidlo na celú
 * šírku), od tabletu v jednom riadku.
 */
function Riadok({ p }: { p: PredstavenieSerie }) {
  const cas = hodina(p.cas);
  return (
    <div className="p-4 sm:p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
      <div className="sm:w-40 shrink-0">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {denVTyzdni(p.datum)}
        </div>
        <div className="font-display text-lg font-bold leading-tight">{den(p.datum)}</div>
        {cas && (
          <div className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
            <Clock className="size-3.5" /> {cas}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="font-medium leading-snug">{p.venue}</div>
        <div className="text-sm text-muted-foreground">{p.city}</div>
      </div>

      <div className="flex items-center justify-between gap-3 sm:justify-end">
        {p.cenaOd !== null && (
          <div className="text-sm">
            <span className="text-muted-foreground">od </span>
            <span className="font-display font-bold">{eur(p.cenaOd)}</span>
          </div>
        )}
        {p.vPredaji ? (
          <Link
            to="/events/$id"
            params={{ id: p.event_id }}
            className={cn(
              buttonVariants({ size: "sm" }),
              "bg-gradient-flame text-primary-foreground shadow-glow shrink-0",
            )}
          >
            Kúpiť
          </Link>
        ) : (
          // Predstavenie bez otvoreného predaja zo zoznamu nemizne — človek
          // má vidieť celé turné. Len sa z neho nedá kúpiť.
          <span className="text-xs text-muted-foreground shrink-0">nie je v predaji</span>
        )}
      </div>
    </div>
  );
}

function Obal({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 pt-40 pb-20">{children}</main>
      <Footer />
    </div>
  );
}
