import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { Music, Mic2, Trophy, Theater, Drama, Users, Lightbulb, Disc3 } from "lucide-react";

const cats = [
  { icon: Music, label: "Koncerty", slug: "koncerty", count: 1240, hue: "from-orange-500/20 to-amber-500/10" },
  { icon: Disc3, label: "Festivaly", slug: "festivaly", count: 86, hue: "from-pink-500/20 to-orange-500/10" },
  { icon: Trophy, label: "Šport", slug: "sport", count: 412, hue: "from-blue-500/20 to-cyan-500/10" },
  { icon: Theater, label: "Divadlo", slug: "divadlo", count: 318, hue: "from-purple-500/20 to-pink-500/10" },
  { icon: Mic2, label: "Stand-up", slug: "stand-up", count: 95, hue: "from-amber-500/20 to-orange-500/10" },
  { icon: Users, label: "Konferencie", slug: "konferencie", count: 64, hue: "from-emerald-500/20 to-cyan-500/10" },
  { icon: Lightbulb, label: "Workshopy", slug: "workshopy", count: 142, hue: "from-yellow-500/20 to-amber-500/10" },
  { icon: Drama, label: "Kluby", slug: "kluby", count: 287, hue: "from-fuchsia-500/20 to-purple-500/10" },
];

const MotionLink = motion(Link);

export function Categories() {
  return (
    <section className="relative py-24 bg-surface/40">
      <div className="mx-auto max-w-7xl px-4">
        <div className="max-w-2xl mb-12">
          <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
            Vyber si <span className="text-gradient-flame">vibe</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            Od intímnych klubových koncertov až po vypredané štadióny — všetko na jednom mieste.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {cats.map((c, i) => (
            <MotionLink
              key={c.label}
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
                  <c.icon className="size-5 group-hover:text-primary-foreground transition-colors" strokeWidth={2} />
                </div>
                <div className="font-display text-lg font-semibold">{c.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{c.count} podujatí</div>
              </div>
            </MotionLink>
          ))}
        </div>
      </div>
    </section>
  );
}
