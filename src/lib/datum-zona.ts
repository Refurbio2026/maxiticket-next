// Dátum a čas podujatia v tvare, ktorý pochopí stroj.
//
// V databáze je dátum a čas zvlášť a bez zóny (`2026-11-05`, `19:30`), lebo
// tak ich zadáva organizátor. Von ale musí ísť okamih — inak si ho každý
// čitateľ domyslí po svojom a podujatie sa ľuďom ukáže o hodinu inak.
// Google to urobí vo výsledkoch vyhľadávania, kalendár v telefóne v pozvánke.
//
// Jedno miesto zámerne: to isté potrebuje značkovanie na stránke podujatia
// aj feedy pre portály a kalendáre. Keď to bolo len v stránke podujatia,
// feed by si prepočet musel napísať znova — a dve kópie prepočtu zón sa
// rozídu pri najbližšom prechode na letný čas.

/** Minúty posunu voči UTC pre daný okamih v Bratislave. Leto +120, zima +60. */
function posunMinut(datumCas: string): number | null {
  const okamih = new Date(`${datumCas}Z`);
  if (Number.isNaN(okamih.getTime())) return null;
  const vZone = new Date(okamih.toLocaleString("en-US", { timeZone: "Europe/Bratislava" }));
  const vUtc = new Date(okamih.toLocaleString("en-US", { timeZone: "UTC" }));
  const minuty = Math.round((vZone.getTime() - vUtc.getTime()) / 60000);
  return Number.isFinite(minuty) ? minuty : null;
}

/** Čas bez sekúnd; prázdny sa berie ako polnoc. */
function hhmm(cas: string | null | undefined): string {
  return (cas || "00:00").slice(0, 5);
}

/**
 * `2026-11-05`, `19:30` → `2026-11-05T19:30:00+01:00`.
 *
 * Pri nečitateľnom vstupe sa vráti čas bez posunu — radšej údaj bez zóny než
 * žiadny, lebo bez `startDate` Google podujatie zahodí celé.
 */
export function sZonou(datum: string, cas: string | null | undefined): string {
  const cely = `${datum}T${hhmm(cas)}:00`;
  const minuty = posunMinut(cely);
  if (minuty === null) return cely;

  const znak = minuty < 0 ? "-" : "+";
  const h = String(Math.floor(Math.abs(minuty) / 60)).padStart(2, "0");
  const m = String(Math.abs(minuty) % 60).padStart(2, "0");
  return `${cely}${znak}${h}:${m}`;
}

/**
 * Ten istý okamih ako značka pre iCalendar: `20261105T183000Z`.
 *
 * Zámerne v UTC a nie s `TZID`: tvar s `TZID` vyžaduje, aby súbor obsahoval
 * aj definíciu zóny (`VTIMEZONE`), a kalendáre, ktoré ju nenájdu, čas tichom
 * posunú. `Z` je jednoznačné a prečíta ho každý.
 */
export function utcZnacka(datum: string, cas: string | null | undefined): string | null {
  const okamih = new Date(sZonou(datum, cas));
  if (Number.isNaN(okamih.getTime())) return null;
  return okamih
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** Ten istý tvar pre „teraz" — do hlavičiek feedov (`DTSTAMP`). */
export function utcZnackaZDatumu(d: Date = new Date()): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
