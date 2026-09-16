// Kanál A — vstupenky. Hlavný a jediný úplný zdroj.
//
// Kurzor je dvojica `(seat.modified, seat.id_seat)`. `modified` je v OM
// `ON UPDATE current_timestamp()` s vlastným indexom, takže zachytí každú
// zmenu miesta: predaj cez `FinalizeOMSale`, predaj na pokladni aj cez
// partnerské rozhranie, dopárovanie platby k rezervácii, storno, refund
// aj zmenu ceny.
//
// Dve pravidlá, ktoré sa nesmú porušiť:
//
//  1. **Žiadny filter na stav vo `WHERE`.** Dotaz číta všetky zmenené riadky
//     vrátane prechodu do stavu 1 (storno) a 2 (blokované). Klasifikácia patrí
//     do cieľa — filter v zdrojovom dotaze by storná zneviditeľnil.
//  2. **Nikdy `id_seat > lastId`.** Riadok v `seat` vzniká už pri založení
//     predstavenia ako voľné miesto, takže rastúce id neznamená nový predaj.

import { createHash } from "node:crypto";
import { dotaz, naIso, naCislo, naText, odpocitajMinuty } from "../lib/source.js";
import { upsert, nacitajKurzor, ulozKurzor, ciel } from "../lib/target.js";
import { jePredaj, kategoria } from "../lib/ciselnik.js";

export const kanal = "A";
export const popis = "vstupenky (seat.modified)";

const LIMIT = 5000;
// Kryje riadky, ktoré sa potvrdili neskôr, než bola prečítaná ich hodnota
// `modified` (dlhá transakcia). Duplicity zahodí upsert.
const PREKRYV_MINUT = 5;

const STLPCE = `
  s.id_seat, s.id_plan, s.id_theater_seat, s.id_seat_status, s.id_seat_note,
  s.id_invoice, s.id_person, s.id_person2, s.price, s.discount, s.system_cost,
  s.id_discount, s.id_discount2, s.id_payment, s.id_expenses, s.barcode,
  s.scan, s.id_seat_category, s.id_reservation, s.id_sys_user,
  s.changed, s.modified`;

/**
 * Odvodená objednávka pre predaj bez hlavičky `seat_note` (36,7 % predaja).
 *
 * Počíta sa **iba pri prvom videní vstupenky** — `changed` sa môže neskôr
 * posunúť a objednávka by sa rozpadla na dve. Stráži to trigger v databáze,
 * ktorý pri UPDATE ponechá pôvodnú hodnotu; tu sa preto smie počítať vždy.
 */
export function odvodenaObjednavka(r) {
  if (r.id_seat_note != null) return null;
  if (!jePredaj(r.id_seat_status)) return null;
  const minuta = naIso(r.changed)?.slice(0, 16) ?? "";
  const zaklad = [r.id_plan, r.id_sys_user ?? 0, r.id_person ?? 0, minuta].join("|");
  return "d:" + createHash("md5").update(zaklad).digest("hex").slice(0, 24);
}

export function zmapuj(r) {
  return {
    id_seat: naCislo(r.id_seat),
    id_plan: naCislo(r.id_plan),
    id_theater_seat: naCislo(r.id_theater_seat),
    id_seat_status: naCislo(r.id_seat_status),
    id_seat_note: naCislo(r.id_seat_note),
    id_invoice: naCislo(r.id_invoice),
    id_person: naCislo(r.id_person),
    id_person2: naCislo(r.id_person2),
    price: r.price == null ? null : Number(r.price),
    discount: r.discount == null ? null : Number(r.discount),
    system_cost: r.system_cost == null ? null : Number(r.system_cost),
    id_discount: naCislo(r.id_discount),
    id_discount2: naCislo(r.id_discount2),
    id_payment: naCislo(r.id_payment),
    id_expenses: naCislo(r.id_expenses),
    // `barcode` chodí ako reťazec (bigNumberStrings) — do Postgresu ide číslo.
    barcode: r.barcode == null ? null : Number(r.barcode),
    scan: naCislo(r.scan) ?? 0,
    id_seat_category: naCislo(r.id_seat_category),
    id_reservation: naCislo(r.id_reservation),
    id_sys_user: naCislo(r.id_sys_user),
    changed_at: naIso(r.changed),
    modified_at: naIso(r.modified),
    synthetic_order_key: odvodenaObjednavka(r),
    // `category` a `suspicious` dopĺňa trigger — worker o stavoch nerozhoduje.
    raw: rawPreKategoriu(r),
  };
}

/**
 * `raw` sa ukladá len pre predaj, permanentky a rezervácie.
 *
 * Je to hlavný žrút miesta — celý zdrojový riadok ako JSON aj s kľúčmi. Pri
 * blokovaných miestach a voľných sedadlách z neho nikto nikdy nič nečítal a sú
 * to práve tie kategórie, ktoré tvoria objem (blokované boli 57 % všetkých zmien).
 *
 * Nie je to `null`, ale prázdny objekt: `om_tickets.raw` je v migrácii
 * `not null` a schému kvôli tomu nemeníme. Rozdiel v mieste je zanedbateľný,
 * rozdiel oproti celému riadku je rádový.
 */
export function rawPreKategoriu(r) {
  const k = kategoria(r.id_seat_status);
  if (k !== "sold" && k !== "abo" && k !== "pending") return {};
  return Object.fromEntries(Object.entries(r).map(([k2, v]) => [k2, naText(v)]));
}

