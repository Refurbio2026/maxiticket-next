// Dodacie a platobné podmienky.
//
// Vznikla na výslovnú požiadavku ComGate pri schvaľovaní platby kartou:
// obchod musí mať okrem obchodných podmienok a reklamačného poriadku aj
// samostatne napísané, ako sa platí a ako sa tovar doručuje.
//
// Všetko tu musí sedieť so skutočnosťou aj s obchodnými podmienkami. Keď sa
// zmení spôsob platby alebo doručenia, mení sa to aj tu.
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageShell } from "@/components/site/PageShell";
import { Card } from "@/components/ui/card";
import { CreditCard, Mail, Receipt, ShieldCheck, Clock, Banknote } from "lucide-react";
import { PREVADZKOVATEL } from "@/lib/kontakt";

export const Route = createFileRoute("/doprava-a-platba")({
  head: () => ({
    meta: [
      { title: "Dodanie a platba · eticketo.eu" },
      {
        name: "description",
        content:
          "Ako prebieha platba za vstupenky a ako ich doručujeme. Platobné metódy, doručenie e-mailom, ceny, faktúra a vrátenie vstupného.",
      },
      { property: "og:title", content: "Dodanie a platba · eticketo.eu" },
      {
        property: "og:description",
        content: "Platba kartou alebo prevodom, vstupenka e-mailom hneď po zaplatení.",
      },
    ],
  }),
  component: DopravaAPlatbaPage,
});

function DopravaAPlatbaPage() {
  return (
    <PageShell
      eyebrow="Dodanie a platba"
      title={
        <>
          Ako sa platí a ako <span className="text-gradient-flame">dostaneš vstupenku</span>
        </>
      }
      description="Vstupenky predávame elektronicky. Zaplatíš kartou alebo prevodom a vstupenku dostaneš e-mailom — žiadne poštovné, žiadne čakanie na kuriéra."
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Blok
          ikona={CreditCard}
          nadpis="Spôsoby platby"
          body={[
            "Platobnou kartou — Visa a Mastercard. Platbu spracúva platobná brána, číslo karty sa k nám nedostane.",
            "Bankovým prevodom — dostaneš údaje aj variabilný symbol. Vstupenku vydáme po pripísaní platby na účet.",
            "Platí sa v eurách (EUR).",
          ]}
        />

        <Blok
          ikona={Mail}
          nadpis="Doručenie"
          body={[
            "Vstupenka s QR kódom príde e-mailom na adresu z objednávky, pri platbe kartou do niekoľkých sekúnd.",
            "Nájdeš ju aj po prihlásení v sekcii Moje vstupenky, odkiaľ sa dá kedykoľvek stiahnuť alebo poslať znova.",
            "Doručenie je bezplatné — vstupenky neposielame poštou ani kuriérom, takže neplatíš žiadne poštovné.",
          ]}
        />

        <Blok
          ikona={Clock}
          nadpis="Lehoty"
          body={[
            "Platba kartou: vstupenka okamžite po úspešnej platbe.",
            "Platba prevodom: do 24 hodín od pripísania sumy na účet; podľa banky to býva jeden až dva pracovné dni.",
            "Nezaplatená objednávka po uplynutí lehoty zaniká a sedadlá sa vracajú do predaja.",
          ]}
        />

        <Blok
          ikona={Receipt}
          nadpis="Ceny a doklad"
          body={[
            "Uvedená cena vstupenky je konečná vrátane DPH. Nepripočítavame k nej servisný ani iný poplatok.",
            "Potvrdenie objednávky spolu so vstupenkou slúži ako doklad o kúpe.",
            "Pri nákupe na firmu vystavíme faktúru — stačí v objednávke zadať firemné údaje.",
          ]}
        />

        <Blok
          ikona={Banknote}
          nadpis="Vrátenie vstupného"
          body={[
            "Nákup vstupenky na podujatie nie je možné stornovať ako bežný tovar z e-shopu; pri službách viazaných na dohodnutý termín zákon odstúpenie od zmluvy nedáva (§ 7 ods. 6 zákona č. 102/2014 Z. z.).",
            "Pri zrušení podujatia ťa budeme informovať e-mailom a zverejníme postup vrátenia vstupného vrátane kontaktu, cez ktorý bude prebiehať.",
            "Podrobnosti sú v obchodných podmienkach a v reklamačnom poriadku.",
          ]}
        />

        <Blok
          ikona={ShieldCheck}
          nadpis="Bezpečnosť"
          body={[
            "Celý web beží cez šifrované spojenie (HTTPS).",
            "Platobné údaje zadávaš priamo na stránke platobnej brány, nie u nás.",
            "Každá vstupenka má podpísaný QR kód, ktorý sa pri vchode overuje proti našej databáze.",
          ]}
        />
      </div>

      <Card className="p-6 md:p-8 bg-card/60 border-border/60">
        <h2 className="font-display text-xl font-bold">Prevádzkovateľ</h2>
        <div className="mt-3 text-sm text-muted-foreground space-y-1">
          <p className="text-foreground font-medium">{PREVADZKOVATEL.nazov}</p>
          <p>
            {PREVADZKOVATEL.ulica}, {PREVADZKOVATEL.psc} {PREVADZKOVATEL.mesto},{" "}
            {PREVADZKOVATEL.stat}
          </p>
          <p>IČO {PREVADZKOVATEL.ico}</p>
          <p>{PREVADZKOVATEL.registracia}</p>
          <p>
            E-mail:{" "}
            <a className="text-primary hover:underline" href={`mailto:${PREVADZKOVATEL.email}`}>
              {PREVADZKOVATEL.email}
            </a>{" "}
            · Telefón:{" "}
            <a className="text-primary hover:underline" href={`tel:${PREVADZKOVATEL.telefonLink}`}>
              {PREVADZKOVATEL.telefon}
            </a>
          </p>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Zmluvný vzťah pri kúpe vstupenky vzniká medzi tebou a usporiadateľom podujatia;{" "}
          {PREVADZKOVATEL.nazov} prevádzkuje predajný systém a sprostredkúva platbu. Podrobne to
          popisujú{" "}
          <Link
            className="text-primary hover:underline"
            to="/p/$slug"
            params={{ slug: "obchodne-podmienky" }}
          >
            obchodné podmienky
          </Link>
          .
        </p>
      </Card>
    </PageShell>
  );
}

function Blok({
  ikona: Ikona,
  nadpis,
  body,
}: {
  ikona: typeof CreditCard;
  nadpis: string;
  body: string[];
}) {
  return (
    <Card className="p-6 bg-card/60 border-border/60">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-gradient-flame grid place-items-center shadow-glow shrink-0">
          <Ikona className="size-5 text-primary-foreground" />
        </div>
        <h2 className="font-display text-lg font-semibold">{nadpis}</h2>
      </div>
      <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
        {body.map((t) => (
          <li key={t} className="flex gap-2">
            <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
