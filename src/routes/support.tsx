import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageShell } from "@/components/site/PageShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Search, Ticket, RefreshCcw, ShieldQuestion, CreditCard, LifeBuoy, MessageCircle } from "lucide-react";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Podpora · MAXITICKET" },
      { name: "description", content: "FAQ, reklamácie, refundácie a technická podpora pre kupujúcich aj organizátorov." },
      { property: "og:title", content: "Podpora · MAXITICKET" },
      { property: "og:description", content: "Pomoc s nákupom vstupeniek a technická podpora." },
    ],
  }),
  component: SupportPage,
});

const FAQ = [
  { cat: "Vstupenky", q: "Ako dostanem vstupenku po nákupe?", a: "Vstupenka vám príde okamžite e-mailom v PDF formáte aj s QR kódom. Nájdete ju aj vo svojom účte v sekcii Moje vstupenky." },
  { cat: "Refundácie", q: "Ako požiadam o refundáciu?", a: "V účte otvorte detail objednávky a kliknite na 'Požiadať o refundáciu'. Spracovanie trvá 3–5 pracovných dní." },
  { cat: "Reklamácie", q: "Podujatie bolo zrušené, čo teraz?", a: "Pri zrušení podujatia organizátorom dostanete automatický e-mail a 100 % vrátenie peňazí na pôvodný spôsob platby." },
  { cat: "Platba", q: "Aké spôsoby platby podporujete?", a: "Akceptujeme platobné karty (Visa, Mastercard), Apple Pay, Google Pay, Tatra Pay a bankový prevod." },
  { cat: "Vstupenky", q: "Môžem vstupenku preniesť na inú osobu?", a: "Áno, vstupenku môžete preposlať e-mailom – QR kód je platný pre prvého návštevníka, ktorý ho použije." },
  { cat: "Technické", q: "Nefunguje mi QR kód pri vstupe.", a: "Kontaktujte personál na vstupe alebo nás napíšte na support@maxiticket.sk – overíme vás podľa e-mailu objednávky." },
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
      title={<>Sme tu, keď nás <span className="text-gradient-flame">potrebujete</span></>}
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
          { icon: RefreshCcw, t: "Refundácie", d: "Žiadosti a stav spracovania" },
          { icon: ShieldQuestion, t: "Reklamácie", d: "Zrušené a presunuté podujatia" },
          { icon: CreditCard, t: "Platby", d: "Karty, Apple Pay, prevod" },
        ].map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.t} className="p-5 bg-card/60 border-border/60 hover:border-primary/50 transition-colors">
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
                    <span className="text-[10px] font-bold uppercase tracking-widest text-primary mt-1">{f.cat}</span>
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
            <div className="font-display font-bold">Technická podpora</div>
            <p className="text-sm text-muted-foreground mt-1">Po–Pi 9:00–18:00, víkendy 12:00–22:00 počas podujatí.</p>
            <a href="mailto:support@maxiticket.sk" className="text-primary text-sm font-semibold hover:underline mt-2 inline-block">
              support@maxiticket.sk
            </a>
          </div>
        </Card>
        <Card className="p-6 bg-card/60 border-border/60 flex items-start gap-4">
          <div className="size-11 rounded-xl bg-gradient-flame grid place-items-center shadow-glow shrink-0">
            <MessageCircle className="size-5 text-primary-foreground" />
          </div>
          <div>
            <div className="font-display font-bold">Live chat</div>
            <p className="text-sm text-muted-foreground mt-1">Odpovedáme do 5 minút v pracovných hodinách.</p>
            <Button asChild variant="link" className="p-0 h-auto text-primary font-semibold mt-2">
              <Link to="/contact">Otvoriť chat →</Link>
            </Button>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
