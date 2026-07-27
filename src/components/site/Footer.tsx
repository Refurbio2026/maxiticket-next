import { Link } from "@tanstack/react-router";
import { Instagram, Facebook, Youtube, Twitter } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import logo from "@/assets/logo.png";

type Col = { titleKey: string; l: { labelKey: string; to: string }[] };

const cols: Col[] = [
  {
    titleKey: "footer.platform",
    l: [
      { labelKey: "nav.events", to: "/events" },
      { labelKey: "nav.artists", to: "/artists" },
      { labelKey: "footer.partners", to: "/partners" },
      { labelKey: "footer.forOrganizers", to: "/organizer" },
    ],
  },
  {
    titleKey: "footer.company",
    l: [
      { labelKey: "footer.about", to: "/about" },
      { labelKey: "nav.contact", to: "/contact" },
      { labelKey: "nav.support", to: "/support" },
    ],
  },
  {
    titleKey: "footer.account",
    l: [
      { labelKey: "footer.login", to: "/login" },
      { labelKey: "footer.register", to: "/register" },
      { labelKey: "footer.myAccount", to: "/account" },
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
  const { t } = useI18n();

  return (
    <footer className="border-t border-border bg-surface/40 pt-20 pb-10">
      <div className="mx-auto max-w-7xl px-4">
        <div className="grid lg:grid-cols-5 gap-10">
          <div className="lg:col-span-2">
            <Link to="/" className="flex items-center gap-2">
              <img src={logo} alt="vstupenky.sk" className="h-9 w-auto dark:invert" />
            </Link>

            <p className="mt-5 text-sm text-muted-foreground max-w-sm">{t("footer.tagline")}</p>
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
            <div key={c.titleKey}>
              <div className="font-display font-semibold mb-4 text-sm">{t(c.titleKey)}</div>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                {c.l.map((i) => (
                  <li key={i.labelKey}>
                    <Link to={i.to} className="hover:text-foreground transition-colors">
                      {t(i.labelKey)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 pt-8 border-t border-border flex flex-col md:flex-row justify-between gap-4 text-xs text-muted-foreground">
          <div>{t("footer.rights")}</div>
          <div>{t("footer.builtWith")}</div>
        </div>
      </div>
    </footer>
  );
}
