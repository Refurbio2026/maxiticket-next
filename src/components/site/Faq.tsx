import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/**
 * Časté otázky.
 *
 * KAŽDÁ ODPOVEĎ MUSÍ BYŤ PRAVDA DNES. Predtým tu stálo, že vstupenku
 * dostaneš do Apple/Google peňaženky (certifikát ešte nie je nasadený), že ju
 * „jedným klikom pošleš kamarátovi a QR sa preregistruje" (taká funkcia
 * neexistuje), že provízia je 4 % (v `platform_settings` je 10 %) a že pri
 * zrušení vraciame peniaze automaticky do 5 dní — čo si protirečí s bodom
 * 3.7 obchodných podmienok. Keď niečo pribudne, pribudne aj tu; nie naopak.
 */
const faqs = [
  {
    q: "Ako rýchlo dostanem vstupenku?",
    a: "Okamžite po zaplatení. Vstupenku s QR kódom pošleme na email a nájdeš ju aj vo svojom účte v sekcii Moje vstupenky. Stačí ju mať pri vchode v telefóne, tlačiť ju netreba.",
  },
  {
    q: "Čo ak na podujatie nemôžem prísť?",
    a: "Vstupenku môžeš poslať ďalej — pri vchode platí QR kód, nie meno, takže ju využije ten, komu ju pošleš. Pri vstupenkách vydaných na konkrétne meno to treba dohodnúť s usporiadateľom. Peniaze za nevyužitú vstupenku vrátiť nedokážeme, nákup vstupenky nie je zo zákona možné stornovať ako bežný e-shopový tovar.",
  },
  {
    q: "Aké sú poplatky pre organizátorov?",
    a: "Štandardne 10 % z ceny predanej vstupenky. Žiadne mesačné poplatky ani platba za zriadenie. Pri väčšom objeme sa dohodneme individuálne — napíš nám.",
  },
  {
    q: "Čo ak sa podujatie zruší?",
    a: "Dáme ti vedieť emailom a zverejníme postup vrátenia vstupného vrátane kontaktu, cez ktorý bude prebiehať. Podrobne to popisuje bod 3.7 obchodných podmienok.",
  },
  {
    q: "Akými spôsobmi sa dá zaplatiť?",
    a: "Platobnou kartou alebo bankovým prevodom cez platobnú bránu. Pri prevode je vstupenka vydaná až po pripísaní platby, takže kartou ju máš hneď.",
  },
  {
    q: "Dostanem faktúru?",
    a: "Pri nákupe na firmu áno — stačí v objednávke zadať firemné údaje (IČO si vieme dotiahnuť z registra) a faktúru pošleme emailom. Fyzickým osobám faktúru nevystavujeme, dokladom je potvrdenie objednávky.",
  },
  {
    q: "Funguje to aj v zahraničí?",
    a: "Vstupenky kúpiš odkiaľkoľvek. Podujatia, ktoré teraz predávame, sú na Slovensku.",
  },
];

export function Faq() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-3xl px-4">
        <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-center">
          Časté <span className="text-gradient-flame">otázky</span>
        </h2>
        <p className="mt-3 text-center text-muted-foreground">
          Všetko, čo potrebuješ vedieť pred prvým nákupom.
        </p>

        <Accordion type="single" collapsible className="mt-12 space-y-3">
          {faqs.map((f, i) => (
            <AccordionItem key={i} value={`item-${i}`} className="glass rounded-2xl px-6 border-0">
              <AccordionTrigger className="text-left font-display font-semibold hover:no-underline">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
