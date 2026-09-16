// Kanál B — hlavičky objednávok.
//
// Kanál **iba obohacuje** vstupenky z kanála A. Vstupenka bez objednávky je
// platný a bežný stav, nie chyba syncu: hlavičku nemá 36,7 % predaja — celý
// externý predaj, voľné vstupenky a 71 % pokladničného. Pre tie sa objednávka
// odvodzuje zo `seat` cez `om_tickets.synthetic_order_key` (kanál A).
//
// `seat_note` nemá **žiadnu časovú značku**, preto kurzor ide podľa
// `id_seat_note`. Kvôli súbežným transakciám sa môže riadok s nižším id
// potvrdiť neskôr ako riadok s vyšším, takže každý beh začína od
// `lastId − 500`; duplicity zahodí upsert.
//
// Vstupenky sa tu **neťahajú** — prídu kanálom A.
//
// **Faktúra ani zákazník nie sú na hlavičke.** `seat_note` má v OM presne šesť
// stĺpcov (`id_seat_note`, `note`, `id_basket`, `referral`, `ip_address`,
// `id_affiliate`) a `invoice` väzbu na objednávku tiež nemá — jediné spojivo je
// riadok `seat`, ktorý nesie `id_invoice` aj `id_person`. Preto sa obe doťahujú
// cez `seat` zoskupený podľa `id_seat_note`.
//
// Overené na dev RDS (200 000 objednávok): zákazníka má takto 99,5 % objednávok,
// faktúru 7,2 %. Keby sa `id_person` bralo z faktúry, ako to vyzeralo logické,
// zákazník by chýbal 93 % objednávok.

import { dotaz, naIso, naCislo, naText } from "../lib/source.js";
import { upsert, nacitajKurzor, ulozKurzor } from "../lib/target.js";

export const kanal = "B";
export const popis = "hlavičky objednávok (seat_note.id_seat_note)";

const LIMIT = 1000;
const PREKRYV_ID = 500;

// Nastaví sa pri prvom odopretí prístupu k `mt_payments.basket` a ušetrí
// stovky rovnakých riadkov v logu.
let basketNedostupna = false;

function zmapujObjednavku(sn, vazba, fa, kosik) {
  return {
    id_seat_note: naCislo(sn.id_seat_note),
    vs: naText(sn.note),
    id_basket: naCislo(sn.id_basket),
    referral: naText(sn.referral),
    id_affiliate: naCislo(sn.id_affiliate),
    // Čas objednávky. `mt_payments.basket.ts` je presnejší, ale tabuľka sa
    // priebežne maže (na produkcii v nej boli 3 desiatky riadkov z jedného dňa),
    // takže pre čokoľvek staršie než pár hodín neexistuje. Záložný zdroj je
    // najstarší `seat.changed` objednávky — to isté, z čoho čas odvodzuje aj
    // starý systém.
    ordered_at: kosik ? naIso(kosik.ts) : naIso(vazba?.prve_changed),
    id_invoice: naCislo(vazba?.id_invoice),
    paid_at: fa ? naIso(fa.paid) : null,
    invoice_created_at: fa ? naIso(fa.changed) : null,
    // `invoice.reservation`: 0 = predaj, 2 = rezervácia.
    is_reservation: fa ? naCislo(fa.reservation) === 2 : null,
    total: fa?.total == null ? null : Number(fa.total),
    price: fa?.price == null ? null : Number(fa.price),
    discount: fa?.discount == null ? null : Number(fa.discount),
    order_number: naText(fa?.order_number),
    invoice_year: naCislo(fa?.invoice_year),
    invoice_number: naCislo(fa?.invoice_number),
    reservation_reminder: fa ? naIso(fa.reservation_reminder) : null,
    reservation_cancel: fa ? naIso(fa.reservation_cancel) : null,
    id_person: naCislo(vazba?.id_person),
    raw: {
      seat_note: Object.fromEntries(Object.entries(sn).map(([k, v]) => [k, naText(v)])),
      invoice: fa ? Object.fromEntries(Object.entries(fa).map(([k, v]) => [k, naText(v)])) : null,
      // 10 z 200 000 objednávok má viac než jednu faktúru a 15 viac než jedného
      // zákazníka. Berie sa najnižšie id, celý zoznam ostáva tu.
      vsetky_faktury: naText(vazba?.vsetky_faktury),
      vsetky_osoby: naText(vazba?.vsetky_osoby),
      // Odkiaľ je `ordered_at` — bez toho sa spätne nedá povedať, či je to
      // presný čas z košíka, alebo odvodený z miesta.
      zdroj_casu: kosik ? "basket" : vazba?.prve_changed ? "seat.changed" : null,
    },
  };
}

