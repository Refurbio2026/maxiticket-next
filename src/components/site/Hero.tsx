import { motion } from "framer-motion";
import { Search, MapPin, Calendar, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import hero from "@/assets/hero-concert.jpg";

const stats = [
  { v: "1.2M+", l: "predaných vstupeniek" },
  { v: "8 400", l: "podujatí ročne" },
  { v: "120+", l: "miest na Slovensku" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-24 noise">
      {/* background */}
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

      {/* floating chips */}
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
            <div className="text-sm font-medium">238 ľudí kupuje lístky</div>
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
            Koncerty, festivaly, šport, divadlo, stand-up — kupuj vstupenky bezpečne,
            okamžite a bez skrytých poplatkov.
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
                placeholder="Hľadaj koncert, festival, klub..."
                className="bg-transparent outline-none w-full text-sm placeholder:text-muted-foreground"
              />
            </div>
            <div className="hidden md:flex items-center gap-3 px-4 border-l border-border min-h-12">
              <MapPin className="size-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Bratislava</span>
            </div>
            <div className="hidden md:flex items-center gap-3 px-4 border-l border-border min-h-12">
              <Calendar className="size-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Tento víkend</span>
            </div>
            <Button className="rounded-xl bg-gradient-flame text-primary-foreground hover:opacity-90 px-6 h-12">
              Nájsť
              <ArrowRight className="size-4" />
            </Button>
          </motion.div>

          {/* quick tags */}
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            <span className="text-muted-foreground mr-1">Trending:</span>
            {["Pohoda 2026", "Calypso Bratislava", "HC Slovan", "Lúčnica", "Iné Kafe"].map((t) => (
              <a
                key={t}
                href="#"
                className="rounded-full border border-border px-3 py-1 hover:border-primary hover:text-primary transition-colors"
              >
                {t}
              </a>
            ))}
          </div>

          {/* stats */}
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
