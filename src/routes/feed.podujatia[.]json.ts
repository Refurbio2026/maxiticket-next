// Podujatia ako JSON v tvare schema.org.
//
// Pre portál, ktorý si vie napísať vlastné čítanie — tvar zodpovedá
// schema.org/Event, takže kto berie podujatia z viacerých zdrojov, má jedno
// mapovanie pre všetky. To isté značkovanie je aj na stránke podujatia.
import { createFileRoute } from "@tanstack/react-router";
import { siteUrl } from "@/lib/site-url.server";
import { json } from "@/lib/portaly/feed";
import { terminyNaExport } from "@/lib/portaly/feed.server";

async function handler() {
  const terminy = await terminyNaExport();
  return new Response(JSON.stringify(json(terminy, { origin: siteUrl() }), null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      // Portál si to môže čítať z prehliadača, nie len zo servera.
      "access-control-allow-origin": "*",
    },
  });
}

export const Route = createFileRoute("/feed/podujatia.json")({
  server: { handlers: { GET: handler } },
});