/** Osobné údaje idú do samostatnej tabuľky. `ip_address` sa neprenáša vôbec. */
function zmapujOsobu(p) {
  return {
    id_person: naCislo(p.id_person),
    name: naText(p.name),
    surname: naText(p.surname),
    email: naText(p.email),
    phone: naText(p.phone),
    raw: null,
  };
}

async function dotiahniKontext(hlavicky, log) {
  const idHlaviciek = hlavicky.map((h) => h.id_seat_note);
  const idKosikov = [...new Set(hlavicky.map((h) => h.id_basket).filter(Boolean))];

  // Faktúra a zákazník sú na `seat`, nie na hlavičke — pozri komentár hore.
  const vazby = idHlaviciek.length
    ? await dotaz(
        `SELECT s.id_seat_note,
                MIN(s.id_invoice) AS id_invoice,
                MIN(s.id_person)  AS id_person,
                MIN(s.changed)    AS prve_changed,
                GROUP_CONCAT(DISTINCT s.id_invoice) AS vsetky_faktury,
                GROUP_CONCAT(DISTINCT s.id_person)  AS vsetky_osoby
           FROM seat s
          WHERE s.id_seat_note IN (?)
          GROUP BY s.id_seat_note`,
        [idHlaviciek],
      )
    : [];

  const idFaktur = [...new Set(vazby.map((v) => v.id_invoice).filter(Boolean))];
  const idOsob = [...new Set(vazby.map((v) => v.id_person).filter(Boolean))];

  const faktury = idFaktur.length
    ? await dotaz(
        `SELECT i.id_invoice, i.id_person, i.changed, i.price, i.discount, i.total,
                i.reservation, i.order_number, i.paid, i.invoice_year, i.invoice_number,
                i.reservation_reminder, i.reservation_cancel
           FROM invoice i WHERE i.id_invoice IN (?)`,
        [idFaktur],
      )
    : [];

  const osoby = idOsob.length
    ? await dotaz(
        `SELECT p.id_person, p.name, p.surname, COALESCE(p.login, p.e_mail) AS email, p.phone
           FROM person p WHERE p.id_person IN (?)`,
        [idOsob],
      )
    : [];

  // `mt_payments.basket` je iná databáza na tom istom serveri. Keď na ňu
  // účet syncu nemá právo, objednávky prídu bez času vzniku — je to strata
  // údaja, nie dôvod zhodiť kanál.
  let kosiky = [];
  if (idKosikov.length) {
    try {
      kosiky = await dotaz(
        `SELECT b.id_basket, b.ts FROM mt_payments.basket b WHERE b.id_basket IN (?)`,
        [idKosikov],
      );
    } catch (e) {
      log.warn("mt_payments.basket nedostupná, objednávky budú bez ordered_at", {
        chyba: e.message,
      });
    }
  }

  return {
    vazby: new Map(vazby.map((v) => [String(v.id_seat_note), v])),
    faktury: new Map(faktury.map((f) => [String(f.id_invoice), f])),
    osoby: new Map(osoby.map((o) => [String(o.id_person), o])),
    kosiky: new Map(kosiky.map((k) => [String(k.id_basket), k])),
  };
}

