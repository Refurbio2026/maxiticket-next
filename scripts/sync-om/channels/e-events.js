// Kanál E — podujatia.
//
// Kurzor je `plan.modified`. DDL overené na prod RDS 16. 9. 2026:
// `datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()`
// s vlastným indexom `modified`, takže dotaz ide po indexe a hodnota nikdy
// nechýba. `COALESCE(modified, created)` ostáva len ako defenzíva pre nájomcu
// so starším DDL.
//
// `drama`, `hall_desc` a `promoter` nemajú v OM **žiadnu časovú značku**.
// Ich názvy sa preto denormalizujú do `om_events` pri každej zmene plánu
// a raz denne plným refreshom (`--channel=codebooks`). Premenovanie podujatia
// sa tak prejaví najneskôr v noci — je to známe obmedzenie, nie chyba (T9).

import { dotaz, naIso, naDatum, naCas, naCislo, naText, odpocitajMinuty } from "../lib/source.js";
import { upsert, nacitajKurzor, ulozKurzor } from "../lib/target.js";

export const kanal = "E";
export const popis = "podujatia (plan.modified)";

const LIMIT = 1000;
const PREKRYV_MINUT = 5;

// `VAT` je v OM veľkými písmenami, preto alias. `end` je rezervované slovo.
const STLPCE = `
  p.id_plan, p.id_drama, p.id_hall_desc, p.id_price_category, p.id_promoter,
  p.id_promoter_ticket, p.id_subdomain, p.id_plan_group, p.id_performer,
  p.datum, p.start AS start_time, p.\`end\` AS end_time, p.door_time,
  p.sell_start, p.sell_end, p.stop_sell, p.show_online, p.show_hash,
  p.allow_remote, p.allow_export, p.require_access_code, p.abo_mask,
  p.ticket_limit, p.VAT AS vat, p.tickets_with_places,
  p.created, p.modified,
  d.name AS drama_name, h.name AS hall_name`;

export function zmapuj(r) {
  return {
    id_plan: naCislo(r.id_plan),
    id_drama: naCislo(r.id_drama),
    id_hall_desc: naCislo(r.id_hall_desc),
    id_price_category: naCislo(r.id_price_category),
    id_promoter: naCislo(r.id_promoter),
    id_promoter_ticket: naCislo(r.id_promoter_ticket),
    id_subdomain: naCislo(r.id_subdomain),
    id_plan_group: naCislo(r.id_plan_group),
    id_performer: naCislo(r.id_performer),
    datum: naDatum(r.datum),
    // `plan.start` / `plan.end` sú v OM typu `time` — dátum nesie `datum`.
    start_time: naCas(r.start_time),
    end_time: naCas(r.end_time),
    door_time: naIso(r.door_time),
    sell_start: naIso(r.sell_start),
    sell_end: naIso(r.sell_end),
    stop_sell: naCislo(r.stop_sell),
    show_online: naCislo(r.show_online),
    show_hash: naCislo(r.show_hash),
    allow_remote: naCislo(r.allow_remote),
    allow_export: naCislo(r.allow_export),
    // `bit(1)` — z mysql2 chodí ako Buffer.
    require_access_code: naCislo(r.require_access_code),
    abo_mask: naCislo(r.abo_mask),
    ticket_limit: naCislo(r.ticket_limit),
    vat: r.vat == null ? null : Number(r.vat),
    tickets_with_places: naCislo(r.tickets_with_places),
    created_at: naIso(r.created),
    modified_at: naIso(r.modified),
    drama_name: naText(r.drama_name),
    hall_name: naText(r.hall_name),
    raw: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, naText(v)])),
  };
}

export async function spusti({ dryRun = false, full = false, since, log, maxDavok = Infinity }) {
  const ulozeny = await nacitajKurzor(kanal);
  let od = full
    ? "1970-01-01 00:00:00"
    : (odpocitajMinuty(ulozeny.ts, PREKRYV_MINUT) ?? "1970-01-01 00:00:00");
  let odIdPlan = 0;

  // Orezanie na podujatia od dátumu. Drží sa v kurzore, takže inkrementálny beh
  // po backfille filtruje rovnako a prerušený backfill sa dá dokončiť bez
  // opakovania prepínača.
  const odDatumu = since ?? ulozeny.since ?? null;

  let spolu = 0;
  let davok = 0;
  let posledny = ulozeny.ts ?? null;

  log.info("štart", { od, dryRun, full, since: odDatumu });

  while (davok < maxDavok) {
    const riadky = await dotaz(
      `SELECT ${STLPCE}
         FROM plan p
         LEFT JOIN drama d ON d.id_drama = p.id_drama
         LEFT JOIN hall_desc h ON h.id_hall_desc = p.id_hall_desc
        WHERE ((COALESCE(p.modified, p.created) > ?)
            OR (COALESCE(p.modified, p.created) = ? AND p.id_plan > ?))
          ${odDatumu ? "AND p.datum >= ?" : ""}
        ORDER BY COALESCE(p.modified, p.created), p.id_plan
        LIMIT ${LIMIT}`,
      odDatumu ? [od, od, odIdPlan, odDatumu] : [od, od, odIdPlan],
    );
    if (!riadky.length) break;

    await upsert("om_events", riadky.map(zmapuj), "id_plan", { dryRun, log });

    const p = riadky[riadky.length - 1];
    od = String(p.modified ?? p.created);
    odIdPlan = Number(p.id_plan);
    posledny = od;

    spolu += riadky.length;
    davok++;
    log.debug("dávka", { riadkov: riadky.length, spolu, poslednyModified: od });

    if (riadky.length < LIMIT) break;
  }

  await ulozKurzor(kanal, {
    hodnota: posledny ? { ts: posledny, id_plan: odIdPlan, since: odDatumu } : undefined,
    riadkov: spolu,
    dryRun,
  });

  log.info("hotovo", { riadkov: spolu, davok, kurzor: posledny, since: odDatumu });
  return { riadkov: spolu, davok, kurzor: posledny, since: odDatumu };
}
