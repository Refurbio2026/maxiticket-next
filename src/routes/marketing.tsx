import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell, FeatureGrid } from "@/components/site/PageShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Megaphone, Share2, Mail, Handshake, Tv, Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/marketing")({
  head: () => ({
    meta: [
      { title: "Marketing podujatí · vipky.sk" },
      { name: "description", content: "Reklamné možnosti, sociálne siete, newsletter a partnerské kampane pre organizátorov." },
      { property: "og:title", content: "Marketing podujatí · vipky.sk" },
      { property: "og:description", content: "Propagujte svoje podujatie naprieč Slovenskom." },
    ],
  }),
  component: MarketingPage,
});

function MarketingPage() {
  return (
    <PageShell
      eyebrow="Marketing"
      title={<>Vypredajte sálu skôr, než <span className="text-gradient-flame">otvoríte dvere</span></>}
      description="Propagujte vaše podujatia naprieč vipky.sk sieťou, sociálnymi sieťami, newsletterom a partnerskými kanálmi. Mediálna podpora a kampane na mieru."
      cta={
        <>
          <Button asChild className="bg-gradient-flame text-primary-foreground shadow-glow">
            <Link to="/contact">Kontaktovať marketingový tím <ArrowRight className="size-4 ml-1.5" /></Link>
          </Button>
          <Button asChild variant="outline" className="border-border/60">
            <Link to="/partners">Stať sa partnerom</Link>
          </Button>
        </>
      }
    >
      <FeatureGrid
        items={[
          { icon: Megaphone, title: "Propagácia podujatí", description: "Featured pozície na homepage, v kategóriách a v mestských sekciách." },
          { icon: Share2, title: "Sociálne siete", description: "Promo posty na Instagrame, Facebooku a TikToku v vipky.sk kanáloch." },
          { icon: Mail, title: "Newsletter", description: "Cielené kampane na 120 000+ aktívnych odberateľov podľa miest a žánrov." },
          { icon: Handshake, title: "Partnerské kampane", description: "Cross-promo s ďalšími podujatiami, značkami a mediálnymi partnermi." },
          { icon: Tv, title: "Mediálna podpora", description: "Tlačové správy, rozhlasové spoty a externé PPC kampane." },
          { icon: Sparkles, title: "Kampane na mieru", description: "Strategický plán, kreatíva, A/B testovanie a reporting v reálnom čase." },
        ]}
      />

      <Card className="p-8 md:p-12 bg-card/60 border-border/60 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-flame opacity-5" />
        <div className="relative grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="font-display text-3xl font-bold">Balíky kampaní</h2>
            <p className="text-muted-foreground mt-2">
              Od jednorázovej propagácie po celoročnú spoluprácu. Vyberte si formát, ktorý sedí vašej značke.
            </p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                "Featured banner na homepage",
                "Newsletter zaradenie",
                "Sociálne siete – 3 príspevky",
                "Reporting predaja vstupeniek",
              ].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            {[
              { name: "Štart", price: "od 290 €", desc: "Pre menšie podujatia a kluby." },
              { name: "Rast", price: "od 890 €", desc: "Festival, viacdňové podujatie, séria koncertov." },
              { name: "Premium", price: "od 2 490 €", desc: "Veľké open-air a celoštátne kampane." },
            ].map((p) => (
              <div key={p.name} className="flex items-center justify-between p-4 rounded-xl bg-background/50 border border-border/60">
                <div>
                  <div className="font-display font-bold">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.desc}</div>
                </div>
                <div className="text-primary font-display font-bold">{p.price}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </PageShell>
  );
}
