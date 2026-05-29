import { Ticket, Instagram, Facebook, Youtube, Twitter } from "lucide-react";

const cols = [
  { t: "Platforma", l: ["Podujatia", "Kategórie", "Mestá", "Organizátori", "Blog"] },
  { t: "Spoločnosť", l: ["O nás", "Kariéra", "Tlačové centrum", "Kontakt"] },
  { t: "Právne", l: ["Obchodné podmienky", "Ochrana údajov", "Cookies", "GDPR"] },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface/40 pt-20 pb-10">
      <div className="mx-auto max-w-7xl px-4">
        <div className="grid lg:grid-cols-5 gap-10">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-xl bg-gradient-flame grid place-items-center">
                <Ticket className="size-5 text-primary-foreground" strokeWidth={2.5} />
              </div>
              <span className="font-display text-xl font-bold">
                maxi<span className="text-gradient-flame">ticket</span>
              </span>
            </div>
            <p className="mt-5 text-sm text-muted-foreground max-w-sm">
              Najmodernejšia ticketing platforma na Slovensku. Predávame zážitky od roku 2025.
            </p>
            <div className="mt-6 flex gap-2">
              {[Instagram, Facebook, Youtube, Twitter].map((I, i) => (
                <a key={i} href="#" className="size-10 rounded-xl glass grid place-items-center hover:text-primary transition-colors">
                  <I className="size-4" />
                </a>
              ))}
            </div>
          </div>

          {cols.map((c) => (
            <div key={c.t}>
              <div className="font-display font-semibold mb-4 text-sm">{c.t}</div>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                {c.l.map((i) => (
                  <li key={i}>
                    <a href="#" className="hover:text-foreground transition-colors">{i}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 pt-8 border-t border-border flex flex-col md:flex-row justify-between gap-4 text-xs text-muted-foreground">
          <div>© 2026 MAXITICKET s.r.o. — Všetky práva vyhradené.</div>
          <div>Postavené s vášňou v Bratislave 🇸🇰</div>
        </div>
      </div>
    </footer>
  );
}
