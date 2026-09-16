// Kanál D — kontrola vstupu (check-in).
//
// Kurzor je PK `id_seat_scan`. **Žiadny časový prekryv nie je potrebný:** aj
// offline dávka nahraná so spätným časom dostane nové, vyššie id. `scan_time`
// je čas udalosti, nie poradie doručenia — stav vstupenky sa preto počíta
// v poradí podľa `scan_time` (robí to view `tickets_unified`), nie podľa id.
//
// Väzba na vstupenku: `seat_scan.id_seat` je v OM **vždy NULL**, páruje sa cez
// `(id_plan, barcode)`. Páruje sa **v cieli**, nie dotazom do zdroja — index
// na `seat_scan` je `(id_gate, barcode)`, takže JOIN cez `id_plan` by čítal
// tabuľku bez indexu.

import { dotaz, naIso, naCislo, naText } from "../lib/source.js";
import { upsert, nacitajKurzor, ulozKurzor, ciel } from "../lib/target.js";

export const kanal = "D";
export const popis = "kontrola vstupu (seat_scan.id_seat_scan)";

const LIMIT = 5000;

function zmapuj(r) {
  return {
    id_seat_scan: naCislo(r.id_seat_scan),
    id_plan: naCislo(r.id_plan),
    id_gate: naCislo(r.id_gate),
    barcode: r.barcode == null ? null : Number(r.barcode),
    scan_type: naCislo(r.scan_type),
    online: naCislo(r.online),
    scan_time: naIso(r.scan_time),
    // V OM vždy NULL — držíme, aby bolo vidieť, že to tak naozaj je.
    source_id_seat: naCislo(r.id_seat),
    raw: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, naText(v)])),
  };
}

/**
 * Dopárovanie skenov na vstupenky. Robí to funkcia v databáze
 * (`om_doparuj_skeny`), lebo je to čistý JOIN nad indexom
 * `om_scans (id_plan, barcode, …)` — ťahať to do JavaScriptu by znamenalo
 * dva dotazy a mapu v pamäti pre nič.
 */
async function doparuj(log, dryRun) {
  if (dryRun) return null;
  const { data, error } = await ciel().rpc("om_doparuj_skeny");
  if (error) {
    // Funkcia pribúda spolu s view `tickets_unified`. Kým nie je, skeny sa
    // uložia nedopárované a dopária sa pri najbližšom behu — nie je to dôvod
    // zhodiť kanál, ktorý dáta priniesol v poriadku.
    log.warn("dopárovanie skenov preskočené", { chyba: error.message });
    return null;
  }
  log.info("dopárované", data ?? {});
  return data;
}

export async function spusti({ dryRun = false, full = false, since, log, maxDavok = Infinity }) {
  const ulozeny = await nacitajKurzor(kanal);
  let odId = full ? 0 : Number(ulozeny.last_id) || 0;

  // Orezanie cez `id_plan` — `seat_scan` ho má aj s indexom.
  const odDatumu = since ?? ulozeny.since ?? null;

  let spolu = 0;
  let davok = 0;

  log.info("štart", { odId, dryRun, full, since: odDatumu });

  while (davok < maxDavok) {
    const riadky = await dotaz(
      `SELECT sc.id_seat_scan, sc.id_plan, sc.id_gate, sc.barcode,
              sc.scan_type, sc.online, sc.scan_time, sc.id_seat
         FROM seat_scan sc
        WHERE sc.id_seat_scan > ?
          ${odDatumu ? "AND sc.id_plan IN (SELECT p.id_plan FROM plan p WHERE p.datum >= ?)" : ""}
        ORDER BY sc.id_seat_scan
        LIMIT ${LIMIT}`,
      odDatumu ? [odId, odDatumu] : [odId],
    );
    if (!riadky.length) break;

    await upsert("om_scans", riadky.map(zmapuj), "id_seat_scan", { dryRun, log });

    odId = Number(riadky[riadky.length - 1].id_seat_scan);
    spolu += riadky.length;
    davok++;
    log.debug("dávka", { riadkov: riadky.length, spolu, poslednyId: odId });
    if (riadky.length < LIMIT) break;
  }

  const doparovanie = spolu ? await doparuj(log, dryRun) : null;

  await ulozKurzor(kanal, { hodnota: { last_id: odId, since: odDatumu }, riadkov: spolu, dryRun });
  log.info("hotovo", { riadkov: spolu, davok, kurzor: odId, since: odDatumu });
  return { riadkov: spolu, davok, kurzor: odId, since: odDatumu, doparovanie };
}
