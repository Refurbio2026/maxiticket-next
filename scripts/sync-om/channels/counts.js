// Hodinová kontrola počtov.
//
// `seat.modified` pokryje každú zmenu riadku, **nie však jeho zmazanie**.
// `seat` má FK na `plan` s `ON DELETE CASCADE`, takže zrušenie predstavenia
// zmaže miesta ticho a v zdroji po nich neostane žiadna stopa. Táto agregácia
// je jediné, čo to odhalí (scenár T10).
//
// Blokované miesta, permanentky a voľné sa rátajú **zvlášť**. Keby sa blokované
// zliali s voľnými, zmena kapacity sály by vyzerala ako výpadok dát.
//
// Plný výpis miest sa sťahuje **iba pre plány, kde sa čísla nezhodujú**.

import { dotaz, naCislo, naIso, naText } from "../lib/source.js";
import { ciel, upsert, ulozKurzor } from "../lib/target.js";
import { stavyKategorie } from "../lib/ciselnik.js";

export const kanal = "counts";
export const popis = "hodinová kontrola počtov pre aktívne plány";

const OKNO_DOZADU_DNI = 7;
const OKNO_DOPREDU_DNI = 90;

/**
 * Agregácia v zdroji — ide po indexe `id_plan`, pri desiatkach plánov je lacná.
 *
 * Zoznamy stavov sa berú z číselníka, nie z konštánt v kóde: cieľová strana
 * počíta podľa `category` a keby sa tu vymenovali stavy natvrdo, preklasifikovanie
 * jediného stavu by hlásilo nezhodu na každom pláne, kde sa vyskytuje.
 */
async function zdrojovePocty() {
  const zoznam = (k) => {
    const st = stavyKategorie(k);
    return st.length ? st.join(",") : "NULL";
  };
  const riadky = await dotaz(
    `SELECT s.id_plan,
            COUNT(*)                                          AS seats,
            SUM(s.id_seat_status IN (${zoznam("sold")}))      AS sold,
            SUM(s.id_seat_status IN (${zoznam("abo")}))       AS abo,
            SUM(s.id_seat_status IN (${zoznam("pending")}))   AS reserved,
            SUM(s.id_seat_status IN (${zoznam("blocked")}))   AS blocked,
            SUM(s.id_seat_status IN (${zoznam("free")}))      AS free,
            SUM(s.scan > 0)                                   AS scanned,
            MAX(s.modified)                                   AS last_modified
       FROM seat s
       JOIN plan p ON p.id_plan = s.id_plan
      WHERE p.datum BETWEEN DATE_SUB(NOW(), INTERVAL ? DAY) AND DATE_ADD(NOW(), INTERVAL ? DAY)
      GROUP BY s.id_plan`,
    [OKNO_DOZADU_DNI, OKNO_DOPREDU_DNI],
  );
  return new Map(
    riadky.map((r) => [
      Number(r.id_plan),
      {
        seats: naCislo(r.seats),
        sold: naCislo(r.sold),
        abo: naCislo(r.abo),
        reserved: naCislo(r.reserved),
        blocked: naCislo(r.blocked),
        free: naCislo(r.free),
        scanned: naCislo(r.scanned),
      },
    ]),
  );
}

/**
 * Tie isté počty z našej kópie. Počíta ich funkcia v databáze.
 *
 * Pozor: `seats` je tu počet **uložených** riadkov, nie počet miest
 * predstavenia. Voľné sedadlá sa do cieľa nevkladajú (pozri kanál A), takže
 * uložených je vždy menej. Skutočný počet voľných sa dopočítava v `porovnaj`.
 */
