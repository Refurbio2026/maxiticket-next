// Akceptačné scenáre T1–T10 zo špecifikácie (`docs/spec-ticket-sync.md`, kap. 7)
// proti fixture dátam.
//
// Scenáre, ktoré sa rozhodujú v JavaScripte (mapovanie, odvodená objednávka,
// klasifikácia), bežia vždy. Scenáre, ktoré sa rozhodujú v SQL (poradie skenov,
// idempotencia upsertu, kontrola počtov), bežia proti databáze v transakcii
// s ROLLBACK — bez prístupu k nej sa preskočia, nie „prejdú".

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { nastavCiselnik } from "../lib/ciselnik.js";
import {
  naIso,
  naDatum,
  naCas,
  naCislo,
  naText,
  odpocitajMinuty,
  naLokalny,
} from "../lib/source.js";
import {
  zmapuj,
  odvodenaObjednavka,
  rawPreKategoriu,
  rozdelVolne,
  vyberNaZapis,
} from "../channels/a-tickets.js";
import { PrekrocenyLimit, overLimit } from "../lib/velkost.js";
import { zmapuj as zmapujPlan } from "../channels/e-events.js";
import { sql, dostupnaDb } from "./db.js";
import * as F from "./fixtures.js";

// Zhoda s tým, čo migrácia zapisuje do `om_seat_status`.
const CISELNIK = [
  ...[6, 7, 9, 13, 15, 17, 18, 19, 21, 23, 24, 27, 28].map((id) => ({
    id_seat_status: id,
    category: "sold",
    suspicious_when_free: id === 15,
  })),
  ...[5, 14, 26].map((id) => ({
    id_seat_status: id,
    category: "abo",
    suspicious_when_free: false,
  })),
  ...[11, 20].map((id) => ({
    id_seat_status: id,
    category: "pending",
    suspicious_when_free: false,
  })),
  { id_seat_status: 2, category: "blocked", suspicious_when_free: false },
  { id_seat_status: 1, category: "free", suspicious_when_free: false },
  { id_seat_status: 25, category: "other", suspicious_when_free: false },
];

before(() => nastavCiselnik(CISELNIK));

describe("T1 – online predaj 2 vstupeniek", () => {
  test("kanál A zmapuje vstupenku so stavom predaja a posunutým modified", () => {
    const v = zmapuj(F.onlinePredaj);
    assert.equal(v.id_seat, 1980240);
    assert.equal(v.id_seat_status, 23);
    assert.equal(v.id_seat_note, 55001, "hlavička objednávky sa prenáša");
    assert.equal(v.price, 24);
    assert.equal(v.barcode, 54840679, "bigint z mysql2 chodí ako reťazec, do cieľa ide číslo");
    assert.equal(v.modified_at, "2026-09-16T07:15:22.000Z", "letný čas, CEST +02:00");
  });

  test("vstupenka s hlavičkou nedostáva odvodenú objednávku", () => {
    assert.equal(odvodenaObjednavka(F.onlinePredaj), null);
  });
});

describe("T2 – rezervácia prevodom, neskôr zaplatená", () => {
  test("rezervácia je pending, nie predaj", () => {
    const v = zmapuj(F.rezervacia);
    assert.equal(v.id_seat_status, 11);
    assert.equal(odvodenaObjednavka(F.rezervacia), null, "rezervácia nie je predaj");
  });

  test("po spárovaní platby sa posunie modified a stav je predaj", () => {
    const pred = zmapuj(F.rezervacia);
    const po = zmapuj(F.rezervaciaZaplatena);
    assert.equal(po.id_seat, pred.id_seat, "je to to isté miesto");
    assert.equal(po.id_seat_status, 23);
    assert.ok(po.modified_at > pred.modified_at, "kanál A to zachytí podľa modified");
  });
});

describe("T3/T4 – storno", () => {
  test("miesto sa vráti do stavu 1 a čiarový kód sa zvýši o 1", () => {
    const pred = zmapuj(F.onlinePredaj);
    const po = zmapuj(F.poStorne);
    assert.equal(po.id_seat_status, 1, "stav 1 musí prejsť — filter na stav vo WHERE by ho skryl");
    assert.equal(po.barcode, pred.barcode + 1, "preto barcode nie je stabilný kľúč");
    assert.equal(po.id_seat_note, null);
  });

  test("stornované miesto nedostane odvodenú objednávku", () => {
    assert.equal(odvodenaObjednavka(F.poStorne), null);
  });
});