export async function spusti({ dryRun = false, full = false, since, log, maxDavok = Infinity }) {
  basketNedostupna = false;
  const ulozeny = await nacitajKurzor(kanal);
  let odId = full ? 0 : Math.max(0, (Number(ulozeny.last_id) || 0) - PREKRYV_ID);

  // Orezanie na objednávky, ktoré majú aspoň jedno miesto na podujatí od dátumu.
  // `seat_note` samo dátum nemá, ide sa cez `seat` (index `id_seat_note`)
  // na `plan.datum`. Bez toho by sa ťahali aj hlavičky k podujatiam, ku ktorým
  // kanál A vstupenky zámerne nenačítal.
  const odDatumu = since ?? ulozeny.since ?? null;

  let spolu = 0;
  let osobSpolu = 0;
  let davok = 0;
  let posledne = Number(ulozeny.last_id) || 0;

  log.info("štart", { odId, dryRun, full, since: odDatumu });

  while (davok < maxDavok) {
    const hlavicky = await dotaz(
      `SELECT sn.id_seat_note, sn.note, sn.id_basket, sn.referral, sn.id_affiliate
         FROM seat_note sn
        WHERE sn.id_seat_note > ?
          ${
            odDatumu
              ? `AND EXISTS (SELECT 1 FROM seat s JOIN plan p ON p.id_plan = s.id_plan
                              WHERE s.id_seat_note = sn.id_seat_note AND p.datum >= ?)`
              : ""
          }
        ORDER BY sn.id_seat_note
        LIMIT ${LIMIT}`,
      odDatumu ? [odId, odDatumu] : [odId],
    );
    if (!hlavicky.length) break;

    const { vazby, faktury, osoby, kosiky } = await dotiahniKontext(hlavicky, log);

    // Osoby najprv — objednávka na ne odkazuje.
    const osobyRiadky = [...osoby.values()].map(zmapujOsobu);
    osobSpolu += await upsert("om_persons", osobyRiadky, "id_person", { dryRun, log });

    const objednavky = hlavicky.map((sn) => {
      const vazba = vazby.get(String(sn.id_seat_note));
      return zmapujObjednavku(
        sn,
        vazba,
        faktury.get(String(vazba?.id_invoice)),
        kosiky.get(String(sn.id_basket)),
      );
    });
    await upsert("om_orders", objednavky, "id_seat_note", { dryRun, log });

    odId = Number(hlavicky[hlavicky.length - 1].id_seat_note);
    posledne = odId;
    spolu += hlavicky.length;
    davok++;
    log.debug("dávka", { riadkov: hlavicky.length, spolu, poslednyId: odId });

    if (hlavicky.length < LIMIT) break;
  }

  await ulozKurzor(kanal, {
    hodnota: { last_id: posledne, prekryv_id: PREKRYV_ID, since: odDatumu },
    riadkov: spolu,
    dryRun,
  });

  log.info("hotovo", {
    objednavok: spolu,
    osob: osobSpolu,
    davok,
    kurzor: posledne,
    since: odDatumu,
  });
  return { riadkov: spolu, osob: osobSpolu, davok, kurzor: posledne, since: odDatumu };
}

/**
 * Adresné dotiahnutie hlavičky, ktorú cieľ ešte nepozná (kanál A priniesol
 * vstupenku s `id_seat_note` mimo kurzora). Kurzor sa pritom **neposúva**.
 */
export async function dotiahniHlavicky(idcka, { dryRun = false, log }) {
  if (!idcka.length) return 0;
  const hlavicky = await dotaz(
    `SELECT sn.id_seat_note, sn.note, sn.id_basket, sn.referral, sn.id_affiliate
       FROM seat_note sn WHERE sn.id_seat_note IN (?)`,
    [idcka],
  );
  if (!hlavicky.length) return 0;
  const { vazby, faktury, osoby, kosiky } = await dotiahniKontext(hlavicky, log);
  await upsert("om_persons", [...osoby.values()].map(zmapujOsobu), "id_person", { dryRun, log });
  await upsert(
    "om_orders",
    hlavicky.map((sn) => {
      const vazba = vazby.get(String(sn.id_seat_note));
      return zmapujObjednavku(
        sn,
        vazba,
        faktury.get(String(vazba?.id_invoice)),
        kosiky.get(String(sn.id_basket)),
      );
    }),
    "id_seat_note",
    { dryRun, log },
  );
  return hlavicky.length;
}