async function cielovePocty(idPlanov) {
  const { data, error } = await ciel().rpc("om_pocty_podla_planu", { p_plany: idPlanov });
  if (error) throw new Error(`Počty v cieli: ${error.message}`);
  return new Map(
    (data ?? []).map((r) => [
      Number(r.id_plan),
      {
        seats: Number(r.seats),
        sold: Number(r.sold),
        abo: Number(r.abo),
        reserved: Number(r.reserved),
        blocked: Number(r.blocked),
        free: Number(r.free),
        scanned: Number(r.scanned),
      },
    ]),
  );
}

/**
 * Kategórie, ktoré sa dajú porovnať priamo — cieľ ich má uložené celé.
 *
 * `seats` ani `free` medzi nimi nie sú a nemôžu byť: voľné miesta sa do cieľa
 * zámerne nevkladajú, takže uložený počet je vždy nižší. `free` sa dopočíta
 * a vypíše, ale nezakladá nezhodu — je odvodené zo `zdroj.seats`, takže by len
 * zdvojilo rozdiel, ktorý už hlási niektorá z ostatných kategórií.
 */
const POROVNAVANE = ["sold", "abo", "reserved", "blocked", "scanned"];

/**
 * Cieľové počty doplnené o dopočítané voľné miesta.
 *
 * `free = zdroj.seats − (sold + abo + reserved + blocked + other)`, kde `other`
 * sú uložené riadky mimo známych kategórií.
 */
function dopocitaj(zdroj, ulozene) {
  const u = ulozene ?? { seats: 0, sold: 0, abo: 0, reserved: 0, blocked: 0, free: 0, scanned: 0 };
  const zname = u.sold + u.abo + u.reserved + u.blocked + u.free;
  const other = Math.max(0, u.seats - zname);
  return {
    ...u,
    other,
    ulozenych: u.seats,
    seats: zdroj.seats,
    free: Math.max(0, zdroj.seats - (u.sold + u.abo + u.reserved + u.blocked + other)),
  };
}

function porovnaj(zdroj, cielP) {
  const rozdiel = {};
  for (const kluc of POROVNAVANE) {
    const a = zdroj[kluc] ?? 0;
    const b = cielP?.[kluc] ?? 0;
    if (a !== b) rozdiel[kluc] = { zdroj: a, ciel: b };
  }
  return rozdiel;
}

/**
 * Plný výpis miest jedného plánu — len keď sa čísla nezhodujú.
 *
 * Voľné miesta sa vynechávajú rovnako ako v kanáli A; opravou nesmie do cieľa
 * pritiecť to, čo tam zámerne nepatrí.
 */
async function dotiahniPlan(idPlan, { dryRun, log }) {
  const volne = new Set(stavyKategorie("free"));
  const vsetky = await dotaz(
    `SELECT s.id_seat, s.id_plan, s.id_seat_status, s.id_seat_note, s.barcode,
            s.price, s.scan, s.changed, s.modified, s.id_sys_user, s.id_person
       FROM seat s WHERE s.id_plan = ? ORDER BY s.id_seat`,
    [idPlan],
  );
  const riadky = vsetky.filter((r) => !volne.has(Number(r.id_seat_status)));
  if (!riadky.length) return 0;

  await upsert(
    "om_tickets",
    riadky.map((r) => ({
      id_seat: naCislo(r.id_seat),
      id_plan: naCislo(r.id_plan),
      id_seat_status: naCislo(r.id_seat_status),
      id_seat_note: naCislo(r.id_seat_note),
      barcode: r.barcode == null ? null : Number(r.barcode),
      price: r.price == null ? null : Number(r.price),
      scan: naCislo(r.scan) ?? 0,
      id_sys_user: naCislo(r.id_sys_user),
      id_person: naCislo(r.id_person),
      changed_at: naIso(r.changed),
      modified_at: naIso(r.modified),
      raw: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, naText(v)])),
    })),
    "id_seat",
    { dryRun, log },
  );
  return riadky.length;
}

