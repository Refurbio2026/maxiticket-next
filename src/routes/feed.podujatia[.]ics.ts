// iCalendar so všetkými termínmi v predaji.
//
// Na rozdiel od RSS si toto vie pridať aj človek — do Google kalendára,
// Outlooku alebo do telefónu ako odoberaný kalendár. Portály, ktoré berú
// `.ics`, ho čítajú rovnako.
import { createFileRoute } from "@tanstack/react-router";
import { siteUrl } from "@/lib/site-url.server";
import { ical } from "@/lib/portaly/feed";
import { terminyNaExport } from "@/lib/portaly/feed.server";

async function handler() {
  const terminy = await terminyNaExport();
  return new Response(ical(terminy, { origin: siteUrl() }), {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

export const Route = createFileRoute("/feed/podujatia.ics")({
  server: { handlers: { GET: handler } },
});
