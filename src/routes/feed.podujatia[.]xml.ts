// RSS so všetkými termínmi v predaji — pre voľnočasové portály.
//
// Toto je adresa, ktorú organizátor pošle portálu („odoberajte si nás odtiaľ").
// Portály typu kamdomesta či citylife nemajú zverejnené rozhranie na zápis,
// takže odoberateľný zdroj je jediná cesta, ktorá nevyžaduje, aby niekto
// každé podujatie prepisoval rukou.
import { createFileRoute } from "@tanstack/react-router";
import { siteUrl } from "@/lib/site-url.server";
import { rss } from "@/lib/portaly/feed";
import { terminyNaExport } from "@/lib/portaly/feed.server";

async function handler() {
  const terminy = await terminyNaExport();
  return new Response(rss(terminy, { origin: siteUrl() }), {
    status: 200,
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      // Katalóg sa mení po termínoch, nie po sekundách. Hodina stačí a šetrí
      // databázu pri portáli, ktorý si feed stahuje často.
      "cache-control": "public, max-age=3600",
    },
  });
}

export const Route = createFileRoute("/feed/podujatia.xml")({
  server: { handlers: { GET: handler } },
});
