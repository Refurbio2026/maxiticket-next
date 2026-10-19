// Bezpečnostné hlavičky pre každú odpoveď aplikácie.
//
// PREČO V APLIKÁCII A NIE V NGINX: hlavičky patria k perimetru, ktorý si
// spravuje Patrik, a `deploy/bezpecnostne-hlavicky.conf` na jeho `include`
// čaká. Appka ich ale vie poslať sama a pokryje tým všetko, čo prejde cez
// `@app` — HTML stránky, serverové funkcie, API. Mimo ostávajú len statické
// `.js`/`.css`/obrázky, ktoré nginx vydáva priamo z `.output/public`;
// tam má význam hlavne `nosniff` a ten doplní až ten `include`.
//
// Content-Security-Policy tu zámerne NIE JE: zle napísaná rozbije web potichu
// (vložené štýly, vlastný font, obrázky zo Supabase, odchod na platobnú bránu).
// Patrí jej vlastné nasadenie cez `Content-Security-Policy-Report-Only`.

/** Hlavičky, ktoré nezávisia od požiadavky. */
export const HLAVICKY: Record<string, string> = {
  // Prehliadač neháda typ obsahu, verí `Content-Type`.
  "X-Content-Type-Options": "nosniff",
  // Nikto nevloží stránku do rámu na cudzej doméne (clickjacking na pokladni).
  "X-Frame-Options": "SAMEORIGIN",
  // Pri odchode na cudzí web sa neposiela celá adresa — v tej je id objednávky.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Kamera v zozname zámerne nie je: skener vstupeniek ju potrebuje.
  "Permissions-Policy": "geolocation=(), microphone=(), payment=()",
};

/**
 * HSTS začína krátko (5 minút), aby sa dalo odvolať.
 *
 * Prehliadač si HSTS zapamätá a dovtedy odmietne otvoriť doménu po HTTP —
 * keby prepadol certifikát, web je pre vracajúcich sa návštevníkov nedostupný
 * a rýchlejšie než `max-age` sa to zrušiť nedá. `includeSubDomains` chýba
 * zámerne: subdomény organizátorov zástupný certifikát ešte nemajú.
 */
export const HSTS = "max-age=300";

/** Prišla požiadavka po HTTPS? Za nginxom to vie len `X-Forwarded-Proto`. */
export function jeHttps(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  return new URL(request.url).protocol === "https:";
}

/**
 * Doplní hlavičky do odpovede. Čo už odpoveď nastavila, neprepisuje —
 * konkrétna cesta môže mať dôvod (napr. `X-Frame-Options` pre vloženú mapu).
 *
 * Vracia novú `Response` s tým istým telom, takže prúdové SSR zostáva prúdové.
 */
export function pridajBezpecnostneHlavicky(response: Response, request: Request): Response {
  const hlavicky = new Headers(response.headers);
  for (const [nazov, hodnota] of Object.entries(HLAVICKY)) {
    if (!hlavicky.has(nazov)) hlavicky.set(nazov, hodnota);
  }
  if (jeHttps(request) && !hlavicky.has("Strict-Transport-Security")) {
    hlavicky.set("Strict-Transport-Security", HSTS);
  }

  // 204/304 a odpovede bez tela telo mať nesmú — `new Response(body)` by spadla.
  const bezTela = response.status === 204 || response.status === 304;
  return new Response(bezTela ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: hlavicky,
  });
}
