import { motion } from "framer-motion";
import { Star } from "lucide-react";

const items = [
  {
    n: "Lucia K.",
    r: "Bratislava",
    q: "Konečne ticketing, ktorý nevyzerá ako z roku 2008. Vstupenku som mala v Apple Walletke za 20 sekúnd.",
    rating: 5,
  },
  {
    n: "Pohoda Festival",
    r: "Organizátor",
    q: "vipky.sk zvládol 80 000 vstupeniek bez výpadku. Check-in cez QR bol bleskový.",
    rating: 5,
  },
  {
    n: "Marek H.",
    r: "Košice",
    q: "Kúpil som lístok na koncert v aute. Žiadne registrácie, žiadne otravné formuláre.",
    rating: 5,
  },
];

export function Testimonials() {
  return (
    <section className="py-24 bg-surface/40">
      <div className="mx-auto max-w-7xl px-4">
        <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight max-w-2xl">
          Hovoria <span className="text-gradient-flame">o nás</span>
        </h2>
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          {items.map((t, i) => (
            <motion.div
              key={t.n}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="glass rounded-3xl p-7"
            >
              <div className="flex gap-0.5 mb-4">
                {Array.from({ length: t.rating }).map((_, j) => (
                  <Star key={j} className="size-4 fill-accent text-accent" />
                ))}
              </div>
              <p className="text-lg leading-relaxed">"{t.q}"</p>
              <div className="mt-6 flex items-center gap-3">
                <div className="size-10 rounded-full bg-gradient-flame grid place-items-center text-primary-foreground font-display font-bold">
                  {t.n[0]}
                </div>
                <div>
                  <div className="text-sm font-medium">{t.n}</div>
                  <div className="text-xs text-muted-foreground">{t.r}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
