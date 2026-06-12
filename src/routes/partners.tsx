import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell, FeatureGrid } from "@/components/site/PageShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Building2, Users, Handshake, Trophy, Tv2, BadgePercent, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/partners")({
  head: () => ({
    meta: [
      { title: "Spolupráca · vstupenky.sk" },
      { name: "description", content: "Pre organizátorov, partnerov, affiliate program, sponzoring a mediálnu spoluprácu." },
      { property: "og:title", content: "Spolupráca · vstupenky.sk" },
      { property: "og:description", content: "Staňte sa partnerom vstupenky.sk." },
    ],
  }),
  component: PartnersPage,
});

function PartnersPage() {
  return (
    <PageShell
      eyebrow="Spolupráca"
      title={<>Rastieme <span className="text-gradient-flame">spoločne</span></>}
      description="Pridajte sa k vstupenky.sk ekosystému – organizátori, partneri, affiliate tvorcovia, sponzori a mediálne značky. Profitujeme všetci."
      cta={
        <>
          <Button asChild className="bg-gradient-flame text-primary-foreground shadow-glow">
            <Link to="/contact">Stať sa partnerom <ArrowRight className="size-4 ml-1.5" /></Link>
          </Button>
          <Button asChild variant="outline" className="border-border/60">
            <Link to="/login" search={{ section: "organizer" }}>Som organizátor</Link>
          </Button>
        </>
      }
    >
      <FeatureGrid
        items={[
          { icon: Building2, title: "Pre organizátorov", description: "Kompletný nástroj na predaj vstupeniek, marketing, POS a vyúčtovanie." },
          { icon: Handshake, title: "Pre partnerov", description: "Integrácie, B2B ponuky a dlhodobá spolupráca s ticketing lídrom." },
          { icon: BadgePercent, title: "Affiliate program", description: "Zarábajte províziu z každej predanej vstupenky cez váš odkaz alebo kód." },
          { icon: Trophy, title: "Sponzoring", description: "Brandujte podujatia, festivaly a aktivity podľa svojej cieľovej skupiny." },
          { icon: Tv2, title: "Mediálni partneri", description: "Cross-promo, výmena dosahu a exkluzívne mediálne kampane." },
          { icon: Users, title: "Komunita", description: "Spoločné eventy, networking a školenia pre celý ekosystém." },
        ]}
      />

      <Card className="p-8 md:p-12 bg-card/60 border-border/60 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-flame opacity-5" />
        <div className="relative grid md:grid-cols-4 gap-6 text-center">
          {[
            { n: "450+", l: "aktívnych organizátorov" },
            { n: "8 200+", l: "podujatí ročne" },
            { n: "1,2 M+", l: "predaných vstupeniek" },
            { n: "98 %", l: "spokojnosť partnerov" },
          ].map((s) => (
            <div key={s.l}>
              <div className="font-display text-4xl font-bold text-gradient-flame">{s.n}</div>
              <div className="text-sm text-muted-foreground mt-1">{s.l}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-8 bg-card/60 border-border/60">
        <h2 className="font-display text-2xl font-bold mb-2">Affiliate program</h2>
        <p className="text-muted-foreground max-w-2xl">
          Zdieľajte podujatia a získajte províziu z každej predanej vstupenky. Sledovanie v reálnom čase,
          mesačné výplaty a podpora vlastných promo kódov.
        </p>
        <ul className="grid sm:grid-cols-3 gap-3 mt-5 text-sm">
          {[
            "Až 8 % provízia",
            "Real-time dashboard",
            "Vlastný promo kód",
            "Marketingové materiály",
            "Mesačné výplaty",
            "Dedikovaný manažér",
          ].map((t) => (
            <li key={t} className="flex items-center gap-2 p-3 rounded-lg bg-background/40 border border-border/40">
              <span className="size-1.5 rounded-full bg-primary" /> {t}
            </li>
          ))}
        </ul>
        <Button asChild className="mt-6 bg-gradient-flame text-primary-foreground shadow-glow">
          <Link to="/contact">Prihlásiť sa do affiliate programu</Link>
        </Button>
      </Card>
    </PageShell>
  );
}
