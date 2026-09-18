// Denný plný refresh číselníkov.
//
// `drama`, `hall_desc`, `promoter`, `subdomain`, `seat_category`,
// `price_category` a `price` nemajú v OM **žiadnu časovú značku**, takže sa
// nedajú synchronizovať inkrementálne. Sú rádovo v tisícoch riadkov, preto sa
// raz denne načítajú celé.
//
// Deľba práce pri `seat_status`: OM stĺpce prepisuje tento refresh,
// `category` a `suspicious_when_free` sú **naše** a nedotkne sa ich. Nový
// neznámy stav dostane `category = 'other'`, `category_source = 'auto'`
// a warning do logu — je to fronta na ručné zaradenie, nie tichá zmena.

import { dotaz, naCislo, naText, naIso } from "../lib/source.js";
import { upsert, ciel, ulozKurzor } from "../lib/target.js";

export const kanal = "codebooks";
export const popis = "denný refresh číselníkov bez časovej značky";

async function obnovStavy({ dryRun, log }) {
  const zdrojove = await dotaz(
    `SELECT s.id_seat_status, s.name, s.ticket, s.enabled, s.invoice, s.customer,
            s.mifare, s.reservation, s.order_position
       FROM seat_status s`,
  );

  const { data: nase, error } = await ciel().from("om_seat_status").select("id_seat_status");
  if (error) throw new Error(`Číselník stavov: ${error.message}`);
  const zname = new Set(nase.map((r) => Number(r.id_seat_status)));

  const nove = zdrojove.filter((r) => !zname.has(Number(r.id_seat_status)));
  if (nove.length) {
    log.warn("V OM pribudli stavy, ktoré špecifikácia nepozná — zaradené ako 'other'", {
      stavy: nove.map((r) => ({ id: Number(r.id_seat_status), nazov: naText(r.name) })),
      copotom: "zaraď ich ručne: update om_seat_status set category = …, category_source = 'spec'",
    });
  }

  // Známe stavy: len OM stĺpce, `category` sa nedotýkame.
  const existujuce = zdrojove
    .filter((r) => zname.has(Number(r.id_seat_status)))
    .map((r) => ({
      id_seat_status: naCislo(r.id_seat_status),
      name: naText(r.name),
      ticket: naCislo(r.ticket) === 1,
      enabled: naCislo(r.enabled) === 1,
      invoice: naCislo(r.invoice) === 1,
      customer: naCislo(r.customer) === 1,
      mifare: naCislo(r.mifare) === 1,
      reservation: naCislo(r.reservation) === 1,
      order_position: naCislo(r.order_position),
      raw: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, naText(v)])),
    }));

  // Nové stavy dostanú navyše naše predvolené hodnoty.
  const pridavane = nove.map((r) => ({
    id_seat_status: naCislo(r.id_seat_status),
    name: naText(r.name),
    ticket: naCislo(r.ticket) === 1,
    enabled: naCislo(r.enabled) === 1,
    invoice: naCislo(r.invoice) === 1,
    customer: naCislo(r.customer) === 1,
    mifare: naCislo(r.mifare) === 1,
    reservation: naCislo(r.reservation) === 1,
    order_position: naCislo(r.order_position),
    category: "other",
    category_source: "auto",
    suspicious_when_free: false,
    raw: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, naText(v)])),
  }));

  await upsert("om_seat_status", existujuce, "id_seat_status", { dryRun, log });
  await upsert("om_seat_status", pridavane, "id_seat_status", { dryRun, log });

  return { stavov: zdrojove.length, novych: nove.length };
}

/**
 * Názvy podujatí, sál a organizátorov sú denormalizované v `om_events`.
 * Bez časovej značky sa inak premenovanie neprejaví nikdy (scenár T9).
 */
