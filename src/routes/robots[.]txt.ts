// robots.txt — hlavne kvôli odkazu na mapu stránok.
//
// Administrácia, pokladňa a čítačka do vyhľadávania nepatria: sú za
// prihlásením, takže robot z nich aj tak nič nedostane, len by na ne míňal
// čas a v prehľadoch by sa objavovali ako chyby.
import { createFileRoute } from "@tanstack/react-router";
import { siteUrl } from "@/lib/site-url.server";

async function handler() {
  const origin = siteUrl();
  const telo = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /organizer
Disallow: /scanner
Disallow: /checkout
Disallow: /account
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`;
  return new Response(telo, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}

export const Route = createFileRoute("/robots.txt")({
  server: { handlers: { GET: handler } },
});
