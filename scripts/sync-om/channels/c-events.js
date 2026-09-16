// Kanál C — dôvod zmeny: storná, história a refundy.
//
// Kanál A povie, že miesto je zrazu voľné. Tento kanál povie **prečo, kedy
// a kto**. Sú to tri nezávislé tabuľky s tromi nezávislými kurzormi, preto
// aj tri kanály: C1, C2, C3.
//
// `storno_seat_log` je nutný **aj popri** `seat_history`: storno pre
// organizátora do histórie nezapisuje vôbec (scenár T4).

import { dotaz, naIso, naCislo, naText, naLokalny } from "../lib/source.js";
import { upsert, nacitajKurzor, ulozKurzor } from "../lib/target.js";

const LIMIT = 1000;

function surovy(r) {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, naText(v)]));
}

/**
 * Spoločná slučka pre kanály s čistým kurzorom `id > lastId`.
 *
 * `orezanie` je kus SQL, ktorý sa vloží do `WHERE` pri zadanom `--since`.
 * Tabuľky s `id_plan` (`seat_history`, `seat_note_refund`) sa orežú cezeň;
 * `storno_seat_log` `id_plan` nemá, takže sa neorezáva — je to malá tabuľka
 * a storná starých podujatí nikomu neprekážajú.
 */
async function podlaId({
  kanal,
  tabulka,
  pk,
  sql,
  zmapuj,
  orezanie,
  dryRun,
  full,
  since,
  log,
  maxDavok,
}) {
  const ulozeny = await nacitajKurzor(kanal);
  let odId = full ? 0 : Number(ulozeny.last_id) || 0;
  const odDatumu = orezanie ? (since ?? ulozeny.since ?? null) : null;
  let spolu = 0;
  let davok = 0;

  log.info("štart", { odId, dryRun, full, since: odDatumu });

  while (davok < maxDavok) {
    const dotazSql = sql.replace("/*OREZANIE*/", odDatumu ? orezanie : "");
    const riadky = await dotaz(dotazSql, odDatumu ? [odId, odDatumu, LIMIT] : [odId, LIMIT]);
    if (!riadky.length) break;

    await upsert(tabulka, riadky.map(zmapuj), pk, { dryRun, log });

    odId = Number(riadky[riadky.length - 1][pk]);
    spolu += riadky.length;
    davok++;
    log.debug("dávka", { riadkov: riadky.length, spolu, poslednyId: odId });
    if (riadky.length < LIMIT) break;
  }

  await ulozKurzor(kanal, { hodnota: { last_id: odId, since: odDatumu }, riadkov: spolu, dryRun });
  log.info("hotovo", { riadkov: spolu, davok, kurzor: odId, since: odDatumu });
  return { riadkov: spolu, davok, kurzor: odId, since: odDatumu };
}

// --- C1: storná ------------------------------------------------------------

export const c1 = {
  kanal: "C1",
  popis: "storná (storno_seat_log)",
  spusti: (o) =>
    podlaId({
      ...o,
      kanal: "C1",
      tabulka: "om_storno_log",
      pk: "id_storno_seat_log",
      sql: `SELECT l.id_storno_seat_log, l.id_seat, l.id_seat_status, l.id_sys_user,
                   l.id_person, l.id_person2, l.id_discount, l.id_discount2, l.id_invoice,
                   l.id_reservation, l.id_seat_note, l.id_payment, l.id_expenses,
                   l.mifare, l.id_mifare, l.price, l.discount, l.printed, l.barcode,
                   l.log_user_id, l.created
              FROM storno_seat_log l
             WHERE l.id_storno_seat_log > ?
             /*OREZANIE*/
             ORDER BY l.id_storno_seat_log
             LIMIT ?`,
      zmapuj: (r) => ({
        id_storno_seat_log: naCislo(r.id_storno_seat_log),
        id_seat: naCislo(r.id_seat),
        id_seat_status: naCislo(r.id_seat_status),
        id_sys_user: naCislo(r.id_sys_user),
        id_person: naCislo(r.id_person),
        id_person2: naCislo(r.id_person2),
        id_discount: naCislo(r.id_discount),
        id_discount2: naCislo(r.id_discount2),
        id_invoice: naCislo(r.id_invoice),
        id_reservation: naCislo(r.id_reservation),
        id_seat_note: naCislo(r.id_seat_note),
        id_payment: naCislo(r.id_payment),
        id_expenses: naCislo(r.id_expenses),
        mifare: naText(r.mifare),
        id_mifare: naCislo(r.id_mifare),
        price: r.price == null ? null : Number(r.price),
        discount: r.discount == null ? null : Number(r.discount),
        printed: naCislo(r.printed),
        // Čiarový kód spred storna — po storne sa `seat.barcode` zvýši o 1.
        barcode: r.barcode == null ? null : Number(r.barcode),
        log_user_id: naCislo(r.log_user_id),
        // Jediný spoľahlivý čas storna (DB default, kód ho nevkladá).
        created_at: naIso(r.created),
        raw: surovy(r),
      }),
    }),
};

// --- C2: história zmien ----------------------------------------------------

