// Verejný profil organizátora na /o/<subdomain>.
//
// Organizátorovi dáva jednu adresu, ktorú si dá do bia a na plagát, a nám
// stránku, na ktorej sú len jeho podujatia. Je to tá istá hodnota ako jeho
// subdoména (`profiles.subdomain`), takže po zavedení zástupného DNS záznamu
// a wildcard certifikátu bude `bbd.eticketo.eu` ukazovať to isté, čo dnes
// `eticketo.eu/o/bbd` — a rozposlané odkazy ostanú v platnosti.
//
// Neschválený ani skrytý organizátor tu neexistuje: server ho nevráti (pozri
// pohľad `public_organizers`), takže sa nedá nájsť ani uhádnutím adresy.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Calendar,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  ShieldQuestion,
  UserX,
} from "lucide-react";

import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getPublicOrganizer } from "@/lib/organizers-public.functions";
import { LINK_PLATFORMS } from "@/lib/organizer-profile";

export const Route = createFileRoute("/o/$subdomena")({
  head: () => ({ meta: [{ title: "Organizátor · eticketo.eu" }] }),
  component: Page,
});

const NAZOV_PLATFORMY = new Map(LINK_PLATFORMS.map((p) => [p.key as string, p.label]));

function Page() {
  const { subdomena } = Route.useParams();
  const fetchProfil = useServerFn(getPublicOrganizer);

  const q = useQuery({
    queryKey: ["public-organizer", subdomena],
    queryFn: () => fetchProfil({ data: { subdomena } }),
  });

  if (q.isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="grid h-[60vh] place-items-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
        <Footer />
      </div>
    );
  }

  if (!q.data) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <main className="mx-auto max-w-3xl px-4 pt-40 pb-20">
          <Card className="p-12 text-center bg-card/60 border-dashed border-border/60">
            <UserX className="mx-auto mb-3 size-7 text-muted-foreground" />
            <h1 className="font-display text-2xl font-bold">Organizátor sa nenašiel</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Táto adresa neexistuje alebo profil ešte nie je zverejnený.
            </p>
            <Button asChild className="mt-6 bg-gradient-flame text-primary-foreground shadow-glow">
              <Link to="/events">Pozrieť všetky podujatia</Link>
            </Button>
          </Card>
        </main>
        <Footer />
      </div>
    );
  }

  const { organizer: o, links, upcoming, past_count } = q.data;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      {/* Hlavička s titulným obrázkom; bez neho ostane farebný podklad. */}
      <section className="relative pt-32">
        <div
          className="h-48 w-full bg-hero noise bg-cover bg-center md:h-64"
          style={o.cover_url ? { backgroundImage: `url(${o.cover_url})` } : undefined}
        />
        <div className="mx-auto max-w-7xl px-4">
          <div className="-mt-12 flex flex-wrap items-end gap-5">
            <div className="size-24 shrink-0 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-glow">
              {o.logo_url ? (
                <img src={o.logo_url} alt="" className="size-full object-cover" />
              ) : (
                <div className="grid size-full place-items-center font-display text-2xl font-bold text-muted-foreground">
                  {o.display_name.slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">
                {o.display_name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {o.city ? `${o.city} · ` : ""}
                {upcoming.length > 0
                  ? `${upcoming.length} ${upcoming.length === 1 ? "najbližšie podujatie" : "najbližších podujatí"}`
                  : "zatiaľ bez vypísaných podujatí"}
                {past_count > 0 ? ` · ${past_count} odohraných` : ""}
              </p>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl space-y-12 px-4 py-12">
        {(o.bio || o.website || links.length > 0) && (
          <section className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            {o.bio && (
              <Card className="p-6 bg-card/60 border-border/50">
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-foreground/80">
                  {o.bio}
                </p>
              </Card>
            )}
            {(o.website || links.length > 0) && (
              <Card className="p-6 bg-card/60 border-border/50">
                <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Kde nás nájdeš
                </h2>
                <ul className="mt-3 space-y-2 text-sm">
                  {o.website && (
                    <li>
                      <a
                        className="inline-flex items-center gap-2 text-primary hover:underline"
                        href={o.website}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        <Globe className="size-3.5" /> {o.website.replace(/^https?:\/\//, "")}
                      </a>
                    </li>
                  )}
                  {links.map((l) => (
                    <li key={l.platform}>
                      <a
                        className="inline-flex items-center gap-2 text-primary hover:underline"
                        href={l.url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        <ExternalLink className="size-3.5" />
                        {NAZOV_PLATFORMY.get(l.platform) ?? l.platform}
                      </a>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        )}

        <section className="space-y-5">
          <h2 className="font-display text-2xl font-bold tracking-tight">Najbližšie podujatia</h2>
          {upcoming.length === 0 ? (
            <Card className="p-10 text-center bg-card/60 border-dashed border-border/60">
              <p className="text-sm text-muted-foreground">
                Práve teraz nie je v predaji žiadne podujatie. Pozri si{" "}
                <Link to="/events" className="text-primary hover:underline">
                  celú ponuku
                </Link>
                .
              </p>
            </Card>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {upcoming.map((e) => (
                <Card
                  key={e.id}
                  className="group overflow-hidden bg-card/60 border-border/50 transition hover:border-primary/40 hover:shadow-glow"
                >
                  <Link
                    to="/events/$id"
                    params={{ id: e.id }}
                    className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <div
                      className="aspect-video bg-muted bg-cover bg-center transition-transform group-hover:scale-[1.02]"
                      style={e.image_url ? { backgroundImage: `url(${e.image_url})` } : undefined}
                    />
                    <div className="space-y-2 p-5">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                        {e.category}
                      </span>
                      <h3 className="font-display text-lg font-semibold leading-tight">
                        {e.title}
                      </h3>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="size-3.5" /> {e.event_date} · {e.event_time}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="size-3.5" /> {e.venue}, {e.city}
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <div className="text-sm">
                          {e.base_price !== null && (
                            <>
                              <span className="text-muted-foreground">od </span>
                              <span className="font-display text-base font-bold">
                                €{e.base_price.toFixed(2)}
                              </span>
                            </>
                          )}
                        </div>
                        <span
                          className={cn(
                            buttonVariants({ size: "sm" }),
                            "bg-gradient-flame text-primary-foreground shadow-glow",
                          )}
                        >
                          Kúpiť vstupenky
                        </span>
                      </div>
                    </div>
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Storno podmienky a reklamačný kontakt sú povinná informácia pri predaji
            na diaľku — preto sú na profile, nie schované vo VOP platformy. */}
        {(o.cancellation_policy || o.complaint_contact || o.company_name) && (
          <section>
            <Card className="p-6 bg-card/60 border-border/50 space-y-4">
              <div className="flex items-center gap-2">
                <ShieldQuestion className="size-4 text-muted-foreground" />
                <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Nákup a reklamácie
                </h2>
              </div>
              {o.cancellation_policy && (
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/80">
                  {o.cancellation_policy}
                </p>
              )}
              <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                {o.company_name && (
                  <div>
                    Organizátor: <span className="text-foreground">{o.company_name}</span>
                    {o.ico ? `, IČO ${o.ico}` : ""}
                  </div>
                )}
                {o.complaint_contact && (
                  <div>
                    Reklamácie: <span className="text-foreground">{o.complaint_contact}</span>
                  </div>
                )}
              </div>
            </Card>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
