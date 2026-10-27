// Export podujatí pre voľnočasové portály a kalendáre.
//
// PREČO TAKTO: slovenské portály typu kamdomesta alebo citylife nemajú
// zverejnené rozhranie, do ktorého by sa dalo zapisovať — podujatia sa k nim
// dostávajú tak, že im organizátor pošle odkaz na odoberateľný zdroj alebo
// ich zadá ručne. Preto nerobíme integráciu „na jeden portál", ale zdroj,
// ktorý si prečíta ktokoľvek: RSS, iCalendar a JSON. Keď konkrétny portál
// povie „my berieme formát X", pridá sa k tomuto jeden prevod a zoznam
// podujatí sa nemusí riešiť znova.
//
// JEDNA POLOŽKA = JEDEN TERMÍN, nie jedno podujatie. Portál zobrazuje
// kalendár; predstavenie, ktoré sa hrá šesťkrát, sa má ukázať šesťkrát.
// Bez toho by z katalógu videli len najbližší termín.
//
// Všetko je tu čisté a bez databázy, aby sa dalo otestovať — zapojenie na
// databázu je v `feed.server.ts`.

import { sZonou, utcZnacka, utcZnackaZDatumu } from "@/lib/datum-zona";

export type TerminFeed = {
  /** Identifikátor podujatia; s dátumom skladá stabilné `guid`/`UID`. */
  podujatieId: string;
  nazov: string;
  popis?: string | null;
  obrazok?: string | null;
  /** Názov miesta, napríklad „Kino Lumière". */
  miesto: string;
  adresa?: string | null;
  mesto: string;
  kategoria?: string | null;
  /** Najnižšia cena vstupenky v eurách; `null` = cena nie je určená. */
  cenaOd?: number | null;
  datum: string;
  cas?: string | null;
  /** Koľko hodín podujatie trvá. Odhad — do kalendára treba nejaký koniec. */
  trvanieHodin?: number | null;
  zrusene?: boolean;
};

export type HlavickaFeedu = {
  /** Adresa webu bez lomky na konci, napr. `https://eticketo.eu`. */
  origin: string;
  nazov?: string;
  popis?: string;
};

/** Odkaz na podujatie na našom webe — to je cieľ, kam portál posiela ľudí. */
export function odkazPodujatia(origin: string, podujatieId: string): string {
  return `${origin.replace(/\/+$/, "")}/events/${podujatieId}`;
}