export async function spusti({ dryRun = false, log }) {
  const zdroj = await zdrojovePocty();
  const idPlanov = [...zdroj.keys()];
  log.info("aktívne plány", { planov: idPlanov.length });

  // Plány, ktoré cieľ pozná ako aktívne, ale zdroj ich už nevracia — kandidáti
  // na zrušené predstavenie.
  const { data: nasePlany, error } = await ciel()
    .from("om_events")
    .select("id_plan")
    .is("cancelled_at", null);
  if (error) throw new Error(`Podujatia: ${error.message}`);

  const cielP = idPlanov.length ? await cielovePocty(idPlanov) : new Map();

  const zaznamy = [];
  let opravenych = 0;

  for (const idPlan of idPlanov) {
    const zdrojoveP = zdroj.get(idPlan);
    const cieloveP = dopocitaj(zdrojoveP, cielP.get(idPlan));
    const rozdiel = porovnaj(zdrojoveP, cieloveP);
    if (!Object.keys(rozdiel).length) {
      zaznamy.push({
        id_plan: idPlan,
        status: "ok",
        source_counts: zdrojoveP,
        target_counts: cieloveP,
      });
      continue;
    }
    const riadkov = await dotiahniPlan(idPlan, { dryRun, log });
    opravenych++;
    log.warn("nezhoda počtov, dotiahnutý plný výpis", { id_plan: idPlan, rozdiel, riadkov });
    zaznamy.push({
      id_plan: idPlan,
      status: dryRun ? "mismatch" : "repaired",
      source_counts: zdrojoveP,
      target_counts: cieloveP,
      diff: rozdiel,
      rows_refetched: riadkov,
      repaired_at: dryRun ? null : new Date().toISOString(),
    });
  }

  // Zmiznuté predstavenia: v cieli sú, v okne zdroja nie sú. Plán mimo okna
  // ešte nie je zrušený, preto sa existencia overuje proti celej tabuľke `plan`
  // — ale **jedným dotazom**, nie dotazom na každý plán zvlášť. Pri siedmich
  // tisícoch podujatí je to rozdiel medzi jednou sekundou a niekoľkými minútami.
  const podozrive = (nasePlany ?? []).map((r) => Number(r.id_plan)).filter((id) => !zdroj.has(id));

  const existujuce = new Set();
  for (let i = 0; i < podozrive.length; i += 1000) {
    const cast = podozrive.slice(i, i + 1000);
    const najdene = await dotaz(`SELECT p.id_plan FROM plan p WHERE p.id_plan IN (?)`, [cast]);
    for (const r of najdene) existujuce.add(Number(r.id_plan));
  }
  const chybajuce = podozrive.filter((id) => !existujuce.has(id));

  if (chybajuce.length && !dryRun) {
    // Zrušené predstavenie aj s jeho vstupenkami.
    await ciel()
      .from("om_events")
      .update({ cancelled_at: new Date().toISOString() })
      .in("id_plan", chybajuce);
    await ciel()
      .from("om_tickets")
      .update({ vanished_at: new Date().toISOString() })
      .in("id_plan", chybajuce)
      .is("vanished_at", null);
  }
  if (chybajuce.length) {
    log.warn("predstavenia zmizli zo zdroja, označené ako zrušené", { plany: chybajuce });
    for (const idPlan of chybajuce) {
      zaznamy.push({ id_plan: idPlan, status: "plan_missing" });
    }
  }

  if (!dryRun && zaznamy.length) {
    const { error: e } = await ciel().from("om_reconcile_log").insert(zaznamy);
    if (e) log.warn("zápis do om_reconcile_log zlyhal", { chyba: e.message });
  }

  await ulozKurzor(kanal, {
    hodnota: { checked_at: new Date().toISOString() },
    riadkov: idPlanov.length,
    dryRun,
  });

  log.info("hotovo", { planov: idPlanov.length, nezhod: opravenych, zmiznutych: chybajuce.length });
  return { planov: idPlanov.length, nezhod: opravenych, zmiznutych: chybajuce.length };
}
