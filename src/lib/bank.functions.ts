// Bankové účty, pohyby a ich párovanie s objednávkami.
//
// Párovacie rozhodnutie NEROBÍ tento súbor. Je v `bank/matching.ts` ako čistá
// funkcia a jeho IO vrstva je `bank/matching.server.ts`; tu sú len serverové
// funkcie, ktoré ich sprístupnia administrácii. Držíme to tak preto, že
// pravidiel je trinásť a rozhodnutie o peniazoch sa musí dať otestovať bez
// databázy.
//
// Variabilný symbol je `orders.payment_vs` — číslo zo sekvencie, ktoré ide aj
// do brány, aj na faktúru. Predchádzajúca verzia tohto súboru párovala na
// `order.id.slice(0, 8)`, čo je iný údaj, takže nespárovala nikdy nič a robila
// to potichu.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sparujTransakcie } from "./bank/matching.server";
import { zapisAudit } from "./bank/audit.server";
import { normalizujSymbol, normalizujIban } from "./bank/normalize";
import { dokonciZPrevodu } from "./order-settlement.server";

export type BankAccountRecord = {
  id: string;
  bank_name: string;
  account_name: string;
  /** Pri pseudo účte brány je prázdny — brána IBAN nemá. */
  iban: string | null;
  psp_key: string | null;
  kind: "bank" | "psp";
  provider: string | null;
  currency: string;
  balance: number;
  connected: boolean;
  active: boolean;
  last_sync_at: string | null;
  transactions_count: number;
  unmatched_count: number;
};

export type BankTransactionRecord = {
  id: string;
  account_id: string;
  booked_at: string;
  received_at: string;
  amount: number;
  currency: string;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  variable_symbol: string | null;
  vs_normalized: string | null;
  message: string | null;
  status: string;
  review_reason: string | null;
  note: string | null;
  matched_order_id: string | null;
  /** Krátke id spárovanej objednávky pre výpis. */
  matched_order_short: string | null;
  duplicate_of: string | null;
};

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

// --- Účty ---------------------------------------------------------------

export const listBankAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BankAccountRecord[]> => {
    await assertAdmin(context.userId);
    const { data: accounts, error } = await supabaseAdmin
      .from("bank_accounts")
      .select("*")
      .order("bank_name", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: txs } = await supabaseAdmin
      .from("bank_transactions")
      .select("account_id, status");
    const total = new Map<string, number>();
    const unmatched = new Map<string, number>();
    for (const t of txs || []) {
      total.set(t.account_id, (total.get(t.account_id) || 0) + 1);
      // Duplicita ani náklad nie sú práca — do počtu nespárovaných nepatria.
      if (t.status === "needs_review" || t.status === "parse_error") {
        unmatched.set(t.account_id, (unmatched.get(t.account_id) || 0) + 1);
      }
    }

    return (accounts || []).map((a) => ({
      id: a.id,
      bank_name: a.bank_name,
      account_name: a.account_name,
      iban: a.iban,
      psp_key: a.psp_key,
      kind: (a.kind as "bank" | "psp") ?? "bank",
      provider: a.provider,
      currency: a.currency,
      balance: Number(a.balance),
      connected: a.connected,
      active: a.active,
      last_sync_at: a.last_sync_at,
      transactions_count: total.get(a.id) || 0,
      unmatched_count: unmatched.get(a.id) || 0,
    }));
  });

