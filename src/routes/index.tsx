// Titulka.
//
// Sekcie „Hovoria o nás" a „Newsletter" sú zámerne odstránené: prvá mala
// vymyslené referencie (jedna z nich pripísaná Pohoda Festivalu, ktorý u nás
// nikdy nič nepredával), druhá formulár, ktorý e-mail nikam neukladal a
// sľuboval zľavové kódy a early access, ktoré neexistujú. Vrátiť ich možno
// vtedy, keď bude čo zobraziť a kam adresu uložiť.
import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/site/Navbar";
import { Hero } from "@/components/site/Hero";
import { Trending } from "@/components/site/Trending";
import { Categories } from "@/components/site/Categories";
import { Cities } from "@/components/site/Cities";
import { Organizers } from "@/components/site/Organizers";
import { Faq } from "@/components/site/Faq";
import { Footer } from "@/components/site/Footer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "eticketo.eu — Vstupenky na koncerty, festivaly a kultúru" },
      {
        name: "description",
        content:
          "Slovenská platforma na predaj vstupeniek. Koncerty, festivaly, divadlo a kultúra — kúp vstupenku a máš ju okamžite v e-maile aj v účte.",
      },
      { property: "og:title", content: "eticketo.eu — Každý zážitok má svoj vstup" },
      {
        property: "og:description",
        content: "Vstupenky na koncerty, festivaly, divadlo a kultúru. Cena vstupenky je konečná.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main>
        <Hero />
        <Trending />
        <Categories />
        <Cities />
        <Organizers />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