/**
 * Voľné miesta sa do cieľa **nevkladajú**.
 *
 * Riadok v `seat` vzniká pre každé miesto každého predstavenia, takže voľné
 * sedadlá tvoria drvivú väčšinu tabuľky (na dev 305 tis. z 882 tis.) a ako
 * vstupenka nemajú žiadnu hodnotu. Prenášať ich treba len vtedy, keď je to
 * **výsledok storna** — teda keď to isté `id_seat` už v cieli je ako predaná
 * vstupenka. Bez toho by storno zostalo neviditeľné (scenáre T3, T4).
 *
 * Kontrola počtov si preto voľné miesta dopočítava, nepočíta ich z uložených
 * riadkov — pozri channels/counts.js.
 */
export function rozdelVolne(mapovane) {
  const volne = [];
  const ostatne = [];
  for (const r of mapovane) {
    (kategoria(r.id_seat_status) === "free" ? volne : ostatne).push(r);
  }
  return { volne, ostatne };
}

/** Z voľných miest prejdú len tie, ktoré cieľ už pozná — teda storná. */
export function vyberNaZapis({ volne, ostatne }, existujuce) {
  const storna = volne.filter((r) => existujuce.has(Number(r.id_seat)));
  return { riadky: [...ostatne, ...storna], preskocenych: volne.length - storna.length };
}

async function odfiltrujVolne(mapovane, { dryRun, log }) {
  const rozdelene = rozdelVolne(mapovane);
  if (!rozdelene.volne.length) return { riadky: mapovane, preskocenych: 0 };

  // Pri suchom behu sa cieľ nedopytuje — nevieme, čo v ňom je, tak sa voľné
  // len spočítajú.
  if (dryRun) return { riadky: rozdelene.ostatne, preskocenych: rozdelene.volne.length };

  const existujuce = new Set();
  const idcka = rozdelene.volne.map((r) => r.id_seat);
  // `in()` ide v PostgREST cez URL, preto po častiach.
  for (let i = 0; i < idcka.length; i += 500) {
    const cast = idcka.slice(i, i + 500);
    const { data, error } = await ciel().from("om_tickets").select("id_seat").in("id_seat", cast);
    if (error) throw new Error(`Kontrola existujúcich miest: ${error.message}`);
    for (const r of data) existujuce.add(Number(r.id_seat));
  }

  const vysledok = vyberNaZapis(rozdelene, existujuce);
  const storn = rozdelene.volne.length - vysledok.preskocenych;
  if (storn) log.debug("storná (miesto sa vrátilo do predaja)", { pocet: storn });
  return vysledok;
}

export async function spusti({ dryRun = false, full = false, since, log, maxDavok = Infinity }) {
  const ulozeny = await nacitajKurzor(kanal);

  // Orezanie na miesta podujatí od dátumu. `seat` má na produkcii desiatky
  // miliónov riadkov a drvivá väčšina patrí odohraným predstaveniam, ktoré
  // nepotrebujeme. Filter drží kurzor, takže inkrementálny beh po backfille
  // pokračuje s tým istým orezaním a nezačne ťahať históriu, ktorú sme vynechali.
  const odDatumu = since ?? ulozeny.since ?? null;

  // Prvé naplnenie ide od nuly; inak sa odkrojí prekryv.
  let odModified = full
    ? "1970-01-01 00:00:00"
    : (odpocitajMinuty(ulozeny.modified, PREKRYV_MINUT) ?? "1970-01-01 00:00:00");
  // Vždy 0: prekryv sa odkrojil z `modified`, takže v tej sekunde chceme
  // všetky miesta, nielen tie za posledným videným id.
  let odIdSeat = 0;

  let spolu = 0;
  let zapisanych = 0;
  let volnychPreskocenych = 0;
  let davok = 0;
  let posledny = { modified: ulozeny.modified ?? null, id_seat: ulozeny.id_seat ?? null };
  const videneStavy = new Set();

  log.info("štart", { od: odModified, dryRun, full, since: odDatumu });

  while (davok < maxDavok) {
    const riadky = await dotaz(
      `SELECT ${STLPCE}
         FROM seat s
        WHERE ((s.modified > ?) OR (s.modified = ? AND s.id_seat > ?))
          ${odDatumu ? "AND s.id_plan IN (SELECT p.id_plan FROM plan p WHERE p.datum >= ?)" : ""}
        ORDER BY s.modified, s.id_seat
        LIMIT ${LIMIT}`,
      odDatumu ? [odModified, odModified, odIdSeat, odDatumu] : [odModified, odModified, odIdSeat],
    );
    if (!riadky.length) break;

    const mapovane = riadky.map(zmapuj);
    for (const r of riadky) videneStavy.add(Number(r.id_seat_status));

    const { riadky: naZapis, preskocenych } = await odfiltrujVolne(mapovane, { dryRun, log });
    volnychPreskocenych += preskocenych;

    await upsert("om_tickets", naZapis, "id_seat", { dryRun, log });
    zapisanych += naZapis.length;

    const p = riadky[riadky.length - 1];
    odModified = String(p.modified);
    odIdSeat = Number(p.id_seat);
    posledny = { modified: odModified, id_seat: odIdSeat };

    spolu += riadky.length;
    davok++;
    log.debug("dávka", { riadkov: riadky.length, spolu, poslednyModified: odModified });

    if (riadky.length < LIMIT) break;
  }

  await ulozKurzor(kanal, {
    hodnota: posledny.modified
      ? { ...posledny, prekryv_minut: PREKRYV_MINUT, since: odDatumu }
      : undefined,
    riadkov: spolu,
    dryRun,
  });

  log.info("hotovo", {
    precitanych: spolu,
    zapisanych,
    volnychPreskocenych,
    davok,
    kurzor: posledny,
    since: odDatumu,
  });
  return {
    riadkov: spolu,
    zapisanych,
    volnychPreskocenych,
    davok,
    kurzor: posledny,
    since: odDatumu,
    videneStavy: [...videneStavy].sort((a, b) => a - b),
  };
}
