// IO vrstva okolo párovacieho engine.
//
// Engine (`matching.ts`) je čistá funkcia a nič nevie o databáze. Tu sa mu
// nájdu kandidáti, jeho rozhodnutie sa zapíše a vykoná sa z neho vyplývajúca
// akcia — dokončenie objednávky, potvrdenie vrátenia, chargeback.
//
// Dokončenie objednávky sa **nepíše tu**. Volá sa `dokonciZPrevodu()` z
// `order-settlement.server.ts`, čo je tá istá cesta, akou objednávku dotiahne
// platobná brána. Druhá vetva vydávania vstupeniek by sa skôr či neskôr
// rozišla s prvou.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { dokonciZPrevodu } from "../order-settlement.server";
import { errorMessage } from "../error-message";
import { maskujIban } from "./normalize";
import {
  paruj,
  type KandidatObjednavka,
  type KandidatProtokol,
  type KandidatUlohaNaVratenie,
  type Kontext,
  type Pravidlo,
  type Rozhodnutie,
  type TransakciaNaParovanie,
} from "./matching";

export type VysledokParovania = {
  spracovanych: number;
  sparovanych: number;
  naKontrolu: number;
  duplicit: number;
  ignorovanych: number;
  dokoncenychObjednavok: number;
  zalozenychVrateni: number;
  chyb: number;
};

type RiadokTransakcie = {
  id: string;
  account_id: string;
  amount: number;
  currency: string;
  vs_normalized: string | null;
  booked_at: string;
  counterparty_iban: string | null;
  message: string | null;
  provider_tx_id: string | null;
  status: string;
};

/** Pravidlá z databázy. Bez nich sa neparuje — radšej nič než naslepo. */
async function nacitajPravidla(): Promise<Pravidlo[]> {
  const { data, error } = await supabaseAdmin
    .from("matching_rules")
    .select("rule_code, priority, enabled, params, tolerance, valid_from, valid_to")
    .eq("scope", "operational");
  if (error) throw new Error(`Pravidlá párovania sa nepodarilo načítať: ${error.message}`);
  return (data || []).map((p) => ({
    rule_code: p.rule_code,
    priority: p.priority,
    enabled: p.enabled,
    params: (p.params ?? {}) as Record<string, unknown>,
    tolerance: Number(p.tolerance || 0),
    valid_from: p.valid_from,
    valid_to: p.valid_to,
  }));
}

/**
 * Spáruje transakcie, ktoré ešte nemajú rozhodnutie.
 *
 * `iba` obmedzí beh na konkrétne transakcie (ručné prepárovanie z admina);
 * bez neho sa berie všetko čerstvé a všetko, čo čaká na kontrolu a medzitým
 * mohlo dostať objednávku (napr. keď support opravil VS).
 */
export async function sparujTransakcie(opts?: {
  accountId?: string;
  iba?: string[];
  limit?: number;
}): Promise<VysledokParovania> {
  const v: VysledokParovania = {
    spracovanych: 0,
    sparovanych: 0,
    naKontrolu: 0,
    duplicit: 0,
    ignorovanych: 0,
    dokoncenychObjednavok: 0,
    zalozenychVrateni: 0,
    chyb: 0,
  };

  const pravidla = await nacitajPravidla();
  if (pravidla.length === 0) return v;

  let q = supabaseAdmin
    .from("bank_transactions")
    .select(
      "id, account_id, amount, currency, vs_normalized, booked_at, counterparty_iban, message, provider_tx_id, status",
    )
    .order("booked_at", { ascending: true })
    .limit(opts?.limit ?? 500);

  if (opts?.iba && opts.iba.length > 0) {
    q = q.in("id", opts.iba);
  } else {
    // `needs_review` sa skúša znova zámerne: support mohol medzitým opraviť
    // VS a platba sa stane spárovateľnou. Starý systém takú platbu už nikdy
    // nevzal do ruky — zostala navždy „uviaznutá".
    q = q.in("status", ["received", "parsed", "needs_review"]);
  }
  if (opts?.accountId) q = q.eq("account_id", opts.accountId);

  const { data: transakcie, error } = await q;
  if (error) throw new Error(error.message);
  if (!transakcie || transakcie.length === 0) return v;

  for (const tx of transakcie as RiadokTransakcie[]) {
    v.spracovanych++;
    try {
      const kontext = await zostavKontext(tx);
      const rozhodnutie = paruj(naEngine(tx), kontext, pravidla);
      await zapisRozhodnutie(tx, rozhodnutie, v);
    } catch (e) {
      v.chyb++;
      // Chyba pri jednej transakcii nesmie zastaviť zvyšok behu. Starý systém
      // pri nečakanej mene ukončil celé spracovanie výpisu.
      console.error("Párovanie transakcie zlyhalo", tx.id, errorMessage(e));
    }
  }

  return v;
}