describe("T7 – predaj na pokladni bez hlavičky objednávky", () => {
  test("vstupenka bez id_seat_note je platná a dostane odvodenú objednávku", () => {
    const v = zmapuj(F.pokladnicnyPredaj);
    assert.equal(v.id_seat_note, null, "36,7 % predaja hlavičku nemá — nie je to chyba");
    assert.equal(v.id_sys_user, 42, "predajca je jediná stopa, kto predal");
    assert.match(v.synthetic_order_key, /^d:[0-9a-f]{24}$/);
  });

  test("dve miesta z jedného nákupu pri kase majú rovnaký kľúč", () => {
    assert.equal(
      odvodenaObjednavka(F.pokladnicnyPredaj),
      odvodenaObjednavka(F.pokladnicnyPredajDruheMiesto),
      "18:31:07 a 18:31:19 padnú do tej istej minúty",
    );
  });

  test("nákup o dve minúty neskôr je iná objednávka", () => {
    assert.notEqual(
      odvodenaObjednavka(F.pokladnicnyPredaj),
      odvodenaObjednavka(F.pokladnicnyPredajInyNakup),
    );
  });

  test("kľúč je deterministický — opakovaný beh dá tú istú hodnotu", () => {
    assert.equal(odvodenaObjednavka(F.pokladnicnyPredaj), odvodenaObjednavka(F.pokladnicnyPredaj));
  });
});

describe("Klasifikácia stavov (spec 3.1)", () => {
  test("stav 15 s nulovou cenou a bez hlavičky je podozrivý", async (t) => {
    if (!(await dostupnaDb())) return t.skip("bez prístupu k databáze");
    const r = await sql(`
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, id_seat_note, modified_at, raw)
        values (990001, 900, 15, 0, null, now(), '{}');
      select category, suspicious from om_tickets where id_seat = 990001`);
    assert.equal(r[0].category, "sold");
    assert.equal(
      r[0].suspicious,
      true,
      "Triton.php:657 zapisuje SEAT_STORNO=15 pri zrušení rezervácie",
    );
  });

  test("stav 15 so skutočnou cenou podozrivý nie je", async (t) => {
    if (!(await dostupnaDb())) return t.skip("bez prístupu k databáze");
    const r = await sql(`
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, id_seat_note, modified_at, raw)
        values (990002, 900, 15, 18.00, null, now(), '{}');
      select suspicious from om_tickets where id_seat = 990002`);
    assert.equal(r[0].suspicious, false);
  });

  test("blokované miesto s hlavičkou je blocked, nie sold", async (t) => {
    if (!(await dostupnaDb())) return t.skip("bez prístupu k databáze");
    const r = await sql(`
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, id_seat_note, modified_at, raw)
        values (990003, 900, 2, 0, 55009, now(), '{}');
      select category from om_tickets where id_seat = 990003`);
    assert.equal(r[0].category, "blocked", "klasifikuje sa podľa stavu, nikdy podľa id_seat_note");
  });

  test("neznámy stav nezhodí dávku, dostane other", async (t) => {
    if (!(await dostupnaDb())) return t.skip("bez prístupu k databáze");
    const r = await sql(`
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, modified_at, raw)
        values (990004, 900, 99, 0, now(), '{}');
      select category from om_tickets where id_seat = 990004`);
    assert.equal(r[0].category, "other");
  });
});

describe("T5 – kontrola vstupenky na bráne", () => {
  test("po skene je stav scanned a čas je zo seat_scan", async (t) => {
    if (!(await dostupnaDb())) return t.skip("bez prístupu k databáze");
    const r = await sql(`
      insert into om_events (id_plan, datum, drama_name, raw) values (901, '2026-09-20', 'T5', '{}');
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, barcode, scan, modified_at, raw)
        values (990101, 901, 23, 20, 700001, 1, now(), '{}');
      insert into om_scans (id_seat_scan, id_plan, barcode, scan_type, online, scan_time, raw)
        values (9001, 901, 700001, 0, 1, '2026-09-20 18:05:00+00', '{}');
      select state, scanned_at from tickets_unified where om_id_seat = 990101`);
    assert.equal(r[0].state, "scanned");
    assert.match(r[0].scanned_at, /18:05/);
  });
});

