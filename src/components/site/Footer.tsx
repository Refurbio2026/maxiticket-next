import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listFooterPages } from "@/lib/site-pages.functions";
import { useI18n } from "@/hooks/use-i18n";
import { Wordmark } from "@/components/site/Wordmark";
import { PREVADZKOVATEL, identifikaciaJedenRiadok } from "@/lib/kontakt";

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
      { labelKey: "nav.contact", to: "/contact" },
      { labelKey: "nav.support", to: "/support" },
      { labelKey: "footer.payments", to: "/doprava-a-platba" },
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

export function Footer() {
  const { t } = useI18n();

  // Obsahové stránky (O nás, obchodné podmienky…) sa v pätičke objavia až keď
  // sú naozaj napísané a publikované — inak by odkazovala do prázdna.
  const fetchPages = useServerFn(listFooterPages);
  const { data: pages = [] } = useQuery({
    queryKey: ["footer-pages"],
    queryFn: () => fetchPages({ data: undefined as never }),
  });

  return (
    <footer className="border-t border-border bg-surface/40 pt-20 pb-10">
      <div className="mx-auto max-w-7xl px-4">
        <div className="grid lg:grid-cols-5 gap-10">
          <div className="lg:col-span-2">
            <Link to="/" className="flex items-center gap-2">
              <Wordmark />
            </Link>

            <p className="mt-5 text-sm text-muted-foreground max-w-sm">{t("footer.tagline")}</p>
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
                {/* Obsahové stránky patria pod „Spoločnosť". */}
                {c.titleKey === "footer.company" &&
                  pages.map((p) => (
                    <li key={p.slug}>
                      <Link
                        to="/p/$slug"
                        params={{ slug: p.slug }}
                        className="hover:text-foreground transition-colors"
                      >
                        {p.title}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>

        {/*
          Identifikácia prevádzkovateľa vrátane kontaktov patrí na každú
          stránku, nielen do podmienok — vyžaduje to aj platobná brána pri
          schvaľovaní platby kartou.
        */}
        <div className="mt-16 pt-8 border-t border-border space-y-3 text-xs text-muted-foreground">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:gap-2">
            <span>
              {t("footer.operator")}: {identifikaciaJedenRiadok()}
            </span>
            <span className="hidden md:inline">·</span>
            <span className="flex flex-wrap gap-x-2">
              <a className="hover:text-foreground" href={`mailto:${PREVADZKOVATEL.email}`}>
                {PREVADZKOVATEL.email}
              </a>
              <span>·</span>
              <a className="hover:text-foreground" href={`tel:${PREVADZKOVATEL.telefonLink}`}>
                {PREVADZKOVATEL.telefon}
              </a>
            </span>
          </div>
          <div className="flex flex-col md:flex-row justify-between gap-2">
            <div>{t("footer.rights")}</div>
            <div>{t("footer.builtWith")}</div>
          </div>
        </div>
      </div>
    </footer>
  );
}
