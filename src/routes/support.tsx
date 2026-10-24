import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageShell } from "@/components/site/PageShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Search,
  Ticket,
  RefreshCcw,
  ShieldQuestion,
  CreditCard,
  LifeBuoy,
  Phone,
} from "lucide-react";
import { PREVADZKOVATEL } from "@/lib/kontakt";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Podpora · eticketo.eu" },
      {
        name: "description",
        content: "FAQ, reklamácie, refundácie a technická podpora pre kupujúcich aj organizátorov.",
      },
      { property: "og:title", content: "Podpora · eticketo.eu" },
      { property: "og:description", content: "Pomoc s nákupom vstupeniek a technická podpora." },
    ],
  }),
  component: SupportPage,
});

/**
 * Odpovede pre kupujúcich.
 *
 * Predtým tu stálo, že v účte je tlačidlo „Požiadať o refundáciu" (nie je),
 * že pri zrušení chodí automatické 100 % vrátenie (podmienky, bod 3.7, to
 * popisujú inak), že berieme Apple Pay / Google Pay / Tatra Pay (nasadená je
 * brána ComGate — karta a bankový prevod) a mailovalo sa na
 * `support@eticketo.eu`, čo nie je naša adresa. Správna je
 * `PREVADZKOVATEL.email`.
 */
const FAQ = [
  {
    cat: "Vstupenky",
    q: "Ako dostanem vstupenku po nákupe?",
    a: "Hneď po zaplatení vám príde e-mailom vstupenka s QR kódom. Nájdete ju aj vo svojom účte v sekcii Moje vstupenky. Pri vchode stačí ukázať QR kód v telefóne.",
  },
  {
    cat: "Vstupenky",
    q: "Môžem vstupenku preniesť na inú osobu?",
    a: "Áno, stačí ju preposlať — pri vchode platí QR kód, nie meno, a platný je pre toho, kto ho použije prvý. Pri vstupenkách vydaných na konkrétne meno to treba dohodnúť s usporiadateľom.",
  },
  {
    cat: "Platba",
    q: "Aké spôsoby platby podporujete?",
    a: "Platobnou kartou (Visa, Mastercard) a bankovým prevodom cez platobnú bránu. Pri prevode vydáme vstupenku až po pripísaní platby, kartou ju máte okamžite.",
  },
  {
    cat: "Refundácie",
    q: "Môžem vstupenku vrátiť, keď nemôžem prísť?",
    a: "Nákup vstupenky na podujatie nie je možné stornovať ako bežný tovar z e-shopu (§ 7 ods. 6 zákona č. 102/2014 Z. z. — služby v rámci voľného času na dohodnutý termín), takže peniaze za nevyužitú vstupenku vrátiť nedokážeme. Vstupenku ale môžete poslať ďalej, pozri otázku o prenose.",
  },
  {
    cat: "Reklamácie",
    q: "Podujatie bolo zrušené, čo teraz?",
    a: "Dáme vám vedieť e-mailom a zverejníme postup vrátenia vstupného vrátane kontaktu, cez ktorý bude prebiehať. Presne to popisuje bod 3.7 obchodných podmienok.",
  },
  {
    cat: "Vstupenky",
    q: "Dostanem faktúru?",
    a: "Pri nákupe na firmu áno — v objednávke zadajte firemné údaje a faktúru pošleme e-mailom. Fyzickým osobám faktúru nevystavujeme, dokladom je potvrdenie objednávky.",
  },
  {
    cat: "Technické",
    q: "Nefunguje mi QR kód pri vstupe.",
    a: `Oslovte personál na vstupe alebo nám napíšte na ${PREVADZKOVATEL.email} — overíme vás podľa e-mailu z objednávky.`,
  },
];

function SupportPage() {
  const [q, setQ] = useState("");
  const list = useMemo(
    () => FAQ.filter((f) => (f.q + f.a).toLowerCase().includes(q.toLowerCase())),
    [q],
  );
  return (
    <PageShell
      eyebrow="Podpora"
      title={
        <>
          Sme tu, keď nás <span className="text-gradient-flame">potrebujete</span>
        </>
      }
      description="Vyhľadajte odpovede v znalostnej báze alebo nás kontaktujte. Pomoc s nákupom, refundáciami aj technickými otázkami."
      cta={
        <Button asChild className="bg-gradient-flame text-primary-foreground shadow-glow">
          <Link to="/contact">Kontaktovať podporu</Link>
        </Button>
      }
    >
      <div>
        <div className="relative max-w-2xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
          <Input
            placeholder="Vyhľadať v znalostnej báze… (napr. refundácia, QR kód)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-14 pl-12 text-base bg-card/60 border-border/60"
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: Ticket, t: "Vstupenky", d: "Doručenie, prenos, formát" },
          { icon: RefreshCcw, t: "Refundácie", d: "Kedy vraciame vstupné" },
          { icon: ShieldQuestion, t: "Reklamácie", d: "Zrušené a presunuté podujatia" },
          { icon: CreditCard, t: "Platby", d: "Karta a bankový prevod" },
        ].map((c) => {
          const Icon = c.icon;
          return (
            <Card
              key={c.t}
              className="p-5 bg-card/60 border-border/60 hover:border-primary/50 transition-colors"
            >
              <div className="size-10 rounded-xl bg-primary/15 text-primary grid place-items-center mb-3">
                <Icon className="size-5" />
              </div>
              <div className="font-display font-bold">{c.t}</div>
              <p className="text-xs text-muted-foreground mt-1">{c.d}</p>
            </Card>
          );
        })}
      </div>

      <Card className="p-6 md:p-8 bg-card/60 border-border/60">
        <h2 className="font-display text-2xl font-bold mb-4">Často kladené otázky</h2>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žiadne výsledky pre „{q}".</p>
        ) : (
          <Accordion type="single" collapsible className="w-full">
            {list.map((f, i) => (
              <AccordionItem key={i} value={`i${i}`} className="border-border/60">
                <AccordionTrigger className="text-left hover:no-underline">
                  <div className="flex items-start gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-primary mt-1">
                      {f.cat}
                    </span>
                    <span className="font-medium">{f.q}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground pl-[72px]">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-6 bg-card/60 border-border/60 flex items-start gap-4">
          <div className="size-11 rounded-xl bg-gradient-flame grid place-items-center shadow-glow shrink-0">
            <LifeBuoy className="size-5 text-primary-foreground" />
          </div>
          <div>
            <div className="font-display font-bold">Napíšte nám</div>
            <p className="text-sm text-muted-foreground mt-1">
              Odpovedáme v pracovných dňoch. Priložte prosím e-mail z objednávky.
            </p>
            <a
              href={`mailto:${PREVADZKOVATEL.email}`}
              className="text-primary text-sm font-semibold hover:underline mt-2 inline-block"
            >
              {PREVADZKOVATEL.email}
            </a>
          </div>
        </Card>
        <Card className="p-6 bg-card/60 border-border/60 flex items-start gap-4">
          <div className="size-11 rounded-xl bg-gradient-flame grid place-items-center shadow-glow shrink-0">
            <Phone className="size-5 text-primary-foreground" />
          </div>
          <div>
            <div className="font-display font-bold">Zavolajte</div>
            <p className="text-sm text-muted-foreground mt-1">
              Keď to potrebujete vyriešiť hneď — napríklad pri vstupe na podujatie.
            </p>
            <a
              href={`tel:${PREVADZKOVATEL.telefonLink}`}
              className="text-primary text-sm font-semibold hover:underline mt-2 inline-block"
            >
              {PREVADZKOVATEL.telefon}
            </a>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
