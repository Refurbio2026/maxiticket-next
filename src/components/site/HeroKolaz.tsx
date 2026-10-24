// Koláž podujatí v pravom stĺpci hero sekcie.
//
// Karty sú jemne natočené a prekrývajú sa, takže pôsobia ako rozhodené
// lístky na stole. Dáta sú zo **skutočných najbližších podujatí** v databáze,
// nie vymyslené — keď žiadne nie sú, koláž sa nezobrazí vôbec.
//
// Natočenie a posuny sú pevné (nie náhodné): hero sa pri každom načítaní
// renderuje rovnako, inak by to pri SSR „poskočilo".
import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { CalendarDays, MapPin } from "lucide-react";
import type { EventRecord } from "@/hooks/use-events";

/** Natočenie, posun a hĺbka pre každú kartu v koláži. */
const ROZLOZENIE = [
  { rotate: -5, x: 0, y: 0, z: 30 },
  { rotate: 3.5, x: 118, y: 54, z: 20 },
  { rotate: -2, x: 26, y: 208, z: 10 },
  { rotate: 6, x: 150, y: 268, z: 0 },
] as const;

function datum(iso: string): string {
  // `sk-SK` dá „1. nov. 2026"; bez roka, keď je tento rok.
  try {
    const d = new Date(`${iso}T00:00:00`);
    const tentoRok = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString("sk-SK", {
      day: "numeric",
      month: "short",
      ...(tentoRok ? {} : { year: "numeric" }),
    });
  } catch {
    return iso;
  }
}

function cena(od: number | null | undefined): string | null {
  if (od === null || od === undefined || !Number.isFinite(od)) return null;
  return `od ${od.toFixed(2).replace(".", ",")} €`;
}

export function HeroKolaz({ podujatia }: { podujatia: EventRecord[] }) {
  const karty = podujatia.slice(0, 4);
  if (karty.length === 0) return null;

  return (
    <div
      className="relative h-[470px] w-full"
      // Koláž je dekorácia; čítačke obrazovky stačí zoznam podujatí nižšie
      // na stránke, tu by len duplikovala obsah.
      aria-hidden
    >
      {karty.map((e, i) => {
        const r = ROZLOZENIE[i];
        return (
          <motion.div
            key={e.id}
            initial={{ opacity: 0, y: 24, rotate: r.rotate * 0.4 }}
            animate={{ opacity: 1, y: 0, rotate: r.rotate }}
            transition={{ delay: 0.35 + i * 0.09, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            style={{ left: r.x, top: r.y, zIndex: r.z }}
            className="absolute w-[220px] sm:w-[244px]"
          >
            <Link
              to="/events/$id"
              params={{ id: e.id }}
              tabIndex={-1}
              className="block overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_18px_40px_-18px_rgb(0_0_0/0.45)] transition-transform duration-300 hover:-translate-y-1"
            >
              <div
                className="aspect-[16/10] bg-muted bg-cover bg-center"
                style={e.image_url ? { backgroundImage: `url(${e.image_url})` } : undefined}
              />
              <div className="space-y-1.5 p-3.5">
                <div className="line-clamp-2 font-display text-sm font-semibold leading-snug">
                  {e.title}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <CalendarDays className="size-3" />
                  {datum(e.event_date)}
                </div>
                {e.city && (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <MapPin className="size-3" />
                    {e.city}
                  </div>
                )}
                {cena(e.base_price) && (
                  <div className="pt-0.5 text-xs font-semibold">{cena(e.base_price)}</div>
                )}
              </div>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}
