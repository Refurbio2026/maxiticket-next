// Párovací engine — čistá funkcia bez databázy.
//
// `paruj()` dostane jednu transakciu, kandidátov, ktorých jej IO vrstva
// našla, a pravidlá z `matching_rules`. Vráti rozhodnutie aj s dôvodom.
// Nič nezapisuje a nič nedokončuje: vydanie vstupeniek je vždy na volajúcom,
// ktorý na to použije tú istú cestu ako platobná brána.
//
// Dve veci, ktoré tu držia celú bezpečnosť modulu:
//
// 1. **Nedoplatok nikdy nedokončí objednávku.** Starý systém rozdiel len
//    zalogoval a vstupenky vydal — za sumu, ktorá neprišla.
// 2. **Rozhoduje prvé zhodné pravidlo.** Starý systém návrh prepisoval
//    desiatimi pravidlami za sebou, takže výsledok závisel od posledného,
//    ktoré sa trafilo, a nedal sa vysvetliť.

export type Pravidlo = {
  rule_code: string;
  priority: number;
  enabled: boolean;
  params: Record<string, unknown>;
  tolerance: number;
  valid_from?: string | null;
  valid_to?: string | null;
};

export type TransakciaNaParovanie = {
  id: string;
  account_id: string;
  amount: number;
  currency: string;
  vs_normalized: string | null;
  booked_at: string;
  counterparty_iban: string | null;
  message: string | null;
  provider_tx_id: string | null;
};

/** Objednávka tak, ako ju párovanie potrebuje vidieť. */
export type KandidatObjednavka = {
  id: string;
  /** Variabilný symbol normalizovaný na 10 znakov. */
  vs: string | null;
  status: string;
  total_amount: number;
  refunded_amount: number;
  currency: string;
  /** Drží si objednávka stále svoje sedadlá? `null` = objednávka bez sedadiel. */
  seats_held: boolean | null;
  /** Ktorou platbou je už zaplatená (na rozlíšenie druhej platby). */
  paid_transaction_id?: string | null;
};

export type KandidatUlohaNaVratenie = {
  id: string;
  order_id: string | null;
  amount: number;
  status: string;
  vs: string | null;
};

export type KandidatProtokol = {
  id: string;
  vs: string | null;
  amount: number;
};

export type Kontext = {
  objednavky: KandidatObjednavka[];
  ulohyNaVratenie: KandidatUlohaNaVratenie[];
  protokoly: KandidatProtokol[];
  /** Transakcia, ktorá je tou istou platbou z iného zdroja. */
  duplikat: { id: string } | null;
  /** Pôvodná prijatá platba pri chargebacku (nájdená podľa `provider_tx_id`). */
  povodnaPlatba: { transaction_id: string; order_id: string | null } | null;
};

export type StavTransakcie = "matched" | "needs_review" | "ignored" | "duplicate";
export type DruhRozhodnutia = "matched" | "suggested" | "rejected" | "duplicate";

/** Čo má IO vrstva po rozhodnutí vykonať. Engine sám nerobí nič. */
export type Akcia =
  "dokonci_objednavku" | "potvrd_vratenie" | "zapis_chargeback" | "oznac_protokol_zaplateny" | null;

export type Rozhodnutie = {
  rule_code: string;
  status: StavTransakcie;
  decision: DruhRozhodnutia;
  order_id: string | null;
  settlement_id: string | null;
  refund_task_id: string | null;
  duplicate_of: string | null;
  review_reason: string | null;
  expected_amount: number | null;
  paid_amount: number | null;
  /** Kladný = preplatok, záporný = nedoplatok. */
  difference: number | null;
  confidence: number;
  akcia: Akcia;
  /** Záväzok vrátiť peniaze, ktorý z rozhodnutia vyplýva. */
  vratenie: { amount: number; reason: string } | null;
  note: string;
};

const CENT = 0.005;

function rovnake(a: number, b: number, tolerancia = 0): boolean {
  return Math.abs(a - b) <= tolerancia + CENT;
}

/** Zostatok, ktorý má na objednávku ešte prísť. */
export function ocakavanaSuma(o: KandidatObjednavka): number {
  return Math.round((o.total_amount - (o.refunded_amount || 0)) * 100) / 100;
}

/** Objednávka, ktorú ešte možno zaplatiť. */
function caka(o: KandidatObjednavka): boolean {
  return o.status === "pending" || o.status === "awaiting_payment";
}

