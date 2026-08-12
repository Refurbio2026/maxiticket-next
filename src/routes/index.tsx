import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/site/Navbar";
import { Hero } from "@/components/site/Hero";
import { Trending } from "@/components/site/Trending";
import { Categories } from "@/components/site/Categories";
import { Cities } from "@/components/site/Cities";
import { Organizers } from "@/components/site/Organizers";
import { Testimonials } from "@/components/site/Testimonials";
import { Faq } from "@/components/site/Faq";
import { Newsletter } from "@/components/site/Newsletter";
import { Footer } from "@/components/site/Footer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "vipky.sk — Vstupenky na koncerty, festivaly a šport" },
      {
        name: "description",
        content:
          "Najmodernejšia ticketing platforma na Slovensku. Koncerty, festivaly, šport, divadlo a stand-up — kupuj vstupenky bezpečne a okamžite.",
      },
      { property: "og:title", content: "vipky.sk — Každý zážitok má svoj vstup" },
      {
        property: "og:description",
        content: "Vstupenky na koncerty, festivaly, šport a kultúru. Bez skrytých poplatkov.",
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
        <Testimonials />
        <Faq />
        <Newsletter />
      </main>
      <Footer />
    </div>
  );
}
