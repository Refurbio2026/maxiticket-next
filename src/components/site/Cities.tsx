import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicStats } from "@/lib/public-stats.functions";
import { Link } from "@tanstack/react-router";
import bratislavaImg from "@/assets/city-bratislava.jpg";
import kosiceImg from "@/assets/city-kosice.jpg";
import zilinaImg from "@/assets/city-zilina.jpg";
import bbImg from "@/assets/city-banska-bystrica.jpg";
import nitraImg from "@/assets/city-nitra.jpg";
import trnavaImg from "@/assets/city-trnava.jpg";
import trencinImg from "@/assets/city-trencin.jpg";
import presovImg from "@/assets/city-presov.jpg";

/**
 * Fotky miest. Počty podujatí sa **nepíšu sem** — berú sa z databázy.
 * Predtým tu boli vymyslené (Bratislava 842 podujatí pri 28 v celej databáze)
 * a mesto sa zobrazovalo aj keď v ňom nič nebolo.
 *
 * Zoznam nie je filter: mesto, ktoré tu nie je, sa zobrazí s farebnou plochou
 * namiesto fotky. Keď pribudne fotka, stačí ju dopísať sem.
 */
const OBRAZKY: Record<string, string> = {
  Bratislava: bratislavaImg,
  Košice: kosiceImg,
  Žilina: zilinaImg,
  "Banská Bystrica": bbImg,
  Nitra: nitraImg,
  Trnava: trnavaImg,
  Trenčín: trencinImg,
  Prešov: presovImg,
};

export function Cities() {
  const fetchStats = useServerFn(getPublicStats);
  const { data } = useQuery({
    queryKey: ["public-stats"],
    queryFn: () => fetchStats(),
    staleTime: 5 * 60_000,
  });

  // Len mestá, v ktorých naozaj niečo je — zoradené podľa počtu podujatí.
  // Mesto bez fotky sa **nezahadzuje**: dostane farebnú plochu. Inak by sa
  // skrylo práve to najaktívnejšie (Pezinok má 20 z 28 podujatí a fotku nie).
  const mesta = (data?.mesta ?? []).slice(0, 8);

  // Kým sa nič nenačítalo alebo nie je čo zobraziť, sekcia sa neukáže vôbec.
  if (mesta.length === 0) return null;

  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex items-end justify-between mb-12">
          <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight max-w-lg">
            Tvoje mesto <br />— tvoja scéna.
          </h2>
          <p className="text-muted-foreground max-w-xs hidden md:block">
            Objav, čo sa deje vo tvojom okolí. Od malých klubov po veľké arény.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {mesta.map((c, i) => (
            <motion.div
              key={c.nazov}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04 }}
            >
              <Link
                to="/events"
                search={{ city: c.nazov } as never}
                className="relative aspect-[5/4] rounded-2xl overflow-hidden border border-border block group"
              >
                {OBRAZKY[c.nazov] ? (
                  <img
                    src={OBRAZKY[c.nazov]}
                    alt={`${c.nazov} — podujatia a koncerty`}
                    loading="lazy"
                    width={800}
                    height={640}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/70 via-accent/50 to-primary/30 transition-transform duration-700 ease-out group-hover:scale-110" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/40 group-hover:from-black/75 transition-colors duration-500" />
                <div className="absolute inset-0 p-5 flex flex-col justify-between text-white">
                  <div className="text-xs font-medium text-white/80 backdrop-blur-sm bg-black/20 self-start rounded-full px-2.5 py-1 border border-white/10">
                    {popisPoctu(c.pocet)}
                  </div>
                  <div>
                    <div className="font-display text-2xl font-bold drop-shadow-lg">{c.nazov}</div>
                    <div className="mt-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                      Pozrieť →
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
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