describe("T6 – offline sken nahraný neskôr", () => {
  test("stav sa počíta v poradí scan_time, nie podľa id_seat_scan", async (t) => {
    if (!(await dostupnaDb())) return t.skip("bez prístupu k databáze");
    // id 9011 = zrušenie skenu o 12:00, id 9020 = offline sken vykonaný o 13:00
    const neskorsi = await sql(`
      insert into om_events (id_plan, datum, drama_name, raw) values (902, '2026-09-20', 'T6', '{}');
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, barcode, scan, modified_at, raw)
        values (990201, 902, 23, 20, 700002, 1, now(), '{}');
      insert into om_scans (id_seat_scan, id_plan, barcode, scan_type, online, scan_time, raw) values
        (9011, 902, 700002, 1, 1, '2026-09-20 12:00:00+00', '{}'),
        (9020, 902, 700002, 0, 0, '2026-09-20 13:00:00+00', '{}');
      select state from tickets_unified where om_id_seat = 990201`);
    assert.equal(neskorsi[0].state, "scanned", "offline sken je novší, takže platí");

    // ten istý pár, ale offline sken je starší než zrušenie
    const starsi = await sql(`
      insert into om_events (id_plan, datum, drama_name, raw) values (903, '2026-09-20', 'T6b', '{}');
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, barcode, scan, modified_at, raw)
        values (990301, 903, 23, 20, 700003, 1, now(), '{}');
      insert into om_scans (id_seat_scan, id_plan, barcode, scan_type, online, scan_time, raw) values
        (9031, 903, 700003, 1, 1, '2026-09-20 14:00:00+00', '{}'),
        (9040, 903, 700003, 0, 0, '2026-09-20 11:00:00+00', '{}');
      select state from tickets_unified where om_id_seat = 990301`);
    assert.equal(
      starsi[0].state,
      "valid",
      "vyššie id, ale starší čas — zrušenie skenu platí ďalej",
    );
  });

  test("sken spred storna sa dopáruje cez storno_seat_log", async (t) => {
    if (!(await dostupnaDb())) return t.skip("bez prístupu k databáze");
    const r = await sql(`
      insert into om_events (id_plan, datum, drama_name, raw) values (904, '2026-09-20', 'T6c', '{}');
      -- vstupenka má po storne barcode o 1 vyšší
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, barcode, modified_at, raw)
        values (990401, 904, 1, 0, 700011, now(), '{}');
      insert into om_storno_log (id_storno_seat_log, id_seat, barcode, created_at, raw)
        values (8001, 990401, 700010, now(), '{}');
      insert into om_scans (id_seat_scan, id_plan, barcode, scan_type, online, scan_time, raw)
        values (9050, 904, 700010, 0, 1, '2026-09-20 10:00:00+00', '{}');
      select om_doparuj_skeny();
      select matched_id_seat, unmatched_reason from om_scans where id_seat_scan = 9050`);
    assert.equal(Number(r[0].matched_id_seat), 990401);
    assert.equal(r[0].unmatched_reason, "barcode_rotated");
  });
});

describe("T8 – opakovaný beh dávky a kurzor posunutý dozadu", () => {
  test("opakovaný upsert nevytvorí duplicitu", async (t) => {
    if (!(await dostupnaDb())) return t.skip("bez prístupu k databáze");
    const r = await sql(`
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, modified_at, raw)
        values (990501, 905, 23, 20, now(), '{}')
        on conflict (id_seat) do update set price = excluded.price;
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, modified_at, raw)
        values (990501, 905, 23, 20, now(), '{}')
        on conflict (id_seat) do update set price = excluded.price;
      select count(*)::int as pocet from om_tickets where id_seat = 990501`);
    assert.equal(r[0].pocet, 1);
  });

  test("odvodená objednávka a first_seen_at prežijú opakovaný zápis", async (t) => {
    if (!(await dostupnaDb())) return t.skip("bez prístupu k databáze");
    const r = await sql(`
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, modified_at, raw, synthetic_order_key)
        values (990601, 906, 6, 20, now(), '{}', 'd:prvy');
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, modified_at, raw, synthetic_order_key, first_seen_at)
        values (990601, 906, 6, 25, now(), '{}', 'd:druhy', '2000-01-01')
        on conflict (id_seat) do update set price = excluded.price,
             synthetic_order_key = excluded.synthetic_order_key,
             first_seen_at = excluded.first_seen_at;
      select synthetic_order_key, (first_seen_at > '2020-01-01') as zachovany, price
        from om_tickets where id_seat = 990601`);
    assert.equal(
      r[0].synthetic_order_key,
      "d:prvy",
      "changed sa môže posunúť, objednávka sa nesmie rozpadnúť",
    );
    assert.equal(r[0].zachovany, true);
    assert.equal(Number(r[0].price), 25, "ostatné stĺpce sa aktualizovať majú");
  });
});