export const c2 = {
  kanal: "C2",
  popis: "história zmien miesta (seat_history)",
  spusti: (o) =>
    podlaId({
      ...o,
      kanal: "C2",
      tabulka: "om_seat_history",
      pk: "id_seat_history",
      sql: `SELECT h.id_seat_history, h.id_seat, h.id_plan, h.id_seat_note, h.id_seat_status,
                   h.price, h.discount, h.id_invoice, h.id_payment, h.operation_type,
                   h.id_storno_user, h.changed, h.barcode
              FROM seat_history h
             WHERE h.id_seat_history > ?
             /*OREZANIE*/
             ORDER BY h.id_seat_history
             LIMIT ?`,
      orezanie: "AND h.id_plan IN (SELECT p.id_plan FROM plan p WHERE p.datum >= ?)",
      zmapuj: (r) => ({
        id_seat_history: naCislo(r.id_seat_history),
        id_seat: naCislo(r.id_seat),
        id_plan: naCislo(r.id_plan),
        id_seat_note: naCislo(r.id_seat_note),
        id_seat_status: naCislo(r.id_seat_status),
        price: r.price == null ? null : Number(r.price),
        discount: r.discount == null ? null : Number(r.discount),
        id_invoice: naCislo(r.id_invoice),
        id_payment: naCislo(r.id_payment),
        operation_type: naCislo(r.operation_type),
        id_storno_user: naCislo(r.id_storno_user),
        barcode: r.barcode == null ? null : Number(r.barcode),
        // Kópia `seat.changed`, NIE čas vzniku riadku histórie.
        original_changed: naIso(r.changed),
        raw: surovy(r),
      }),
    }),
};

// --- C3: refundy -----------------------------------------------------------
// Kurzor je hybridný. Refund sa vybavuje UPDATE-om existujúceho riadku, takže
// čistý `id > lastId` by dokončený refund už nikdy nezachytil.

export const c3 = {
  kanal: "C3",
  popis: "refundy (seat_note_refund)",
  async spusti({ dryRun = false, full = false, since, log, maxDavok = Infinity }) {
    const ulozeny = await nacitajKurzor("C3");
    let odId = full ? 0 : Number(ulozeny.last_id) || 0;
    // `seat_note_refund` má `id_plan` aj index na ňom.
    const odDatumu = since ?? ulozeny.since ?? null;
    // Okno na dokončené refundy; pri plnom naplnení od začiatku.
    const od = full
      ? "1970-01-01 00:00:00"
      : (ulozeny.okno ?? naLokalny(new Date(Date.now() - 7 * 86_400_000)));

    let spolu = 0;
    let davok = 0;
    let maxId = odId;

    log.info("štart", { odId, od, dryRun, full, since: odDatumu });

    while (davok < maxDavok) {
      const riadky = await dotaz(
        `SELECT r.id_seat_note_refund, r.id_seat_note, r.id_plan, r.date_request,
                r.days_to_refund, r.processed, r.id_sys_user, r.date_refund, r.date_refund_email
           FROM seat_note_refund r
          WHERE (r.id_seat_note_refund > ?
                 OR r.date_refund >= ?
                 OR r.date_refund_email >= ?)
            ${odDatumu ? "AND r.id_plan IN (SELECT p.id_plan FROM plan p WHERE p.datum >= ?)" : ""}
          ORDER BY r.id_seat_note_refund
          LIMIT ?`,
        odDatumu ? [odId, od, od, odDatumu, LIMIT] : [odId, od, od, LIMIT],
      );
      if (!riadky.length) break;

      await upsert(
        "om_refunds",
        riadky.map((r) => ({
          id_seat_note_refund: naCislo(r.id_seat_note_refund),
          id_seat_note: naCislo(r.id_seat_note),
          id_plan: naCislo(r.id_plan),
          date_request: naIso(r.date_request),
          days_to_refund: naCislo(r.days_to_refund),
          processed: naCislo(r.processed),
          id_sys_user: naCislo(r.id_sys_user),
          date_refund: naIso(r.date_refund),
          date_refund_email: naIso(r.date_refund_email),
          raw: surovy(r),
        })),
        "id_seat_note_refund",
        { dryRun, log },
      );

      const posledny = Number(riadky[riadky.length - 1].id_seat_note_refund);
      spolu += riadky.length;
      davok++;
      // Dokončené refundy zo starých riadkov by inak kurzor zacyklili.
      if (posledny <= odId) break;
      odId = posledny;
      maxId = Math.max(maxId, posledny);
      if (riadky.length < LIMIT) break;
    }

    await ulozKurzor("C3", {
      // `okno` je posuvné okno na dokončené refundy, `since` je orezanie
      // na podujatia — sú to dve rôzne veci a nesmú si prepísať hodnotu.
      hodnota: {
        last_id: maxId,
        okno: naLokalny(new Date(Date.now() - 7 * 86_400_000)),
        since: odDatumu,
      },
      riadkov: spolu,
      dryRun,
    });
    log.info("hotovo", { riadkov: spolu, davok, kurzor: maxId, since: odDatumu });
    return { riadkov: spolu, davok, kurzor: maxId, since: odDatumu };
  },
};