export const upsertBankAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        bank_name: z.string().min(1).max(200),
        account_name: z.string().min(1).max(200),
        kind: z.enum(["bank", "psp"]).default("bank"),
        iban: z.string().max(50).optional().nullable(),
        psp_key: z.string().max(60).optional().nullable(),
        provider: z
          .enum([
            "fio",
            "csob",
            "tatrabanka",
            "slsp",
            "vub",
            "gopay",
            "gpwebpay",
            "tatrapayplus",
            "comgate",
            "other",
          ])
          .optional()
          .nullable(),
        owner_name: z.string().max(200).optional().nullable(),
        currency: z.string().min(3).max(3).default("EUR"),
        balance: z.number().default(0),
        connected: z.boolean().default(false),
        active: z.boolean().default(true),
      })
      .refine((d) => (d.kind === "bank" ? !!d.iban : !!d.psp_key), {
        message: "Bankový účet potrebuje IBAN, účet brány identifikátor.",
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.userId);
    const row = {
      bank_name: data.bank_name.trim(),
      account_name: data.account_name.trim(),
      kind: data.kind,
      iban: data.kind === "bank" ? normalizujIban(data.iban) : null,
      psp_key: data.kind === "psp" ? (data.psp_key || "").trim().toUpperCase() : null,
      provider: data.provider || null,
      owner_name: data.owner_name?.trim() || null,
      currency: data.currency.toUpperCase(),
      balance: data.balance,
      connected: data.connected,
      active: data.active,
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      const { error } = await supabaseAdmin.from("bank_accounts").update(row).eq("id", data.id);
      if (error) throw new Error(friendly(error.message));
      return { id: data.id };
    }
    const { data: created, error } = await supabaseAdmin
      .from("bank_accounts")
      .insert(row)
      .select("id")
      .single();
    if (error || !created) throw new Error(friendly(error?.message || "Uloženie zlyhalo"));
    return { id: created.id };
  });

function friendly(message: string): string {
  if (message.includes("bank_accounts_iban_key")) return "Účet s týmto IBAN už existuje.";
  if (message.includes("bank_accounts_psp_key")) return "Účet s týmto identifikátorom už existuje.";
  return message;
}

export const deleteBankAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("bank_accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// --- Pohyby -------------------------------------------------------------

const STAVY = [
  "received",
  "parsed",
  "matched",
  "needs_review",
  "ignored",
  "parse_error",
  "duplicate",
] as const;

export const listBankTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        account_id: z.string().uuid().optional(),
        status: z.enum([...STAVY, "all"]).default("all"),
        limit: z.number().int().positive().max(1000).default(300),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<BankTransactionRecord[]> => {
    await assertAdmin(context.userId);
    let q = supabaseAdmin
      .from("bank_transactions")
      .select("*")
      .order("booked_at", { ascending: false })
      .limit(data.limit);
    if (data.account_id) q = q.eq("account_id", data.account_id);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    return (rows || []).map(naZaznam);
  });

/** Platby, ktoré čakajú na človeka. Toto je obrazovka „Nespárované platby". */
export const listNeedsReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        account_id: z.string().uuid().optional(),
        limit: z.number().int().max(500).default(200),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<BankTransactionRecord[]> => {
    await assertAdmin(context.userId);
    let q = supabaseAdmin
      .from("bank_transactions")
      .select("*")
      .in("status", ["needs_review", "parse_error"])
      .order("booked_at", { ascending: false })
      .limit(data.limit);
    if (data.account_id) q = q.eq("account_id", data.account_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows || []).map(naZaznam);
  });

function naZaznam(t: Record<string, unknown>): BankTransactionRecord {
  const orderId = (t.matched_order_id as string | null) ?? null;
  return {
    id: String(t.id),
    account_id: String(t.account_id),
    booked_at: String(t.booked_at),
    received_at: String(t.received_at),
    amount: Number(t.amount),
    currency: String(t.currency),
    counterparty_name: (t.counterparty_name as string | null) ?? null,
    counterparty_iban: (t.counterparty_iban as string | null) ?? null,
    variable_symbol: (t.variable_symbol as string | null) ?? null,
    vs_normalized: (t.vs_normalized as string | null) ?? null,
    message: (t.message as string | null) ?? null,
    status: String(t.status),
    review_reason: (t.review_reason as string | null) ?? null,
    note: (t.note as string | null) ?? null,
    matched_order_id: orderId,
    matched_order_short: orderId ? orderId.slice(0, 8).toUpperCase() : null,
    duplicate_of: (t.duplicate_of as string | null) ?? null,
  };
}