function naEngine(tx: RiadokTransakcie): TransakciaNaParovanie {
  return {
    id: tx.id,
    account_id: tx.account_id,
    amount: Number(tx.amount),
    currency: tx.currency,
    vs_normalized: tx.vs_normalized,
    booked_at: tx.booked_at,
    counterparty_iban: tx.counterparty_iban,
    message: tx.message,
    provider_tx_id: tx.provider_tx_id,
  };
}

/** Kandidáti pre jednu transakciu. */
async function zostavKontext(tx: RiadokTransakcie): Promise<Kontext> {
  const suma = Number(tx.amount);

  const [objednavky, duplikat, ulohy, protokoly, povodnaPlatba] = await Promise.all([
    najdiObjednavky(tx),
    najdiDuplikat(tx),
    suma < 0 ? najdiUlohyNaVratenie(Math.abs(suma)) : Promise.resolve([]),
    suma < 0 && tx.vs_normalized ? najdiProtokoly(tx.vs_normalized) : Promise.resolve([]),
    suma < 0 && tx.provider_tx_id ? najdiPovodnuPlatbu(tx.provider_tx_id) : Promise.resolve(null),
  ]);

  return { objednavky, duplikat, ulohyNaVratenie: ulohy, protokoly, povodnaPlatba };
}

/**
 * Objednávky, ktoré k transakcii prichádzajú do úvahy.
 *
 * Pri vyplnenom VS sa hľadá podľa `orders.payment_vs`. Bez VS sa berie úzky
 * výber čakajúcich objednávok s presne sediacou sumou — z neho potom engine
 * urobí nanajvýš *návrh*, ktorý musí potvrdiť človek.
 */
async function najdiObjednavky(tx: RiadokTransakcie): Promise<KandidatObjednavka[]> {
  const stlpce = "id, payment_vs, previous_vs, status, total_amount, refunded_amount, currency";
  let riadky: Record<string, unknown>[] = [];
  let podlaStarehoVs = false;

  if (tx.vs_normalized) {
    // `payment_vs` je bigint; normalizovaný VS je ten istý údaj s nulami zľava.
    const cislo = Number(tx.vs_normalized);
    if (Number.isSafeInteger(cislo)) {
      const { data } = await supabaseAdmin.from("orders").select(stlpce).eq("payment_vs", cislo);
      riadky = data || [];

      // Objednávka mohla medzitým dostať nový symbol (prevod → karta).
      // Platba so starým symbolom k nej stále patrí.
      if (riadky.length === 0) {
        const { data: stare } = await supabaseAdmin
          .from("orders")
          .select(stlpce)
          .contains("previous_vs", [cislo]);
        riadky = stare || [];
        podlaStarehoVs = riadky.length > 0;
      }
    }
  } else if (Number(tx.amount) > 0) {
    const { data } = await supabaseAdmin
      .from("orders")
      .select(stlpce)
      .in("status", ["pending", "awaiting_payment"])
      .eq("total_amount", Number(tx.amount))
      .limit(20);
    riadky = data || [];
  }

  if (riadky.length === 0) return [];

  const drziSedadla = await zistiSedadla(riadky.map((o) => String(o.id)));

  return riadky.map((o) => ({
    id: String(o.id),
    // Pri náleze cez starý symbol sa engine musí dozvedieť ten, s ktorým
    // platba naozaj prišla — pre párovanie je to symbol tejto objednávky.
    vs: podlaStarehoVs
      ? tx.vs_normalized
      : o.payment_vs != null
        ? String(o.payment_vs).padStart(10, "0")
        : null,
    status: String(o.status),
    total_amount: Number(o.total_amount),
    refunded_amount: Number(o.refunded_amount || 0),
    currency: String(o.currency || "EUR"),
    seats_held: drziSedadla.get(String(o.id)) ?? null,
  }));
}

/**
 * Drží si objednávka stále svoje sedadlá?
 *
 * `null` = objednávka žiadne sedadlá nemá (státie), tam sa otázka nekladie.
 * `false` = sedadlá si medzitým vzal niekto iný, takže vstupenky sa vydať
 * nedajú a peniaze treba vrátiť.
 */
