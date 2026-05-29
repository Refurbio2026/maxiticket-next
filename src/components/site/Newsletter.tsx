import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";

export function Newsletter() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative overflow-hidden rounded-[2rem] p-12 md:p-16 border border-border noise"
        >
          <div className="absolute inset-0 bg-hero" />
          <div className="absolute -bottom-32 -right-32 size-96 rounded-full bg-primary/30 blur-3xl" />
          <div className="absolute -top-32 -left-32 size-96 rounded-full bg-accent/20 blur-3xl" />

          <div className="relative max-w-2xl">
            <div className="inline-flex items-center gap-2 glass rounded-full px-3 py-1 text-xs mb-5">
              <Mail className="size-3.5" /> Newsletter
            </div>
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
              Nepremeškaj žiadny <span className="text-gradient-flame">drop.</span>
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Týždenný výber najlepších podujatí, early access a -20% kódy. Bez spamu.
            </p>
            <form className="mt-8 flex flex-col sm:flex-row gap-3 max-w-lg">
              <input
                type="email"
                required
                placeholder="tvoj@email.sk"
                className="flex-1 glass rounded-xl px-5 h-12 text-sm outline-none focus:border-primary placeholder:text-muted-foreground"
              />
              <Button className="rounded-xl bg-gradient-flame text-primary-foreground hover:opacity-90 h-12 px-6 shadow-glow">
                Odoberať
              </Button>
            </form>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