const TransactionInput = z.object({
  account_id: z.string().uuid(),
  booked_at: z.string().min(1),
  value_date: z.string().optional().nullable(),
  amount: z.number(),
  currency: z.string().max(3).default("EUR"),
  counterparty_name: z.string().max(300).optional().nullable(),
  counterparty_iban: z.string().max(50).optional().nullable(),
  variable_symbol: z.string().max(40).optional().nullable(),
  specific_symbol: z.string().max(40).optional().nullable(),
  constant_symbol: z.string().max(10).optional().nullable(),
  message: z.string().max(1000).optional().nullable(),
  external_id: z.string().max(200).optional().nullable(),
  provider_tx_id: z.string().max(200).optional().nullable(),
});

export type BankTransactionInput = z.input<typeof TransactionInput>;

/**
 * Import pohybov. `external_id` bráni tomu, aby sa ten istý pohyb naimportoval
 * dvakrát — bez neho by opakované nahratie výpisu zdvojilo tržbu.
 *
 * Transakcie sa ukladajú v stave `received`; rozhodnutie o nich robí až
 * párovanie, aby sa zápis a rozhodovanie nemiešali.
 */
export const importBankTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ transactions: z.array(TransactionInput).min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: inserted, error } = await supabaseAdmin
      .from("bank_transactions")
      .upsert(
        data.transactions.map((t) => ({
          account_id: t.account_id,
          booked_at: t.booked_at,
          value_date: t.value_date || null,
          amount: t.amount,
          currency: (t.currency || "EUR").toUpperCase(),
          counterparty_name: t.counterparty_name || null,
          counterparty_iban: normalizujIban(t.counterparty_iban),
          variable_symbol: t.variable_symbol || null,
          vs_normalized: normalizujSymbol(t.variable_symbol),
          specific_symbol: t.specific_symbol || null,
          constant_symbol: t.constant_symbol || null,
          message: t.message || null,
          external_id: t.external_id || null,
          provider_tx_id: t.provider_tx_id || null,
          status: "received",
        })),
        { onConflict: "account_id,external_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(error.message);
    return { imported: inserted?.length ?? 0, sent: data.transactions.length };
  });

/**
 * Spustí párovanie. Nahrádza pôvodné `autoMatchTransactions`, ktoré vedelo
 * jediné pravidlo a porovnávalo VS s nesprávnym údajom.
 */
export const runMatching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        account_id: z.string().uuid().optional(),
        transaction_ids: z.array(z.string().uuid()).max(200).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    return sparujTransakcie({ accountId: data.account_id, iba: data.transaction_ids });
  });

// --- Ručné zásahy supportu ---------------------------------------------
//
// Všetko sú POST serverové funkcie s auditom. V starom systéme to boli GET
// odkazy bez CSRF a bez záznamu, takže sa stav platby dal zmeniť odkazom
// v e-maile.

/** Ručné priradenie objednávky alebo zrušenie väzby (prázdne `order_id`). */
export const setTransactionMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        transaction_id: z.string().uuid(),
        order_id: z.string().uuid().optional().nullable(),
        reason: z.string().max(500).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: pred } = await supabaseAdmin
      .from("bank_transactions")
      .select("status, matched_order_id, review_reason")
      .eq("id", data.transaction_id)
      .single();

    const po = {
      matched_order_id: data.order_id || null,
      status: data.order_id ? "matched" : "needs_review",
      review_reason: data.order_id ? null : "no_match",
      manual_change: true,
    };
    const { error } = await supabaseAdmin
      .from("bank_transactions")
      .update(po)
      .eq("id", data.transaction_id);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("transaction_matches").insert({
      transaction_id: data.transaction_id,
      order_id: data.order_id || null,
      rule_code: "manual",
      decision: data.order_id ? "matched" : "rejected",
      decided_by: "user",
      decided_by_user: context.userId,
      note: data.reason || null,
    });

    await zapisAudit({
      actor: context.userId,
      action: data.order_id ? "banka.priradenie" : "banka.zrusenie_parovania",
      entity: "bank_transaction",
      entityId: data.transaction_id,
      before: pred,
      after: po,
      reason: data.reason,
    });
    return { ok: true };
  });

