// Mapa stránok pre vyhľadávače.
//
// Bez nej sa Google k jednotlivým podujatiam dostane len cez odkazy
// z katalógu, čo pri termínoch, ktoré rýchlo pribúdajú a miznú, znamená
// oneskorenie. Pri ticketingu je organické vyhľadávanie najlacnejší zdroj
// návštevnosti, aký existuje.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { siteUrl } from "@/lib/site-url.server";

/** XML nepustí surové `&`, `<` ani `>` — adresy podujatí ich obsahovať môžu. */
function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function handler() {
  const origin = siteUrl();

  // `/account` ani `/checkout` sem nepatria — sú za prihlásením a robots.txt
  // ich zakazuje; mať ich v mape by si protirečilo.
  const staticke = ["", "/events", "/support"];
  const { data: podujatia } = await supabaseAdmin
    .from("events")
    .select("id, updated_at")
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(5000);

  const polozky = [
    ...staticke.map(
      (cesta) => `  <url><loc>${xml(origin + cesta)}</loc><changefreq>daily</changefreq></url>`,
    ),
    ...(podujatia || []).map(
      (e) =>
        `  <url><loc>${xml(`${origin}/events/${e.id}`)}</loc>` +
        `<lastmod>${new Date(e.updated_at).toISOString().slice(0, 10)}</lastmod>` +
        `<changefreq>daily</changefreq></url>`,
    ),
  ];

  const telo = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${polozky.join("\n")}
</urlset>
`;

  return new Response(telo, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // Katalóg sa mení po termínoch, nie po sekundách.
      "cache-control": "public, max-age=3600",
    },
  });
}

export const Route = createFileRoute("/sitemap.xml")({
  server: { handlers: { GET: handler } },
});
