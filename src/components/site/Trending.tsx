import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { Calendar, MapPin, Flame } from "lucide-react";
import e1 from "@/assets/event-1.jpg";
import e2 from "@/assets/event-2.jpg";
import e3 from "@/assets/event-3.jpg";
import e4 from "@/assets/event-4.jpg";

const events = [
  { img: e1, title: "Calypso Festival 2026", city: "Bratislava", date: "12. Jún", price: "od 39 €", tag: "Festival", left: 87 },
  { img: e2, title: "Iné Kafe — Akustika Tour", city: "Košice", date: "24. Máj", price: "od 24 €", tag: "Koncert", left: 12 },
  { img: e3, title: "Comedy Night: Evelyn", city: "Trnava", date: "08. Jún", price: "od 18 €", tag: "Stand-up", left: 41 },
  { img: e4, title: "HC Slovan vs. Sparta", city: "Bratislava", date: "29. Máj", price: "od 14 €", tag: "Šport", left: 230 },
];

const MotionLink = motion(Link);

export function Trending() {
  return (
    <section className="relative py-24">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="inline-flex items-center gap-2 text-accent text-sm font-medium mb-3">
              <Flame className="size-4" /> Trending tento týždeň
            </div>
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
              Práve frčia
            </h2>
          </div>
          <Link to="/events" className="text-sm text-muted-foreground hover:text-foreground hidden sm:inline">
            Všetky podujatia →
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {events.map((e, i) => (
            <MotionLink
              key={e.title}
              to="/events"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ delay: i * 0.08, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -6 }}
              className="group relative overflow-hidden rounded-3xl bg-card border border-border shadow-card-premium"
            >
              <div className="relative aspect-[4/5] overflow-hidden">
                <img
                  src={e.img}
                  alt={e.title}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
                <div className="absolute top-3 left-3 glass rounded-full px-3 py-1 text-xs font-medium">
                  {e.tag}
                </div>
                {e.left < 50 && (
                  <div className="absolute top-3 right-3 rounded-full bg-destructive/90 text-destructive-foreground px-3 py-1 text-xs font-medium">
                    Posledné kusy
                  </div>
                )}
              </div>
              <div className="p-5 -mt-16 relative">
                <h3 className="font-display text-lg font-semibold leading-tight">{e.title}</h3>
                <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><Calendar className="size-3.5" />{e.date}</span>
                  <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" />{e.city}</span>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm font-medium text-gradient-flame">{e.price}</span>
                  <span className="text-xs text-muted-foreground">{e.left} voľných</span>
                </div>
              </div>
            </motion.a>
          ))}
        </div>
      </div>
    </section>
  );
}