/**
 * Oprava variabilného symbolu.
 *
 * Dôvod je povinný: mení sa tým, ku ktorej objednávke platba patrí, a to je
 * rozhodnutie o peniazoch. Po oprave sa transakcia rovno preparuje.
 */
export const changeTransactionVs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        transaction_id: z.string().uuid(),
        variable_symbol: z.string().min(1).max(20),
        reason: z.string().min(3).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const vs = normalizujSymbol(data.variable_symbol);
    if (!vs) throw new Error("Variabilný symbol musí obsahovať číslice.");

    const { data: pred } = await supabaseAdmin
      .from("bank_transactions")
      .select("variable_symbol, vs_normalized, status")
      .eq("id", data.transaction_id)
      .single();

    const { error } = await supabaseAdmin
      .from("bank_transactions")
      .update({
        variable_symbol: data.variable_symbol.trim(),
        vs_normalized: vs,
        manual_change: true,
        status: "parsed",
        review_reason: null,
      })
      .eq("id", data.transaction_id);
    if (error) throw new Error(error.message);

    await zapisAudit({
      actor: context.userId,
      action: "banka.zmena_vs",
      entity: "bank_transaction",
      entityId: data.transaction_id,
      before: pred,
      after: { variable_symbol: data.variable_symbol, vs_normalized: vs },
      reason: data.reason,
    });

    const vysledok = await sparujTransakcie({ iba: [data.transaction_id] });
    return { ok: true, vysledok };
  });

/**
 * Vybavenie platby ako náklad — poplatok, výplata, mylná platba.
 *
 * Dôvod je povinný. Toto je jediný spôsob, ako sa platba dostane zo zoznamu
 * bez toho, aby sa spárovala, takže bez zdôvodnenia by sa dali nepohodlné
 * platby ticho upratať.
 */
export const ignoreTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ transaction_id: z.string().uuid(), reason: z.string().min(3).max(500) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: pred } = await supabaseAdmin
      .from("bank_transactions")
      .select("status, review_reason")
      .eq("id", data.transaction_id)
      .single();

    const { error } = await supabaseAdmin
      .from("bank_transactions")
      .update({ status: "ignored", review_reason: null, manual_change: true, note: data.reason })
      .eq("id", data.transaction_id);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("transaction_matches").insert({
      transaction_id: data.transaction_id,
      rule_code: "manual_expense",
      decision: "rejected",
      decided_by: "user",
      decided_by_user: context.userId,
      note: data.reason,
    });

    await zapisAudit({
      actor: context.userId,
      action: "banka.naklad",
      entity: "bank_transaction",
      entityId: data.transaction_id,
      before: pred,
      after: { status: "ignored" },
      reason: data.reason,
    });
    return { ok: true };
  });

/**
 * Ručné dokončenie objednávky z platby, ktorú engine odmietol.
 *
 * Používa sa napríklad po doplatku alebo keď sa support s kupujúcim dohodol.
 * Vstupenky vydá tá istá cesta ako pri bráne — tu sa nič nekopíruje.
 */
export const completeOrderFromTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        transaction_id: z.string().uuid(),
        order_id: z.string().uuid(),
        reason: z.string().min(3).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: tx } = await supabaseAdmin
      .from("bank_transactions")
      .select("id, amount, currency, booked_at, status")
      .eq("id", data.transaction_id)
      .single();
    if (!tx) throw new Error("Transakcia sa nenašla.");
    if (Number(tx.amount) <= 0) throw new Error("Vstupenky sa nedajú vydať zo zápornej platby.");

    const vysledok = await dokonciZPrevodu(data.order_id, {
      id: tx.id,
      amount: Number(tx.amount),
      currency: tx.currency,
      booked_at: tx.booked_at,
    });

    await supabaseAdmin
      .from("bank_transactions")
      .update({
        status: "matched",
        review_reason: null,
        matched_order_id: data.order_id,
        manual_change: true,
        note: data.reason,
      })
      .eq("id", data.transaction_id);

    await supabaseAdmin.from("transaction_matches").insert({
      transaction_id: data.transaction_id,
      order_id: data.order_id,
      rule_code: "manual_complete",
      decision: "matched",
      paid_amount: Number(tx.amount),
      decided_by: "user",
      decided_by_user: context.userId,
      note: data.reason,
    });

    await zapisAudit({
      actor: context.userId,
      action: "banka.rucne_dokoncenie",
      entity: "order",
      entityId: data.order_id,
      before: { transaction_status: tx.status },
      after: vysledok,
      reason: data.reason,
    });
    return vysledok;
  });