describe("T9 – preloženie termínu a premenovanie podujatia", () => {
  test("plan sa zmapuje aj s typmi, ktoré nie sú datetime", () => {
    const p = zmapujPlan(F.plan);
    assert.equal(p.datum, "2026-10-04");
    assert.equal(p.start_time, "19:00:00", "plan.start je v OM `time`, nie datetime");
    assert.equal(p.end_time, "21:30:00");
    assert.equal(p.show_hash, 4821993, "mediumint, nie text");
    assert.equal(p.require_access_code, 0, "bit(1) chodí ako Buffer");
    assert.equal(p.vat, 23);
    assert.equal(
      p.drama_name,
      "Kvet Tisícich Ciest",
      "názov je denormalizovaný — drama nemá modified",
    );
    assert.equal(p.modified_at, "2026-09-16T06:00:00.000Z");
  });

  test("nulový dátum a chýbajúce modified nezhodia mapovanie", () => {
    const p = zmapujPlan(F.planBezModified);
    assert.equal(p.datum, null, '0000-00-00 je „nevyplnené", nie rok nula');
    assert.equal(p.door_time, null);
    assert.equal(p.modified_at, null, "kurzor dopadne na created cez COALESCE");
  });
});

describe("T10 – zrušenie predstavenia (zmazanie plan)", () => {
  test("kontrola počtov odhalí rozdiel a označí podujatie za zrušené", async (t) => {
    if (!(await dostupnaDb())) return t.skip("bez prístupu k databáze");
    const r = await sql(`
      insert into om_events (id_plan, datum, drama_name, raw) values (907, '2026-09-25', 'T10', '{}');
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, modified_at, raw) values
        (990701, 907, 23, 20, now(), '{}'),
        (990702, 907, 2,  0,  now(), '{}'),
        (990703, 907, 1,  0,  now(), '{}');
      select * from om_pocty_podla_planu(array[907]::bigint[])`);
    assert.equal(Number(r[0].seats), 3);
    assert.equal(Number(r[0].sold), 1);
    assert.equal(Number(r[0].blocked), 1, "blokované sa rátajú zvlášť, nie ako voľné");
    assert.equal(Number(r[0].free), 1);

    const po = await sql(`
      insert into om_events (id_plan, datum, drama_name, raw) values (908, '2026-09-25', 'T10b', '{}');
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, modified_at, raw)
        values (990801, 908, 23, 20, now(), '{}');
      update om_events set cancelled_at = now() where id_plan = 908;
      update om_tickets set vanished_at = now() where id_plan = 908;
      select state from tickets_unified where om_id_seat = 990801`);
    assert.equal(po[0].state, "cancelled");
  });

  test("zmiznuté miesta sa nerátajú do počtov", async (t) => {
    if (!(await dostupnaDb())) return t.skip("bez prístupu k databáze");
    const r = await sql(`
      insert into om_events (id_plan, datum, drama_name, raw) values (909, '2026-09-25', 'T10c', '{}');
      insert into om_tickets (id_seat, id_plan, id_seat_status, price, modified_at, raw, vanished_at)
        values (990901, 909, 23, 20, now(), '{}', now());
      select coalesce((select seats from om_pocty_podla_planu(array[909]::bigint[])), 0) as seats`);
    assert.equal(Number(r[0].seats), 0, "inak by plán po zrušení navždy hlásil nezhodu");
  });
});

