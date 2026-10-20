// GET /widget.js
//
// Skript, ktorý si organizátor vloží na vlastný web. Servíruje sa routou a nie
// zo `public/`, z dvoch dôvodov:
//   * potrebuje do seba doplniť adresu nášho webu (`PUBLIC_SITE_URL`), aby
//     fungoval aj na testovacej domén;
//   * rovnako ako `manifest.webmanifest`, `robots.txt` a `sitemap.xml` chceme
//     mať istotu v hlavičkách — tu najmä `Content-Type` a `Cache-Control`.
//
// Hodina v keši je kompromis: organizátorom sa vzhľad opraví v rozumnom čase,
// ale nestahuje sa to pri každom načítaní ich stránky. Dáta samotné sa
// kešujú len minútu, takže nové podujatie sa objaví takmer hneď.
import { createFileRoute } from "@tanstack/react-router";
import { widgetJs } from "@/lib/widget-script";

export const Route = createFileRoute("/widget.js")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const zaklad = process.env.PUBLIC_SITE_URL || new URL(request.url).origin;
        return new Response(widgetJs(zaklad), {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            // Vkladá sa na cudzie domény, takže musí byť čitateľný odkiaľkoľvek.
            "Access-Control-Allow-Origin": "*",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