async function zistiSedadla(orderIds: string[]): Promise<Map<string, boolean | null>> {
  const vysledok = new Map<string, boolean | null>();
  if (orderIds.length === 0) return vysledok;

  const [{ data: polozky }, { data: sedadla }] = await Promise.all([
    supabaseAdmin.from("order_items").select("order_id, seat_id").in("order_id", orderIds),
    supabaseAdmin.from("seat_inventory").select("order_id, status").in("order_id", orderIds),
  ]);

  const chceSedadla = new Map<string, number>();
  for (const p of polozky || []) {
    if (!p.seat_id) continue;
    chceSedadla.set(p.order_id, (chceSedadla.get(p.order_id) || 0) + 1);
  }
  const ma = new Map<string, number>();
  for (const s of sedadla || []) {
    if (!s.order_id) continue;
    if (s.status !== "reserved" && s.status !== "sold") continue;
    ma.set(s.order_id, (ma.get(s.order_id) || 0) + 1);
  }

  for (const id of orderIds) {
    const chce = chceSedadla.get(id) || 0;
    if (chce === 0) vysledok.set(id, null);
    else vysledok.set(id, (ma.get(id) || 0) >= chce);
  }
  return vysledok;
}

/**
 * Tá istá platba, ktorú už máme z iného zdroja.
 *
 * Unikátny kľúč `(account_id, external_id)` zachytí opakovaný import toho
 * istého súboru. Nezachytí, že tá istá platba prišla raz z API a raz
 * z mesačného výpisu — vtedy má iné `external_id`. Preto sa porovnáva
 * podpis platby: účet, deň, suma, VS a protiúčet.
 */
async function najdiDuplikat(tx: RiadokTransakcie): Promise<{ id: string } | null> {
  const den = tx.booked_at.slice(0, 10);
  let q = supabaseAdmin
    .from("bank_transactions")
    .select("id")
    .eq("account_id", tx.account_id)
    .eq("amount", Number(tx.amount))
    .gte("booked_at", `${den}T00:00:00Z`)
    .lte("booked_at", `${den}T23:59:59Z`)
    .neq("id", tx.id)
    .in("status", ["matched", "ignored"])
    .limit(1);

  q = tx.vs_normalized ? q.eq("vs_normalized", tx.vs_normalized) : q.is("vs_normalized", null);
  if (tx.counterparty_iban) q = q.eq("counterparty_iban", tx.counterparty_iban);

  const { data } = await q;
  return data && data.length > 0 ? { id: data[0].id } : null;
}

async function najdiUlohyNaVratenie(suma: number): Promise<KandidatUlohaNaVratenie[]> {
  const { data } = await supabaseAdmin
    .from("refund_tasks")
    .select("id, order_id, amount, status")
    .in("status", ["approved", "exported", "sent"])
    .gte("amount", suma - 0.02)
    .lte("amount", suma + 0.02)
    .limit(20);
  return (data || []).map((u) => ({
    id: u.id,
    order_id: u.order_id,
    amount: Number(u.amount),
    status: u.status,
    vs: null,
  }));
}

/**
 * Vyúčtovací protokol podľa variabilného symbolu výplaty.
 *
 * VS výplaty držíme v `settlements.payout_reference` — vlastné pole pre číslo
 * protokolu tabuľka nemá a zakladať ho len kvôli párovaniu by znamenalo dva
 * zdroje tej istej pravdy.
 */
async function najdiProtokoly(vs: string): Promise<KandidatProtokol[]> {
  const { data } = await supabaseAdmin
    .from("settlements")
    .select("id, payout_reference, net_amount")
    .not("payout_reference", "is", null)
    .in("status", ["approved", "paid"])
    .limit(50);
  return (data || [])
    .map((s) => ({
      id: s.id,
      vs: s.payout_reference
        ? String(s.payout_reference).replace(/\D/g, "").padStart(10, "0")
        : null,
      amount: Number(s.net_amount || 0),
    }))
    .filter((s) => s.vs === vs);
}

async function najdiPovodnuPlatbu(
  providerTxId: string,
): Promise<{ transaction_id: string; order_id: string | null } | null> {
  const { data } = await supabaseAdmin
    .from("payments")
    .select("order_id, provider_payment_id")
    .eq("provider_payment_id", providerTxId)
    .eq("status", "paid")
    .limit(1);
  if (!data || data.length === 0) return null;
  return { transaction_id: providerTxId, order_id: data[0].order_id };
}

