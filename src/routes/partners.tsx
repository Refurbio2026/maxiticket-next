// Spolupráca.
//
// Čo tu bolo predtým a prečo to je dole: affiliate program („až 8 % provízia,
// mesačné výplaty, dedikovaný manažér") — nič z toho neexistuje, ani
// sledovanie odkazov; sponzoring a mediálne kampane — nemáme ich v ponuke;
// a štyri čísla v rámčeku („450+ organizátorov, 8 200+ podujatí ročne,
// 1,2 M+ vstupeniek, 98 % spokojnosť partnerov"), ktoré boli vymyslené.
//
// Stránka teraz ponúka dve veci, ktoré naozaj vieme: predaj vstupeniek pre
// organizátorov a rozhovor o čomkoľvek ďalšom. Keď pribudne program so
// skutočnými podmienkami, pribudne sem s nimi.
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell, FeatureGrid } from "@/components/site/PageShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Building2, Code2, Store, QrCode, Handshake, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/partners")({
  head: () => ({
    meta: [
      { title: "Spolupráca · eticketo.eu" },
      {
        name: "description",
        content:
          "Predaj vstupeniek pre organizátorov podujatí — pokladňa, check-in a vyúčtovanie. Alebo nám napíšte s návrhom na spoluprácu.",
      },
      { property: "og:title", content: "Spolupráca · eticketo.eu" },
      { property: "og:description", content: "Predávajte vstupenky cez eticketo.eu." },
    ],
  }),
  component: PartnersPage,
});

function PartnersPage() {
  return (
    <PageShell
      eyebrow="Spolupráca"
      title={
        <>
          Predávajte vstupenky <span className="text-gradient-flame">s nami</span>
        </>
      }
      description="Sme slovenská platforma na predaj vstupeniek. Organizátorom dáme predaj online aj na mieste, check-in pri vchode a vyúčtovanie po podujatí."
      cta={
        <>
          <Button asChild className="bg-gradient-flame text-primary-foreground shadow-glow">
            <Link to="/onboarding">
              Chcem predávať vstupenky <ArrowRight className="size-4 ml-1.5" />
            </Link>
          </Button>
          <Button asChild variant="outline" className="border-border/60">
            <Link to="/contact">Napísať nám</Link>
          </Button>
        </>
      }
    >
      <FeatureGrid
        items={[
          {
            icon: Building2,
            title: "Predaj online",
            description:
              "Podujatie, cenové kategórie aj rozsadenie si nastavíš sám. Vstupenka s QR kódom odchádza kupujúcemu okamžite po zaplatení.",
          },
          {
            icon: Store,
            title: "Pokladňa na mieste",
            description:
              "Predaj pri vchode aj v hotovosti, s pokladníkmi, prehľadom predaja a uzávierkou zmeny.",
          },
          {
            icon: QrCode,
            title: "Check-in pri vchode",
            description:
              "Vstupenky overíš skenom v telefóne, aj keď na mieste vypadne signál. Dvojité použitie kódu systém nepustí.",
          },
          {
            icon: Code2,
            title: "Predaj na vlastnom webe",
            description:
              "Vlož na svoju stránku jeden riadok kódu a predávaj priamo tam. Okrem toho dostaneš vlastnú verejnú stránku so všetkými svojimi podujatiami.",
          },
        ]}
      />

      <Card className="p-8 bg-card/60 border-border/60">
        <div className="flex items-start gap-4">
          <div className="size-11 rounded-xl bg-gradient-flame grid place-items-center shadow-glow shrink-0">
            <Handshake className="size-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-bold">Máte iný návrh?</h2>
            <p className="text-muted-foreground max-w-2xl mt-2">
              Zastupujete kultúrne centrum, sieť podujatí alebo chcete vstupenky prepojiť s vlastným
              systémom? Napíšte nám, čo potrebujete — ozveme sa a povieme priamo, čo z toho vieme
              dnes a čo nie.
            </p>
            <Button asChild className="mt-5 bg-gradient-flame text-primary-foreground shadow-glow">
              <Link to="/contact">Napísať nám</Link>
            </Button>
          </div>
        </div>
      </Card>
    </PageShell>
  );
}