async function obnovNazvyPodujati({ dryRun, log }) {
  const riadky = await dotaz(
    `SELECT p.id_plan, d.name AS drama_name, h.name AS hall_name
       FROM plan p
       LEFT JOIN drama d ON d.id_drama = p.id_drama
       LEFT JOIN hall_desc h ON h.id_hall_desc = p.id_hall_desc`,
  );

  // Aktualizujú sa len plány, ktoré cieľ pozná — inak by upsert založil
  // podujatie bez povinného `raw` a bez zvyšku stĺpcov.
  //
  // A len tie, ktorým sa názov naozaj zmenil. Prvá verzia posielala UPDATE na
  // každý známy plán a jeden beh trval 69 s pri 839 zápisoch, z ktorých drvivá
  // väčšina nič nemenila.
  const { data: zname, error } = await ciel()
    .from("om_events")
    .select("id_plan, drama_name, hall_name");
  if (error) throw new Error(`Podujatia: ${error.message}`);
  const nase = new Map(zname.map((r) => [Number(r.id_plan), r]));

  const zmeny = riadky
    .map((r) => ({
      id_plan: Number(r.id_plan),
      drama_name: naText(r.drama_name),
      hall_name: naText(r.hall_name),
    }))
    .filter((r) => {
      const u = nase.get(r.id_plan);
      return u && (u.drama_name !== r.drama_name || u.hall_name !== r.hall_name);
    });

  let zmenenych = 0;
  if (!dryRun) {
    for (const r of zmeny) {
      const { error: e } = await ciel()
        .from("om_events")
        .update({ drama_name: r.drama_name, hall_name: r.hall_name })
        .eq("id_plan", r.id_plan);
      if (e) {
        log.warn("Názvy podujatia sa nepodarilo obnoviť", { id_plan: r.id_plan, chyba: e.message });
        continue;
      }
      zmenenych++;
    }
  } else {
    zmenenych = zmeny.length;
  }

  return { planov: riadky.length, znamych: nase.size, obnovenych: zmenenych };
}

/**
 * Organizátori starého systému.
 *
 * `promoter` má na rozdiel od `drama` a `hall_desc` stĺpec `modified`, takže by
 * sa dal ťahať inkrementálne. Pri 437 riadkoch to nemá zmysel — celý refresh
 * je jeden dotaz a jeden upsert.
 *
 * `iban` ani `swift` sa neprenášajú: na prehľad nie sú potrebné a nemať ich tu
 * je lacnejšie než ich strážiť.
 */
async function obnovPromoterov({ dryRun, log }) {
  const riadky = await dotaz(
    `SELECT p.id_promoter, p.name, p.event_promoter, p.ico, p.dic, p.ic_dph,
            p.contact_name, p.email, p.tel, p.city, p.country_code,
            p.vat_rate, p.hold_percentage, p.active, p.visible, p.modified
       FROM promoter p`,
  );

  const zapisane = await upsert(
    "om_promoters",
    riadky.map((r) => ({
      id_promoter: naCislo(r.id_promoter),
      name: naText(r.name),
      event_promoter: naText(r.event_promoter),
      ico: naText(r.ico),
      dic: naText(r.dic),
      ic_dph: naText(r.ic_dph),
      contact_name: naText(r.contact_name),
      email: naText(r.email),
      tel: naText(r.tel),
      city: naText(r.city),
      country_code: naText(r.country_code),
      vat_rate: r.vat_rate == null ? null : Number(r.vat_rate),
      hold_percentage: r.hold_percentage == null ? null : Number(r.hold_percentage),
      active: naCislo(r.active) === 1,
      visible: naCislo(r.visible) === 1,
      modified_at: naIso(r.modified),
      raw: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, naText(v)])),
    })),
    "id_promoter",
    { dryRun, log },
  );

  return { promoterov: riadky.length, zapisanych: zapisane };
}

export async function spusti({ dryRun = false, log }) {
  const stavy = await obnovStavy({ dryRun, log });
  const promoteri = await obnovPromoterov({ dryRun, log });
  const nazvy = await obnovNazvyPodujati({ dryRun, log });
  await ulozKurzor(kanal, {
    hodnota: { refreshed_at: new Date().toISOString() },
    riadkov: stavy.stavov + promoteri.promoterov + nazvy.obnovenych,
    dryRun,
  });
  log.info("hotovo", { stavy, promoteri, nazvy });
  return { stavy, promoteri, nazvy };
}
