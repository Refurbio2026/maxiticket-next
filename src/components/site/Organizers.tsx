// Sekcia pre organizátorov na titulke.
//
// Všetky štyri dlaždice musia byť funkcie, ktoré v aplikácii naozaj sú.
// Predtým tu stáli „Okamžité výplaty — peniaze na účte do 48 hodín" (výplaty
// cez Stripe Connect ešte nie sú spustené) a „Marketing tooling: promo kódy,
// affiliate, newsletter, retargeting" — affiliate ani newsletter neexistujú.
// Provízia bola uvedená ako 4 %, pričom v `platform_settings` je 10 %.
import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { BarChart3, QrCode, Store, Code2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: BarChart3,
    t: "Prehľad predaja",
    d: "Predané vstupenky, tržby a vyúčtovanie priebežne počas predaja.",
  },
  { icon: QrCode, t: "QR check-in", d: "Vstupenky overíš pri vchode skenom v telefóne." },
  {
    icon: Store,
    t: "Pokladňa na mieste",
    d: "Predaj pri vchode aj v hotovosti, so zmenami a uzávierkou.",
  },
  {
    icon: Code2,
    t: "Predaj na vlastnom webe",
    d: "Vlož na svoju stránku jeden riadok kódu a predávaj priamo tam.",
  },
];

export function Organizers() {
  return (
    <section className="relative py-24 overflow-hidden">
      <div className="absolute inset-0 bg-hero opacity-40" />
      <div className="mx-auto max-w-7xl px-4 relative">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <div className="text-accent text-sm font-medium mb-4">Pre organizátorov</div>
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
              Predaj viac. <br />
              <span className="text-gradient-flame">Stresuj menej.</span>
            </h2>
            <p className="mt-5 text-muted-foreground text-lg max-w-md">
              Predaj vstupeniek, pokladňa, check-in a vyúčtovanie na jednom mieste. Bez mesačných
              poplatkov — platíš 10 % z predanej vstupenky. Pri väčšom objeme sa dohodneme.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                asChild
                className="rounded-xl bg-gradient-flame text-primary-foreground hover:opacity-90 h-12 px-6 shadow-glow"
              >
                <Link to="/onboarding">
                  Chcem predávať vstupenky
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="rounded-xl h-12 px-6 border-border">
                <Link to="/contact">Mám otázku</Link>
              </Button>
            </div>
          </motion.div>

          <div className="grid grid-cols-2 gap-4">
            {features.map((f, i) => (
              <motion.div
                key={f.t}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="glass rounded-2xl p-6"
              >
                <div className="size-10 rounded-xl bg-gradient-flame grid place-items-center mb-4 shadow-glow">
                  <f.icon className="size-5 text-primary-foreground" />
                </div>
                <div className="font-display font-semibold">{f.t}</div>
                <div className="mt-1.5 text-sm text-muted-foreground">{f.d}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
