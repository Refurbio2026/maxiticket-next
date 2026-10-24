import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicStats } from "@/lib/public-stats.functions";
import { Link } from "@tanstack/react-router";
import { Music, Mic2, Trophy, Theater, Drama, Users, Lightbulb, Disc3 } from "lucide-react";

/**
 * Ako sa kategória z databázy zobrazí. Počty **nie sú** tu — berú sa
 * z databázy a kategória bez podujatí sa nezobrazí vôbec.
 *
 * Predtým tu bol zoznam ôsmich kategórií s vymyslenými počtami (koncerty
 * 1 240), z ktorých päť nemalo ani jedno podujatie — klik viedol na prázdno.
 */
const POPIS: Record<string, { label: string; icon: typeof Music; hue: string }> = {
  koncert: { label: "Koncerty", icon: Music, hue: "from-orange-500/20 to-amber-500/10" },
  festival: { label: "Festivaly", icon: Disc3, hue: "from-pink-500/20 to-orange-500/10" },
  sport: { label: "Šport", icon: Trophy, hue: "from-emerald-500/20 to-teal-500/10" },
  divadlo: { label: "Divadlo", icon: Theater, hue: "from-violet-500/20 to-fuchsia-500/10" },
  "stand-up": { label: "Stand-up", icon: Mic2, hue: "from-amber-500/20 to-yellow-500/10" },
  konferencia: { label: "Konferencie", icon: Users, hue: "from-sky-500/20 to-blue-500/10" },
  workshop: { label: "Workshopy", icon: Lightbulb, hue: "from-lime-500/20 to-green-500/10" },
  kultura: { label: "Kultúra", icon: Drama, hue: "from-rose-500/20 to-orange-500/10" },
};

/** Kategória, ktorú ešte nepoznáme podľa názvu — nech sa aj tak zobrazí. */
const NAHRADNY = { icon: Drama, hue: "from-slate-500/20 to-slate-500/5" };

const MotionLink = motion(Link);

export function Categories() {
  const fetchStats = useServerFn(getPublicStats);
  const { data } = useQuery({
    queryKey: ["public-stats"],
    queryFn: () => fetchStats(),
    staleTime: 5 * 60_000,
  });

  const kategorie = (data?.kategorie ?? []).map((k) => {
    const popis = POPIS[k.slug];
    return {
      slug: k.slug,
      pocet: k.pocet,
      // Neznámu kategóriu zobrazíme pod jej vlastným názvom s veľkým písmenom.
      label: popis?.label ?? k.slug.charAt(0).toUpperCase() + k.slug.slice(1),
      icon: popis?.icon ?? NAHRADNY.icon,
      hue: popis?.hue ?? NAHRADNY.hue,
    };
  });

  if (kategorie.length === 0) return null;

  return (
    <section className="relative py-24 bg-surface/40">
      <div className="mx-auto max-w-7xl px-4">
        <div className="max-w-2xl mb-12">
          <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
            Vyber si <span className="text-gradient-flame">vibe</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            Koncerty, divadlo, festivaly aj kultúra v tvojom okolí — na jednom mieste.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {kategorie.map((c, i) => (
            <MotionLink
              key={c.slug}
              to="/events"
              search={{ category: c.slug } as never}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              whileHover={{ y: -4 }}
              className={`relative overflow-hidden rounded-2xl border border-border p-6 bg-gradient-to-br ${c.hue} group`}
            >
              <div className="absolute inset-0 bg-card/60" />
              <div className="relative">
                <div className="size-12 rounded-xl bg-background/40 backdrop-blur grid place-items-center mb-4 group-hover:bg-gradient-flame transition-all duration-300">
                  <c.icon
                    className="size-5 group-hover:text-primary-foreground transition-colors"
                    strokeWidth={2}
                  />
                </div>
                <div className="font-display text-lg font-semibold">{c.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{popisPoctu(c.pocet)}</div>
              </div>
            </MotionLink>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 1 podujatie, 2–4 podujatia, 5+ podujatí. */
function popisPoctu(n: number): string {
  if (n === 1) return "1 podujatie";
  if (n >= 2 && n <= 4) return `${n} podujatia`;
  return `${n} podujatí`;
}
