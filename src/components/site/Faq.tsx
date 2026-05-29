import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  { q: "Ako rýchlo dostanem vstupenku?", a: "Vstupenku s QR kódom dostaneš okamžite na email, do Apple/Google Walletky a do svojho účtu." },
  { q: "Sú vstupenky prenosné?", a: "Áno. Vstupenku môžeš jedným klikom poslať kamarátovi — QR kód sa automaticky preregistruje." },
  { q: "Aké sú poplatky pre organizátorov?", a: "Iba 4% z predanej vstupenky. Žiadne mesačné poplatky, žiadne skryté náklady." },
  { q: "Čo ak sa podujatie zruší?", a: "Plnú sumu vraciame automaticky na tvoju kartu do 5 pracovných dní." },
  { q: "Funguje to aj v zahraničí?", a: "Predávame vstupenky po celom Slovensku a postupne rozširujeme na CEE región." },
];

export function Faq() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-3xl px-4">
        <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-center">
          Časté <span className="text-gradient-flame">otázky</span>
        </h2>
        <p className="mt-3 text-center text-muted-foreground">Všetko, čo potrebuješ vedieť pred prvým nákupom.</p>

        <Accordion type="single" collapsible className="mt-12 space-y-3">
          {faqs.map((f, i) => (
            <AccordionItem
              key={i}
              value={`item-${i}`}
              className="glass rounded-2xl px-6 border-0"
            >
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
