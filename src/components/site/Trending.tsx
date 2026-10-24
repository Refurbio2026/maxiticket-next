// Najbližšie podujatia na titulke.
//
// Predtým tu boli štyri **vymyslené** podujatia s cudzími názvami („Calypso
// Festival 2026", „Iné Kafe — Akustika Tour", „HC Slovan vs. Sparta") a
// vymyslenou dostupnosťou („12 voľných", „Posledné kusy"). Nič z toho sa
// nepredávalo a odkaz viedol na všeobecný zoznam podujatí.
//
// Teraz sú to skutočné podujatia z databázy, zoradené od najbližšieho, a
// karta vedie na svoje podujatie. Keď nie je čo predávať, sekcia sa nezobrazí
// — prázdna mriežka je lepšia správa než štyri cudzie značky.
import { useMemo } from "react";
import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { Calendar, MapPin, Flame } from "lucide-react";
import { useEvents } from "@/hooks/use-events";
import { odznakKategorie } from "@/lib/kategorie";

const MotionLink = motion(Link);

/** „12. jún", s rokom len keď nie je tento. */
function datum(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    const tentoRok = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString("sk-SK", {
      day: "numeric",
      month: "long",
      ...(tentoRok ? {} : { year: "numeric" }),
    });
  } catch {
    return iso;
  }
}

function cena(od: number | null | undefined): string | null {
  if (od === null || od === undefined || !Number.isFinite(od)) return null;
  if (od === 0) return "vstup zdarma";
  return `od ${od.toFixed(2).replace(".", ",")} €`;
}

export function Trending() {
  const { data: podujatia = [] } = useEvents();

  const karty = useMemo(() => {
    const dnes = new Date().toISOString().slice(0, 10);
    const buduce = podujatia
      .filter((e) => e.event_date >= dnes)
      .sort((a, b) => a.event_date.localeCompare(b.event_date));
    // Prednosť majú podujatia s obrázkom — karta s prázdnym miestom na obrázok
    // vyzerá v mriežke ako chyba. Bez obrázka sa doplní farebná plocha.
    return [...buduce.filter((e) => e.image_url), ...buduce.filter((e) => !e.image_url)].slice(
      0,
      4,
    );
  }, [podujatia]);

  if (karty.length === 0) return null;

  return (
    <section className="relative py-24">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="inline-flex items-center gap-2 text-accent text-sm font-medium mb-3">
              <Flame className="size-4" /> V predaji
            </div>
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
              Najbližšie podujatia
            </h2>
          </div>
          <Link
            to="/events"
            className="text-sm text-muted-foreground hover:text-foreground hidden sm:inline"
          >
            Všetky podujatia →
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {karty.map((e, i) => (
            <MotionLink
              key={e.id}
              to="/events/$id"
              // `motion(Link)` stráca typ parametrov cesty; samotná adresa je správna.
              params={{ id: e.id } as never}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ delay: i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -6 }}
              className="group relative overflow-hidden rounded-3xl bg-card border border-border shadow-card-premium"
            >
              <div className="relative aspect-[4/5] overflow-hidden">
                {e.image_url ? (
                  <img
                    src={e.image_url}
                    alt={e.title}
                    loading="lazy"
                    className="size-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                ) : (
                  <div className="size-full bg-gradient-to-br from-primary/25 via-accent/15 to-transparent" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
                {e.category && (
                  <div className="absolute top-3 left-3 glass rounded-full px-3 py-1 text-xs font-medium">
                    {odznakKategorie(e.category)}
                  </div>
                )}
              </div>
              <div className="p-5 -mt-16 relative">
                <h3 className="font-display text-lg font-semibold leading-tight line-clamp-2">
                  {e.title}
                </h3>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="size-3.5" />
                    {datum(e.event_date)}
                  </span>
                  {e.city && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="size-3.5" />
                      {e.city}
                    </span>
                  )}
                </div>
                {cena(e.base_price) && (
                  <div className="mt-4 text-sm font-medium text-gradient-flame">
                    {cena(e.base_price)}
                  </div>
                )}
              </div>
            </MotionLink>
          ))}
        </div>
      </div>
    </section>
  );
}