describe("Zmenšenie objemu: voľné miesta a raw", () => {
  test("voľné miesto sa nevloží, ak ho cieľ ešte nepozná", () => {
    const davka = [F.onlinePredaj, F.poStorne, F.pokladnicnyPredaj].map(zmapuj);
    const rozdelene = rozdelVolne(davka);
    assert.equal(rozdelene.volne.length, 1, "stav 1 je jediné voľné");
    assert.equal(rozdelene.ostatne.length, 2);

    const { riadky, preskocenych } = vyberNaZapis(rozdelene, new Set());
    assert.equal(preskocenych, 1, "cieľ to miesto nepozná, takže to nie je storno");
    assert.equal(riadky.length, 2);
    assert.ok(!riadky.some((r) => r.id_seat_status === 1));
  });

  test("voľné miesto sa vloží, ak ho cieľ pozná — to je storno (T3/T4)", () => {
    const davka = [F.poStorne].map(zmapuj);
    const rozdelene = rozdelVolne(davka);
    const { riadky, preskocenych } = vyberNaZapis(rozdelene, new Set([F.poStorne.id_seat]));
    assert.equal(preskocenych, 0);
    assert.equal(riadky.length, 1, "bez tohto by storno zostalo neviditeľné");
    assert.equal(riadky[0].id_seat_status, 1);
  });

  test("raw sa ukladá len pre predaj, permanentky a rezervácie", () => {
    assert.ok(Object.keys(rawPreKategoriu(F.onlinePredaj)).length > 10, "sold → celý riadok");
    assert.ok(Object.keys(rawPreKategoriu(F.rezervacia)).length > 10, "pending → celý riadok");
    // `om_tickets.raw` je `not null`, preto prázdny objekt a nie NULL.
    assert.deepEqual(rawPreKategoriu(F.blokovaneSHlavickou), {}, "blocked → prázdne");
    assert.deepEqual(rawPreKategoriu(F.poStorne), {}, "free → prázdne");
  });

  test("zmapuj to prenesie do výsledku", () => {
    assert.ok(Object.keys(zmapuj(F.onlinePredaj).raw).length > 10);
    assert.deepEqual(zmapuj(F.blokovaneSHlavickou).raw, {});
  });
});

describe("Poistka proti zaplneniu disku", () => {
  test("nad limitom sa beh zastaví", async () => {
    await assert.rejects(
      () => overLimit(null, async () => 999_999),
      (e) => e instanceof PrekrocenyLimit && /limit je/.test(e.message),
    );
  });

  test("pod limitom prejde a vráti veľkosť", async () => {
    const mb = await overLimit(null, async () => 1);
    assert.equal(mb, 1);
  });
});

describe("Prevod času zdroja", () => {
  test("letný aj zimný čas", () => {
    assert.equal(naIso("2026-07-16 10:00:00"), "2026-07-16T08:00:00.000Z", "CEST +02:00");
    assert.equal(naIso("2026-01-16 10:00:00"), "2026-01-16T09:00:00.000Z", "CET +01:00");
  });

  test("nulový dátum je null, nie rok nula", () => {
    assert.equal(naIso("0000-00-00 00:00:00"), null);
    assert.equal(naDatum("0000-00-00"), null);
  });

  test("prekryv kurzora sa odpočíta v zóne zdroja", () => {
    assert.equal(odpocitajMinuty("2026-07-16 10:02:00", 5), "2026-07-16 09:57:00");
  });

  test("spätný prevod je bezstratový", () => {
    assert.equal(naLokalny(naIso("2026-07-16 10:00:00")), "2026-07-16 10:00:00");
  });

  test("bit(1) nesmie do raw priniesť NUL — Postgres ho neprijme", () => {
    // `require_access_code` je bit(1); mysql2 ho vracia ako Buffer s bajtom 0x00.
    // Ako text by to bol U+0000 a celá dávka 1000 riadkov by padla na
    // „unsupported Unicode escape sequence".
    assert.equal(naText(Buffer.from([0])), "0x00");
    assert.equal(naText(Buffer.from([1])), "0x01");
    assert.ok(!JSON.stringify({ v: naText(Buffer.from([0])) }).includes("\\u0000"));
  });

  test("NUL a osamotený surrogát v texte sa očistia, diakritika prežije", () => {
    const NUL = String.fromCharCode(0);
    assert.equal(naText("Divadlo" + NUL + " Nitra"), "Divadlo Nitra");
    assert.equal(naText("Sála" + NUL), "Sála");
    assert.equal(naText("Hviezda Trenčín – zisťuje"), "Hviezda Trenčín – zisťuje");
    assert.equal(naText("Koncert \u{1F3B5}"), "Koncert \u{1F3B5}");
    const osamoteny = naText("Test " + String.fromCharCode(0xd800) + " koniec");
    assert.equal(osamoteny, "Test \uFFFD koniec");
  });

  test("bit(1) a tinyint sa čítajú rovnako", () => {
    assert.equal(naCislo(Buffer.from([1])), 1);
    assert.equal(naCislo(0), 0);
    assert.equal(naCislo(null), null);
    assert.equal(naCas("19:00:00"), "19:00:00");
  });
});
