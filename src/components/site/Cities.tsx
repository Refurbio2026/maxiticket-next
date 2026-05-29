import { motion } from "framer-motion";

const cities = [
  { name: "Bratislava", count: 842, accent: "from-orange-500/40 to-amber-500/20" },
  { name: "Košice", count: 421, accent: "from-purple-500/40 to-pink-500/20" },
  { name: "Žilina", count: 287, accent: "from-cyan-500/40 to-blue-500/20" },
  { name: "Banská Bystrica", count: 198, accent: "from-emerald-500/40 to-teal-500/20" },
  { name: "Nitra", count: 176, accent: "from-pink-500/40 to-rose-500/20" },
  { name: "Trnava", count: 142, accent: "from-amber-500/40 to-yellow-500/20" },
  { name: "Trenčín", count: 124, accent: "from-blue-500/40 to-indigo-500/20" },
  { name: "Prešov", count: 98, accent: "from-fuchsia-500/40 to-purple-500/20" },
];

export function Cities() {
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
          {cities.map((c, i) => (
            <motion.a
              key={c.name}
              href="#"
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04 }}
              whileHover={{ scale: 1.02 }}
              className="relative aspect-[5/4] rounded-2xl overflow-hidden border border-border group"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${c.accent}`} />
              <div className="absolute inset-0 bg-card/70 group-hover:bg-card/40 transition-colors duration-500" />
              <div className="absolute inset-0 p-5 flex flex-col justify-between">
                <div className="text-xs text-muted-foreground">{c.count} podujatí</div>
                <div>
                  <div className="font-display text-2xl font-bold">{c.name}</div>
                  <div className="mt-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    Pozrieť →
                  </div>
                </div>
              </div>
            </motion.a>
          ))}
        </div>
      </div>
    </section>
  );
}
