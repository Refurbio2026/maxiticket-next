import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import bratislavaImg from "@/assets/city-bratislava.jpg";
import kosiceImg from "@/assets/city-kosice.jpg";
import zilinaImg from "@/assets/city-zilina.jpg";
import bbImg from "@/assets/city-banska-bystrica.jpg";
import nitraImg from "@/assets/city-nitra.jpg";
import trnavaImg from "@/assets/city-trnava.jpg";
import trencinImg from "@/assets/city-trencin.jpg";
import presovImg from "@/assets/city-presov.jpg";

const cities = [
  { name: "Bratislava", count: 842, image: bratislavaImg },
  { name: "Košice", count: 421, image: kosiceImg },
  { name: "Žilina", count: 287, image: zilinaImg },
  { name: "Banská Bystrica", count: 198, image: bbImg },
  { name: "Nitra", count: 176, image: nitraImg },
  { name: "Trnava", count: 142, image: trnavaImg },
  { name: "Trenčín", count: 124, image: trencinImg },
  { name: "Prešov", count: 98, image: presovImg },
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
            <motion.div
              key={c.name}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04 }}
            >
              <Link
                to="/events"
                search={{ city: c.name } as never}
                className="relative aspect-[5/4] rounded-2xl overflow-hidden border border-border block group"
              >
                <img
                  src={c.image}
                  alt={`${c.name} — podujatia a koncerty`}
                  loading="lazy"
                  width={800}
                  height={640}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/40 group-hover:from-black/75 transition-colors duration-500" />
                <div className="absolute inset-0 p-5 flex flex-col justify-between text-white">
                  <div className="text-xs font-medium text-white/80 backdrop-blur-sm bg-black/20 self-start rounded-full px-2.5 py-1 border border-white/10">
                    {c.count} podujatí
                  </div>
                  <div>
                    <div className="font-display text-2xl font-bold drop-shadow-lg">{c.name}</div>
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