/** Objednávky, ktoré support ponúkne pri ručnom priradení. */
export const searchOrdersForMatching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ query: z.string().max(100) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const dopyt = data.query.trim();
    if (dopyt.length < 3) return [];

    const cislice = dopyt.replace(/\D/g, "");
    let q = supabaseAdmin
      .from("orders")
      .select("id, payment_vs, customer_name, customer_email, total_amount, currency, status")
      .limit(20);

    if (cislice && cislice.length >= 3) {
      q = q.eq("payment_vs", Number(cislice));
    } else {
      q = q.ilike("customer_email", `%${dopyt}%`);
    }
    const { data: rows } = await q;
    return (rows || []).map((o) => ({
      id: o.id,
      vs: o.payment_vs != null ? String(o.payment_vs).padStart(10, "0") : null,
      customer: o.customer_name || o.customer_email || "—",
      total: Number(o.total_amount),
      currency: o.currency,
      status: o.status,
    }));
  });

// --- Prehľady -----------------------------------------------------------

export type BankReportRow = {
  month: string;
  incoming: number;
  outgoing: number;
  matched: number;
  unmatched: number;
  count: number;
};

/** Mesačný prehľad pohybov — podklad pre stránku „Účtovanie / report". */
export const bankReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ account_id: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<BankReportRow[]> => {
    await assertAdmin(context.userId);
    let q = supabaseAdmin.from("bank_transactions").select("booked_at, amount, status").limit(5000);
    if (data.account_id) q = q.eq("account_id", data.account_id);
    const { data: rows } = await q;

    const byMonth = new Map<string, BankReportRow>();
    for (const t of rows || []) {
      const month = String(t.booked_at).slice(0, 7);
      const cur = byMonth.get(month) ?? {
        month,
        incoming: 0,
        outgoing: 0,
        matched: 0,
        unmatched: 0,
        count: 0,
      };
      const amount = Number(t.amount);
      if (amount >= 0) cur.incoming += amount;
      else cur.outgoing += Math.abs(amount);
      if (t.status === "matched") cur.matched += 1;
      else if (t.status === "needs_review" || t.status === "parse_error") cur.unmatched += 1;
      cur.count += 1;
      byMonth.set(month, cur);
    }

    return [...byMonth.values()]
      .map((r) => ({
        ...r,
        incoming: Math.round(r.incoming * 100) / 100,
        outgoing: Math.round(r.outgoing * 100) / 100,
      }))
      .sort((a, b) => b.month.localeCompare(a.month));
  });

/** História rozhodnutí o transakcii — čo ktoré pravidlo povedalo a kedy. */
export const transactionHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ transaction_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: rows } = await supabaseAdmin
      .from("transaction_matches")
      .select("*")
      .eq("transaction_id", data.transaction_id)
      .order("decided_at", { ascending: false });
    return (rows || []).map((m) => ({
      id: m.id,
      rule_code: m.rule_code,
      decision: m.decision,
      order_id: m.order_id,
      expected_amount: m.expected_amount != null ? Number(m.expected_amount) : null,
      paid_amount: m.paid_amount != null ? Number(m.paid_amount) : null,
      difference: m.difference != null ? Number(m.difference) : null,
      confidence: Number(m.confidence),
      decided_by: m.decided_by,
      decided_at: m.decided_at,
      note: m.note,
    }));
  });