/** Zapíše rozhodnutie a vykoná, čo z neho vyplýva. */
async function zapisRozhodnutie(
  tx: RiadokTransakcie,
  r: Rozhodnutie,
  v: VysledokParovania,
): Promise<void> {
  let status = r.status;
  let poznamka = r.note;

  // Akcia sa vykonáva PRED zápisom stavu: keby dokončenie objednávky zlyhalo,
  // transakcia nesmie ostať označená za spárovanú — inak by ju ďalší beh
  // nevzal do ruky a peniaze by zostali bez vstupeniek.
  if (r.akcia === "dokonci_objednavku" && r.order_id) {
    const vysledok = await dokonciZPrevodu(r.order_id, {
      id: tx.id,
      amount: Number(tx.amount),
      currency: tx.currency,
      booked_at: tx.booked_at,
    });
    if (vysledok.changed) {
      v.dokoncenychObjednavok++;
    } else if (vysledok.reason === "objednavka_neexistuje") {
      status = "needs_review";
      poznamka = "Objednávka medzitým zmizla — platbu treba vybaviť ručne.";
    }
    // `uz_zaplatena` je v poriadku: inému behu sa to podarilo skôr.
  }

  if (r.akcia === "potvrd_vratenie" && r.refund_task_id) {
    await supabaseAdmin
      .from("refund_tasks")
      .update({ status: "confirmed", outgoing_transaction_id: tx.id })
      .eq("id", r.refund_task_id);
  }

  if (r.akcia === "zapis_chargeback" && r.order_id) {
    await oznacChargeback(r.order_id, tx);
  }

  if (r.akcia === "oznac_protokol_zaplateny" && r.settlement_id) {
    await supabaseAdmin
      .from("settlements")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", r.settlement_id)
      .neq("status", "paid");
  }

  // Záväzok vrátiť peniaze. Unikátny index na (transakcia, dôvod) zaručí, že
  // opakovaný beh nezaloží druhú úlohu na ten istý preplatok.
  let refundTaskId = r.refund_task_id;
  if (r.vratenie) {
    const { data: uloha } = await supabaseAdmin
      .from("refund_tasks")
      .upsert(
        {
          order_id: r.order_id,
          transaction_id: tx.id,
          amount: r.vratenie.amount,
          currency: tx.currency,
          iban: tx.counterparty_iban,
          reason: r.vratenie.reason,
          note: r.note,
        },
        { onConflict: "transaction_id,reason", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (uloha) {
      refundTaskId = uloha.id;
      v.zalozenychVrateni++;
    }
  }

  await supabaseAdmin
    .from("bank_transactions")
    .update({
      status,
      review_reason: status === "needs_review" ? r.review_reason : null,
      matched_order_id: r.order_id,
      duplicate_of: r.duplicate_of,
      note: poznamka,
    })
    .eq("id", tx.id);

  await supabaseAdmin.from("transaction_matches").insert({
    transaction_id: tx.id,
    order_id: r.order_id,
    settlement_id: r.settlement_id,
    refund_task_id: refundTaskId,
    rule_code: r.rule_code,
    decision: r.decision,
    expected_amount: r.expected_amount,
    paid_amount: r.paid_amount,
    difference: r.difference,
    confidence: r.confidence,
    decided_by: "system",
    note: poznamka,
  });

  if (status === "matched") v.sparovanych++;
  else if (status === "needs_review") v.naKontrolu++;
  else if (status === "duplicate") v.duplicit++;
  else if (status === "ignored") v.ignorovanych++;
}

/**
 * Chargeback: banka si vzala peniaze späť.
 *
 * Vstupenky sa označia ako refundované, nie použité — skener má pre ne
 * vlastný výsledok a zneužitie `used_at` by klamalo personál aj štatistiky.
 */
async function oznacChargeback(orderId: string, tx: RiadokTransakcie): Promise<void> {
  const teraz = new Date().toISOString();
  await supabaseAdmin
    .from("tickets")
    .update({ refunded_at: teraz })
    .eq("order_id", orderId)
    .is("refunded_at", null);

  await supabaseAdmin
    .from("orders")
    .update({
      status: "refunded",
      refunded_at: teraz,
      refunded_amount: Math.abs(Number(tx.amount)),
      refund_reason: "Chargeback z banky",
    })
    .eq("id", orderId);

  await supabaseAdmin
    .from("seat_inventory")
    .update({ status: "available", reserved_until: null, order_id: null })
    .eq("order_id", orderId);

  await supabaseAdmin.from("payment_logs").insert({
    order_id: orderId,
    provider: "prevod",
    endpoint: `chargeback:${tx.provider_tx_id ?? tx.id}`,
    status: "error",
    error_message:
      `Chargeback ${Math.abs(Number(tx.amount)).toFixed(2)} ${tx.currency} z účtu ` +
      `${maskujIban(tx.counterparty_iban)}. Vstupenky boli zneplatnené.`,
    response_payload: null as Json,
  });
}
