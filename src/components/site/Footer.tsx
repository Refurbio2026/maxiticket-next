import { Link } from "@tanstack/react-router";
import { Ticket, Instagram, Facebook, Youtube, Twitter } from "lucide-react";

type Col = { t: string; l: { label: string; to: string }[] };

const cols: Col[] = [
  {
    t: "Platforma",
    l: [
      { label: "Podujatia", to: "/events" },
      { label: "Umelci", to: "/artists" },
      { label: "Partneri", to: "/partners" },
      { label: "Pre organizátorov", to: "/organizer" },
    ],
  },
  {
    t: "Spoločnosť",
    l: [
      { label: "O nás", to: "/about" },
      { label: "Kontakt", to: "/contact" },
      { label: "Podpora", to: "/support" },
    ],
  },
  {
    t: "Účet",
    l: [
      { label: "Prihlásenie", to: "/login" },
      { label: "Registrácia", to: "/register" },
      { label: "Môj účet", to: "/account" },
    ],
  },
];

const socials: { Icon: typeof Instagram; href: string; label: string }[] = [
  { Icon: Instagram, href: "https://instagram.com/vstupenky", label: "Instagram" },
  { Icon: Facebook, href: "https://facebook.com/vstupenky", label: "Facebook" },
  { Icon: Youtube, href: "https://youtube.com/@vstupenky", label: "YouTube" },
  { Icon: Twitter, href: "https://twitter.com/vstupenky", label: "Twitter" },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface/40 pt-20 pb-10">
      <div className="mx-auto max-w-7xl px-4">
        <div className="grid lg:grid-cols-5 gap-10">
          <div className="lg:col-span-2">
            <Link to="/" className="flex items-center gap-2">
              <div className="size-9 rounded-xl bg-gradient-flame grid place-items-center">
                <Ticket className="size-5 text-primary-foreground" strokeWidth={2.5} />
              </div>
              <span className="font-display text-xl font-bold">
                maxi<span className="text-gradient-flame">ticket</span>
              </span>
            </Link>
            <p className="mt-5 text-sm text-muted-foreground max-w-sm">
              Najmodernejšia ticketing platforma na Slovensku. Predávame zážitky od roku 2025.
            </p>
            <div className="mt-6 flex gap-2">
              {socials.map(({ Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="size-10 rounded-xl glass grid place-items-center hover:text-primary transition-colors"
                >
                  <Icon className="size-4" />
                </a>
              ))}
            </div>
          </div>

          {cols.map((c) => (
            <div key={c.t}>
              <div className="font-display font-semibold mb-4 text-sm">{c.t}</div>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                {c.l.map((i) => (
                  <li key={i.label}>
                    <Link to={i.to} className="hover:text-foreground transition-colors">
                      {i.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 pt-8 border-t border-border flex flex-col md:flex-row justify-between gap-4 text-xs text-muted-foreground">
          <div>© 2026 vstupenky.sk s.r.o. — Všetky práva vyhradené.</div>
          <div>Postavené s vášňou v Bratislave 🇸🇰</div>
        </div>
      </div>
    </footer>
  );
}
