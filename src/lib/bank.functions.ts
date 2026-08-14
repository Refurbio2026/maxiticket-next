// Bankové účty, pohyby a ich párovanie s objednávkami.
//
// Predtým to bol localStorage: výpis videl len ten, kto ho naimportoval, a po
// vymazaní cache prehliadača bol preč. Párovanie pritom rozhoduje o tom, či sa
// objednávka platená prevodom považuje za zaplatenú.
//
// Variabilný symbol je prvých osem znakov id objednávky — rovnaká konvencia
// ako pri GoPay a faktúrach.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BankAccountRecord = {
  id: string;
  bank_name: string;
  account_name: string;
  iban: string;
  currency: string;
  balance: number;
  connected: boolean;
  last_sync_at: string | null;
  transactions_count: number;
  unmatched_count: number;
};

export type BankTransactionRecord = {
  id: string;
  account_id: string;
  booked_on: string;
  amount: number;
  currency: string;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  variable_symbol: string | null;
  message: string | null;
  match_status: "matched" | "unmatched" | "pending";
  matched_order_id: string | null;
  /** Krátke id spárovanej objednávky pre výpis. */
  matched_order_short: string | null;
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
      .select("account_id, match_status");
    const total = new Map<string, number>();
    const unmatched = new Map<string, number>();
    for (const t of txs || []) {
      total.set(t.account_id, (total.get(t.account_id) || 0) + 1);
      if (t.match_status !== "matched") {
        unmatched.set(t.account_id, (unmatched.get(t.account_id) || 0) + 1);
      }
    }

    return (accounts || []).map((a) => ({
      id: a.id,
      bank_name: a.bank_name,
      account_name: a.account_name,
      iban: a.iban,
      currency: a.currency,
      balance: Number(a.balance),
      connected: a.connected,
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
        iban: z.string().min(5).max(50),
        currency: z.string().min(3).max(3).default("EUR"),
        balance: z.number().default(0),
        connected: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.userId);
    const row = {
      bank_name: data.bank_name.trim(),
      account_name: data.account_name.trim(),
      iban: data.iban.replace(/\s+/g, "").toUpperCase(),
      currency: data.currency.toUpperCase(),
      balance: data.balance,
      connected: data.connected,
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

export const listBankTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        account_id: z.string().uuid().optional(),
        status: z.enum(["matched", "unmatched", "pending", "all"]).default("all"),
        limit: z.number().int().positive().max(1000).default(300),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<BankTransactionRecord[]> => {
    await assertAdmin(context.userId);
    let q = supabaseAdmin
      .from("bank_transactions")
      .select("*")
      .order("booked_on", { ascending: false })
      .limit(data.limit);
    if (data.account_id) q = q.eq("account_id", data.account_id);
    if (data.status !== "all") q = q.eq("match_status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    return (rows || []).map((t) => ({
      id: t.id,
      account_id: t.account_id,
      booked_on: t.booked_on,
      amount: Number(t.amount),
      currency: t.currency,
      counterparty_name: t.counterparty_name,
      counterparty_iban: t.counterparty_iban,
      variable_symbol: t.variable_symbol,
      message: t.message,
      match_status: t.match_status as BankTransactionRecord["match_status"],
      matched_order_id: t.matched_order_id,
      matched_order_short: t.matched_order_id ? t.matched_order_id.slice(0, 8).toUpperCase() : null,
    }));
  });

const TransactionInput = z.object({
  account_id: z.string().uuid(),
  booked_on: z.string().min(1),
  amount: z.number(),
  currency: z.string().max(3).default("EUR"),
  counterparty_name: z.string().max(300).optional().nullable(),
  counterparty_iban: z.string().max(50).optional().nullable(),
  variable_symbol: z.string().max(40).optional().nullable(),
  message: z.string().max(1000).optional().nullable(),
  external_id: z.string().max(200).optional().nullable(),
});

export type BankTransactionInput = z.input<typeof TransactionInput>;

/**
 * Import pohybov z výpisu. `external_id` bráni tomu, aby sa ten istý pohyb
 * naimportoval dvakrát — bez neho by opakované nahratie výpisu zdvojilo tržbu.
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
          booked_on: t.booked_on,
          amount: t.amount,
          currency: (t.currency || "EUR").toUpperCase(),
          counterparty_name: t.counterparty_name || null,
          counterparty_iban: t.counterparty_iban || null,
          variable_symbol: t.variable_symbol || null,
          message: t.message || null,
          external_id: t.external_id || null,
          match_status: "unmatched",
        })),
        { onConflict: "account_id,external_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(error.message);
    return { imported: inserted?.length ?? 0, sent: data.transactions.length };
  });

/**
 * Spáruje nespárované pohyby s objednávkami podľa variabilného symbolu a sumy.
 *
 * Páruje len vtedy, keď sedí aj suma — samotný variabilný symbol vie zákazník
 * odpísať zle a spárovaním by sa objednávka označila za zaplatenú neprávom.
 */
export const autoMatchTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ account_id: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    let q = supabaseAdmin
      .from("bank_transactions")
      .select("id, amount, variable_symbol")
      .eq("match_status", "unmatched")
      .not("variable_symbol", "is", null);
    if (data.account_id) q = q.eq("account_id", data.account_id);
    const { data: txs } = await q;
    if (!txs || txs.length === 0) return { matched: 0, checked: 0 };

    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("id, total_amount, status")
      .in("status", ["pending", "awaiting_payment", "paid"]);

    // Variabilný symbol = prvých 8 znakov id objednávky, veľkými písmenami.
    const byVs = new Map<string, { id: string; total: number }[]>();
    for (const o of orders || []) {
      const vs = o.id.slice(0, 8).toUpperCase();
      const list = byVs.get(vs) || [];
      list.push({ id: o.id, total: Number(o.total_amount) });
      byVs.set(vs, list);
    }

    let matched = 0;
    for (const t of txs) {
      const vs = (t.variable_symbol || "").trim().toUpperCase();
      const candidates = byVs.get(vs) || [];
      const hit = candidates.find((c) => Math.abs(c.total - Number(t.amount)) < 0.01);
      if (!hit) continue;
      await supabaseAdmin
        .from("bank_transactions")
        .update({
          match_status: "matched",
          matched_order_id: hit.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", t.id);
      matched++;
    }
    return { matched, checked: txs.length };
  });

/** Ručné spárovanie alebo jeho zrušenie. Prázdne `order_id` väzbu odstráni. */
export const setTransactionMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        transaction_id: z.string().uuid(),
        order_id: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("bank_transactions")
      .update({
        matched_order_id: data.order_id || null,
        match_status: data.order_id ? "matched" : "unmatched",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.transaction_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

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
    let q = supabaseAdmin
      .from("bank_transactions")
      .select("booked_on, amount, match_status")
      .limit(5000);
    if (data.account_id) q = q.eq("account_id", data.account_id);
    const { data: rows } = await q;

    const byMonth = new Map<string, BankReportRow>();
    for (const t of rows || []) {
      const month = String(t.booked_on).slice(0, 7);
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
      if (t.match_status === "matched") cur.matched += 1;
      else cur.unmatched += 1;
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