function jeZrusena(o: KandidatObjednavka): boolean {
  return o.status === "cancelled" || o.status === "expired" || o.status === "failed";
}

function cislo(params: Record<string, unknown>, kluc: string, zaloha: number): number {
  const v = params?.[kluc];
  return typeof v === "number" && Number.isFinite(v) ? v : zaloha;
}

function texty(params: Record<string, unknown>): string[] {
  const v = params?.texts;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Pravidlá zoradené podľa priority a platné k dátumu transakcie. */
export function platnePravidla(pravidla: Pravidlo[], kDatumu: string): Map<string, Pravidlo> {
  const den = kDatumu.slice(0, 10);
  const vysledok = new Map<string, Pravidlo>();
  for (const p of [...pravidla].sort((a, b) => a.priority - b.priority)) {
    if (!p.enabled) continue;
    if (p.valid_from && den < p.valid_from) continue;
    if (p.valid_to && den > p.valid_to) continue;
    if (!vysledok.has(p.rule_code)) vysledok.set(p.rule_code, p);
  }
  return vysledok;
}

function zaklad(rule_code: string): Rozhodnutie {
  return {
    rule_code,
    status: "needs_review",
    decision: "suggested",
    order_id: null,
    settlement_id: null,
    refund_task_id: null,
    duplicate_of: null,
    review_reason: null,
    expected_amount: null,
    paid_amount: null,
    difference: null,
    confidence: 1,
    akcia: null,
    vratenie: null,
    note: "",
  };
}

/**
 * Rozhodne, čo s transakciou.
 *
 * Pravidlá sa skúšajú v poradí podľa priority a **prvé, ktoré sa trafí,
 * vyhráva**. Vypnuté alebo neplatné pravidlo sa preskočí, takže sa dá
 * konkrétne správanie vypnúť bez zásahu do kódu.
 */
export function paruj(
  tx: TransakciaNaParovanie,
  kontext: Kontext,
  pravidla: Pravidlo[],
): Rozhodnutie {
  const aktivne = platnePravidla(pravidla, tx.booked_at);
  const zapnute = (kod: string) => aktivne.get(kod);

  // --- 1. Tá istá platba, ktorú už máme z iného zdroja -------------------
  const duplicita = zapnute("duplicate_source");
  if (duplicita && kontext.duplikat) {
    const r = zaklad("duplicate_source");
    r.status = "duplicate";
    r.decision = "duplicate";
    r.duplicate_of = kontext.duplikat.id;
    r.paid_amount = tx.amount;
    r.note = "Tá istá platba už je v systéme z iného zdroja.";
    return r;
  }

  // --- Odchádzajúce platby ----------------------------------------------
  if (tx.amount < 0) {
    const suma = Math.abs(tx.amount);

    const vratenie = zapnute("refund_confirmed");
    if (vratenie) {
      const uloha = kontext.ulohyNaVratenie.find(
        (u) =>
          (u.status === "exported" || u.status === "sent" || u.status === "approved") &&
          rovnake(u.amount, suma, vratenie.tolerance),
      );
      if (uloha) {
        const r = zaklad("refund_confirmed");
        r.status = "matched";
        r.decision = "matched";
        r.order_id = uloha.order_id;
        r.refund_task_id = uloha.id;
        r.paid_amount = tx.amount;
        r.akcia = "potvrd_vratenie";
        r.note = `Odchádzajúca platba ${suma.toFixed(2)} ${tx.currency} uzatvára úlohu na vrátenie.`;
        return r;
      }
    }

    const chargeback = zapnute("chargeback");
    if (chargeback && tx.provider_tx_id && kontext.povodnaPlatba) {
      const r = zaklad("chargeback");
      r.status = "matched";
      r.decision = "matched";
      r.order_id = kontext.povodnaPlatba.order_id;
      r.paid_amount = tx.amount;
      r.akcia = "zapis_chargeback";
      r.review_reason = "chargeback";
      r.note = "Karta si vzala peniaze späť — vstupenky treba zneplatniť.";
      return r;
    }

    const vyplata = zapnute("settlement_payout");
    if (vyplata && tx.vs_normalized) {
      const protokol = kontext.protokoly.find(
        (p) =>
          p.vs != null && p.vs === tx.vs_normalized && rovnake(p.amount, suma, vyplata.tolerance),
      );
      if (protokol) {
        const r = zaklad("settlement_payout");
        r.status = "matched";
        r.decision = "matched";
        r.settlement_id = protokol.id;
        r.paid_amount = tx.amount;
        r.akcia = "oznac_protokol_zaplateny";
        r.note = "Výplata organizátorovi podľa VS vyúčtovacieho protokolu.";
        return r;
      }
    }
  }

  // --- 2. Poplatok, výplata či iný náklad podľa textu --------------------
  const naklad = zapnute("expense_text");
  if (naklad) {
    const hladane = texty(naklad.params);
    const vzorka = `${tx.message ?? ""}`.toLowerCase();
    const trafene = hladane.find((t) => vzorka.includes(t.toLowerCase()));
    if (trafene) {
      const r = zaklad("expense_text");
      r.status = "ignored";
      r.decision = "rejected";
      r.paid_amount = tx.amount;
      r.note = `Nie je to platba za vstupenky — v popise je „${trafene}".`;
      return r;
    }
  }

  // --- 3. Objednávka podľa variabilného symbolu --------------------------
  const podlaVs = tx.vs_normalized
    ? kontext.objednavky.filter((o) => o.vs != null && o.vs === tx.vs_normalized)
    : [];

  if (podlaVs.length > 0 && tx.amount > 0) {
    const r = rozhodniPodlaObjednavky(tx, podlaVs, zapnute);
    if (r) return r;
  }

  // --- 4. VS chýba, číslo je v popise -----------------------------------
  const zPopisu = zapnute("vs_from_description");
  if (zPopisu && !tx.vs_normalized && tx.amount > 0) {
    const navrh = kontext.objednavky.find(
      (o) => o.vs != null && rovnake(ocakavanaSuma(o), tx.amount) && caka(o),
    );
    if (navrh) {
      const r = zaklad("vs_from_description");
      r.status = "needs_review";
      r.decision = "suggested";
      r.order_id = navrh.id;
      r.expected_amount = ocakavanaSuma(navrh);
      r.paid_amount = tx.amount;
      r.difference = 0;
      r.confidence = cislo(zPopisu.params, "confidence", 0.6);
      r.review_reason = "no_vs";
      // Zámerne `suggested`, nie `matched`: číslo z popisu je odhad. Potvrdiť
      // ho musí človek, inak by stačilo napísať cudzie číslo do správy pre
      // príjemcu a odísť s cudzími vstupenkami.
      r.note = "VS chýba; podľa čísla v popise a sedacej sumy to vyzerá na túto objednávku.";
      return r;
    }
  }

  // --- 5. Nič nesedí -----------------------------------------------------
  const r = zaklad("no_match");
  r.status = "needs_review";
  r.decision = "suggested";
  r.review_reason = tx.vs_normalized ? "no_match" : "no_vs";
  r.paid_amount = tx.amount;
  r.note = tx.vs_normalized
    ? `K variabilnému symbolu ${tx.vs_normalized} sa nenašla objednávka.`
    : "Platba nemá variabilný symbol ani použiteľné číslo v popise.";
  return r;
}

/**
 * Rozhodnutie pre transakciu, ku ktorej sa podľa VS našla objednávka.
 *
 * Poradie je podstatné: najprv sa vylúčia objednávky, ktoré sa už zaplatiť
 * nedajú (zaplatená, zrušená, bez sedadiel), a až potom sa porovnáva suma.
 * Opačne by sa platba na zrušenú rezerváciu s presnou sumou dokončila.
 */
function rozhodniPodlaObjednavky(
  tx: TransakciaNaParovanie,
  kandidati: KandidatObjednavka[],
  zapnute: (kod: string) => Pravidlo | undefined,
): Rozhodnutie | null {
  // Keď je na jeden VS viac objednávok, vyberie sa tá, ktorá ešte čaká.
  const objednavka = kandidati.find(caka) ?? kandidati[0];
  const ocakavane = ocakavanaSuma(objednavka);
  const rozdiel = Math.round((tx.amount - ocakavane) * 100) / 100;

  const doplnSumy = (r: Rozhodnutie) => {
    r.order_id = objednavka.id;
    r.expected_amount = ocakavane;
    r.paid_amount = tx.amount;
    r.difference = rozdiel;
    return r;
  };

  // Mena musí sedieť. Dvadsaťpäť českých korún nie je dvadsaťpäť eur a starý
  // systém menu vôbec neukladal — určoval ju účet, na ktorý platba prišla.
  if (objednavka.currency && tx.currency && objednavka.currency !== tx.currency) {
    const r = doplnSumy(zaklad("vs_exact"));
    r.status = "needs_review";
    r.decision = "suggested";
    r.review_reason = "currency_mismatch";
    r.note = `Objednávka je v ${objednavka.currency}, platba prišla v ${tx.currency}.`;
    return r;
  }

  if (objednavka.status === "paid") {
    const pravidlo = zapnute("vs_already_paid");
    if (!pravidlo) return null;
    const r = doplnSumy(zaklad("vs_already_paid"));
    r.status = "needs_review";
    r.decision = "suggested";
    r.review_reason = "already_paid";
    r.vratenie = { amount: tx.amount, reason: "already_paid" };
    r.note = "Objednávka je už zaplatená — tieto peniaze prišli druhýkrát a treba ich vrátiť.";
    return r;
  }

  if (objednavka.status === "refunded") {
    const pravidlo = zapnute("vs_cancelled");
    if (!pravidlo) return null;
    const r = doplnSumy(zaklad("vs_cancelled"));
    r.status = "needs_review";
    r.decision = "suggested";
    r.review_reason = "reservation_cancelled";
    r.vratenie = { amount: tx.amount, reason: "reservation_cancelled" };
    r.note = "Objednávka je refundovaná — platba prišla po vrátení peňazí.";
    return r;
  }

  if (jeZrusena(objednavka)) {
    const pravidlo = zapnute("vs_cancelled");
    if (!pravidlo) return null;
    const r = doplnSumy(zaklad("vs_cancelled"));
    r.status = "needs_review";
    r.decision = "suggested";
    r.review_reason = "reservation_cancelled";
    r.vratenie = { amount: tx.amount, reason: "reservation_cancelled" };
    // Sedadlá sa vrátili do predaja pri zrušení. Keď sú ešte voľné, support
    // vie objednávku obnoviť; keď nie, ostáva vrátiť peniaze.
    r.note =
      "Platba na zrušenú objednávku. Ak sú miesta stále voľné, dá sa obnoviť a predať, " +
      "inak treba peniaze vrátiť.";
    return r;
  }

  // Objednávka čaká, ale sedadlá jej medzitým niekto vzal.
  if (objednavka.seats_held === false) {
    const pravidlo = zapnute("vs_seats_unavailable");
    if (!pravidlo) return null;
    const r = doplnSumy(zaklad("vs_seats_unavailable"));
    r.status = "needs_review";
    r.decision = "suggested";
    r.review_reason = "seats_unavailable";
    r.vratenie = { amount: tx.amount, reason: "seats_unavailable" };
    r.note = "Sedadlá už patria inej objednávke — vstupenky sa vydať nedajú.";
    return r;
  }

  // --- Suma ---
  if (rozdiel < 0) {
    const pravidlo = zapnute("vs_underpaid");
    if (!pravidlo) return null;
    const r = doplnSumy(zaklad("vs_underpaid"));
    r.status = "needs_review";
    r.decision = "suggested";
    r.review_reason = "underpaid";
    // Žiadne vstupenky. Toto je celý zmysel pravidla.
    r.note =
      `Prišlo o ${Math.abs(rozdiel).toFixed(2)} ${tx.currency} menej, než mala objednávka stáť. ` +
      "Vstupenky sa nevydajú, kým sa nedoplatí.";
    return r;
  }

  if (rozdiel > 0) {
    const pravidlo = zapnute("vs_overpaid");
    if (!pravidlo) return null;
    const limit = cislo(pravidlo.params, "keep_limit", 0);
    const r = doplnSumy(zaklad("vs_overpaid"));
    r.status = "matched";
    r.decision = "matched";
    r.akcia = "dokonci_objednavku";
    if (rozdiel > limit + CENT) {
      r.vratenie = { amount: rozdiel, reason: "overpaid" };
      r.note =
        `Preplatok ${rozdiel.toFixed(2)} ${tx.currency} nad limitom ${limit.toFixed(2)} — ` +
        "objednávka sa dokončí a rozdiel ide do fronty na vrátenie.";
    } else {
      r.note =
        `Preplatok ${rozdiel.toFixed(2)} ${tx.currency} je do limitu ${limit.toFixed(2)}, ` +
        "ponecháva sa a zaúčtuje sa zvlášť.";
    }
    return r;
  }

  const presne = zapnute("vs_exact");
  if (!presne) return null;
  const r = doplnSumy(zaklad("vs_exact"));
  r.status = "matched";
  r.decision = "matched";
  r.akcia = "dokonci_objednavku";
  r.note = "VS aj suma sedia presne.";
  return r;
}