/** XML nepustí surové `&`, `<`, `>` ani `"` — v názvoch podujatí bývajú. */
export function xmlText(t: string | number | null | undefined): string {
  if (t === null || t === undefined) return "";
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Popis bez HTML — do RSS aj do kalendára ide čistý text. */
export function bezHtml(t: string | null | undefined): string {
  return (t ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Skrátenie na vetu, ktorá sa zmestí do náhľadu portálu. */
export function skrat(t: string, max = 400): string {
  if (t.length <= max) return t;
  const rez = t.slice(0, max);
  const posledna = rez.lastIndexOf(" ");
  return `${rez.slice(0, posledna > max * 0.6 ? posledna : max).trimEnd()}…`;
}

/** `19,00 €`, ako sa cena píše po slovensky. */
function eur(n: number): string {
  return `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/**
 * Veta o cene a mieste, ktorú portály zobrazujú pod názvom. Skladá sa tu
 * a nie v šablóne, aby bola v RSS aj v kalendári rovnaká.
 */
export function popisTerminu(t: TerminFeed): string {
  const casti: string[] = [];
  const text = skrat(bezHtml(t.popis));
  if (text) casti.push(text);

  const kde = [t.miesto, t.mesto].filter(Boolean).join(", ");
  if (kde) casti.push(`Miesto: ${kde}.`);
  if (typeof t.cenaOd === "number" && t.cenaOd > 0) {
    casti.push(`Vstupenky od ${eur(t.cenaOd)}.`);
  }
  if (t.zrusene) casti.unshift("ZRUŠENÉ.");
  return casti.join(" ");
}

/** Stabilný identifikátor termínu — podľa neho portál pozná, že ide o ten istý. */
export function idTerminu(t: TerminFeed): string {
  return `${t.podujatieId}-${t.datum}`;
}

/** Dátum v tvare, ktorý žiada RSS (RFC 822). */
function rfc822(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

/** Názov s dátumom — v zozname na portáli stojí položka sama za seba. */
export function nazovSDatumom(t: TerminFeed): string {
  const d = new Date(`${t.datum}T00:00:00`);
  if (Number.isNaN(d.getTime())) return t.nazov;
  const den = d.toLocaleDateString("sk-SK", { day: "numeric", month: "numeric", year: "numeric" });
  const cas = (t.cas || "").slice(0, 5);
  return cas ? `${t.nazov} — ${den}, ${cas}` : `${t.nazov} — ${den}`;
}

/** Typ obrázka podľa prípony; pri neznámej sa nehádá nič exotické. */
function typObrazka(url: string): string {
  const u = url.toLowerCase();
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/**
 * RSS 2.0 so zoznamom termínov.
 *
 * Dátum podujatia ide aj do `<pubDate>`, aj keď to nie je dátum vydania
 * záznamu: portály a čítačky radia položky práve podľa neho a kalendár
 * zoradený podľa toho, kedy sme podujatie zapísali, je na nič.
 */
export function rss(terminy: TerminFeed[], h: HlavickaFeedu): string {
  const origin = h.origin.replace(/\/+$/, "");
  const nazov = h.nazov ?? "Podujatia · eticketo.eu";
  const popis = h.popis ?? "Koncerty, divadlo, festivaly a kultúra v predaji na eticketo.eu.";

  const polozky = terminy
    .map((t) => {
      const odkaz = odkazPodujatia(origin, t.podujatieId);
      const kedy = sZonou(t.datum, t.cas);
      const kategoria = t.kategoria ? `\n      <category>${xmlText(t.kategoria)}</category>` : "";
      // `enclosure` je spôsob, akým RSS prenáša obrázok. Dĺžku nevieme
      // a nulová je pre čítačky prijateľná.
      const obrazok = t.obrazok
        ? `\n      <enclosure url="${xmlText(t.obrazok)}" length="0" type="${typObrazka(
            t.obrazok,
          )}" />`
        : "";
      return `    <item>
      <title>${xmlText(nazovSDatumom(t))}</title>
      <link>${xmlText(odkaz)}</link>
      <guid isPermaLink="false">${xmlText(idTerminu(t))}</guid>
      <pubDate>${rfc822(kedy)}</pubDate>
      <description>${xmlText(popisTerminu(t))}</description>${kategoria}${obrazok}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlText(nazov)}</title>
    <link>${xmlText(`${origin}/events`)}</link>
    <description>${xmlText(popis)}</description>
    <language>sk</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${polozky}
  </channel>
</rss>
`;
}

/**
 * Escapovanie textu v iCalendari. Bodkočiarka, čiarka a spätná lomka majú
 * v tomto formáte význam oddeľovačov; nový riadok sa píše ako `\n`.
 */
export function icalText(t: string | null | undefined): string {
  return (t ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Zalomenie dlhého riadku. iCalendar dovoľuje najviac 75 oktetov na riadok;
 * pokračovanie sa začína jednou medzerou. Počíta sa v BAJTOCH, nie znakoch —
 * „Žilina" má v UTF-8 o bajt viac než znakov a kalendár, ktorý dostane dlhší
 * riadok, položku zahodí.
 */
export function zalom(riadok: string): string {
  const bajty = Buffer.from(riadok, "utf8");
  if (bajty.length <= 75) return riadok;

  const casti: string[] = [];
  let zaciatok = 0;
  // Prvý riadok 75 oktetov, ďalšie 74 (jeden zaberie úvodná medzera).
  let limit = 75;
  while (zaciatok < bajty.length) {
    let konec = Math.min(zaciatok + limit, bajty.length);
    // Nesmieme preťať znak na polovicu — pokračovacie bajty UTF-8 majú
    // najvyššie bity `10`, takže sa vrátime na začiatok znaku.
    while (konec > zaciatok && konec < bajty.length && (bajty[konec] & 0xc0) === 0x80) konec -= 1;
    casti.push(bajty.subarray(zaciatok, konec).toString("utf8"));
    zaciatok = konec;
    limit = 74;
  }
  return casti.join("\r\n ");
}

/**
 * iCalendar (.ics) so zoznamom termínov.
 *
 * Riadky sa oddeľujú CRLF — tak to formát predpisuje a kalendáre, ktoré
 * dostanú samotné LF, súbor odmietnu.
 */
export function ical(terminy: TerminFeed[], h: HlavickaFeedu): string {
  const origin = h.origin.replace(/\/+$/, "");
  const doma = origin.replace(/^https?:\/\//, "");
  const teraz = utcZnackaZDatumu();

  const riadky: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//eticketo.eu//Podujatia//SK",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icalText(h.nazov ?? "Podujatia · eticketo.eu")}`,
    "X-WR-TIMEZONE:Europe/Bratislava",
  ];

  for (const t of terminy) {
    const zaciatok = utcZnacka(t.datum, t.cas);
    // Termín, ktorému nerozumieme dátumu, do kalendára nepatrí — bez
    // `DTSTART` je položka neplatná a niektoré kalendáre zahodia celý súbor.
    if (!zaciatok) continue;

    const hodiny = t.trvanieHodin && t.trvanieHodin > 0 ? t.trvanieHodin : 2;
    const koniecMs = new Date(sZonou(t.datum, t.cas)).getTime() + hodiny * 3600_000;
    const koniec = utcZnackaZDatumu(new Date(koniecMs));

    riadky.push(
      "BEGIN:VEVENT",
      `UID:${icalText(`${idTerminu(t)}@${doma}`)}`,
      `DTSTAMP:${teraz}`,
      `DTSTART:${zaciatok}`,
      `DTEND:${koniec}`,
      `SUMMARY:${icalText(t.zrusene ? `ZRUŠENÉ: ${t.nazov}` : t.nazov)}`,
      `DESCRIPTION:${icalText(popisTerminu(t))}`,
      `LOCATION:${icalText([t.miesto, t.adresa, t.mesto].filter(Boolean).join(", "))}`,
      `URL:${icalText(odkazPodujatia(origin, t.podujatieId))}`,
      `STATUS:${t.zrusene ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }

  riadky.push("END:VCALENDAR");
  return riadky.map(zalom).join("\r\n") + "\r\n";
}

/**
 * JSON pre toho, kto si to chce čítať programovo.
 *
 * Tvar zodpovedá schema.org/Event, nie našim stĺpcom — kto berie podujatia
 * z viacerých zdrojov, má tak jedno mapovanie pre všetky.
 */
export function json(terminy: TerminFeed[], h: HlavickaFeedu) {
  const origin = h.origin.replace(/\/+$/, "");
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: h.nazov ?? "Podujatia · eticketo.eu",
    url: `${origin}/events`,
    numberOfItems: terminy.length,
    itemListElement: terminy.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Event",
        identifier: idTerminu(t),
        name: t.nazov,
        description: popisTerminu(t),
        url: odkazPodujatia(origin, t.podujatieId),
        startDate: sZonou(t.datum, t.cas),
        eventStatus: t.zrusene
          ? "https://schema.org/EventCancelled"
          : "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        ...(t.obrazok ? { image: [t.obrazok] } : {}),
        ...(t.kategoria ? { keywords: t.kategoria } : {}),
        location: {
          "@type": "Place",
          name: t.miesto,
          address: {
            "@type": "PostalAddress",
            ...(t.adresa ? { streetAddress: t.adresa } : {}),
            addressLocality: t.mesto,
            addressCountry: "SK",
          },
        },
        ...(typeof t.cenaOd === "number" && t.cenaOd > 0
          ? {
              offers: {
                "@type": "Offer",
                price: t.cenaOd,
                priceCurrency: "EUR",
                url: odkazPodujatia(origin, t.podujatieId),
                availability: t.zrusene
                  ? "https://schema.org/SoldOut"
                  : "https://schema.org/InStock",
              },
            }
          : {}),
      },
    })),
  };
}
