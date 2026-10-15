// Service worker pre čítačku vstupeniek.
//
// Cieľ je jediný: aby sa čítačka otvorila a fungovala aj bez siete. Na vstupe
// do sály je signál často zlý a doteraz by sa appka bez siete ani nenaštartovala.
//
// Čo sa NIKDY neukladá: `/api/` a `/_serverFn/`. Skenovanie, stiahnutie zoznamu
// vstupeniek aj štatistiky musia ísť vždy na server — odpoveď z cache by
// znamenala, že čítačka tvrdí niečo, čo už neplatí. Offline rozhodovanie si
// rieši appka sama zo stiahnutého zoznamu (`offline-scan.ts`), nie cez cache.
const VERZIA = "eticketo-citacka-v1";
const SKELET = ["/scanner", "/manifest.webmanifest", "/ikona-192.png", "/ikona-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(VERZIA)
      .then((c) => c.addAll(SKELET))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((k) => Promise.all(k.filter((x) => x !== VERZIA).map((x) => caches.delete(x))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_serverFn/")) return;

  // Hashované balíky sa nikdy nemenia pod tým istým názvom — cache má prednosť.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((r) => {
            if (r.ok) caches.open(VERZIA).then((c) => c.put(req, r.clone()));
            return r;
          }),
      ),
    );
    return;
  }

  // Stránky: najprv sieť (nech je čerstvá), pri výpadku to, čo máme.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok) caches.open(VERZIA).then((c) => c.put(req, r.clone()));
          return r;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/scanner"))),
    );
  }
});
