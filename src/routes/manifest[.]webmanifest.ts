// Manifest PWA čítačky.
//
// Prečo routa a nie súbor v `public/`: nginx nepozná príponu `.webmanifest`
// a servíroval ho ako `application/octet-stream`. Chrome to zhltne s varovaním,
// iOS si s tým ale vie poradiť zle a appka sa potom neinštaluje tak, ako má.
// Rovnaký dôvod, prečo sú routou aj `robots.txt` a `sitemap.xml`.
//
// `start_url` je `/scanner`, nie domovská stránka: inštaluje sa čítačka, nie
// obchod. Kupujúci si appku na plochu nedáva.
import { createFileRoute } from "@tanstack/react-router";

const MANIFEST = {
  name: "eticketo čítačka",
  short_name: "Čítačka",
  description: "Skenovanie vstupeniek na vstupe. Funguje aj bez siete.",
  start_url: "/scanner",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#0b0b0f",
  // Brandová oranžová z `--gradient-flame`, prepočítaná z oklch.
  theme_color: "#fe6a00",
  lang: "sk",
  icons: [
    { src: "/ikona-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/ikona-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/ikona-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

async function handler() {
  return new Response(JSON.stringify(MANIFEST, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

export const Route = createFileRoute("/manifest.webmanifest")({
  server: { handlers: { GET: handler } },
});
