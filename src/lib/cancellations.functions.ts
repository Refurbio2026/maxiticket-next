// Prehľad storien a refundácií.
//
// Čerpá z `orders.refunded_*`, kam píše webový refund (`refundOrder`) aj storno
// z pokladne (`voidPosSale`). Plné storno má objednávku v stave `refunded`,
// čiastočný refund ju necháva `paid` — do prehľadu patria oba, preto sa
// nefiltruje podľa stavu, ale podľa vrátenej sumy.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CancellationRow = {
  order_id: string;
  refunded_at: string | null;
  /** `web` alebo `pos` — kanál pôvodného predaja. */
  channel: string;
  /** Plné storno vs. čiastočný refund. */
  full: boolean;
  total_amount: number;
  refunded_amount: number;
  currency: string;
  reason: string | null;
  /** Kto refund spracoval; pri starších záznamoch nemusí byť známy. */
  refunded_by_name: string | null;
  customer_name: string | null;
  customer_email: string | null;
  event_title: string | null;
  event_date: string | null;
  receipt_number: string | null;
  tickets_count: number;
};

export type CancellationSummary = {
  count: number;
  refunded_amount: number;
  /** Koľko sa za rovnaké obdobie predalo — bez toho je suma bez mierky. */
  paid_amount: number;
  full_count: number;
  partial_count: number;
  by_reason: { reason: string; count: number; amount: number }[];
};

export type CancellationsResult = {
  rows: CancellationRow[];
  summary: CancellationSummary;
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

export const listCancellations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        /** Vrátane tohto dňa. */
        from: z.string().optional().nullable(),
        /** Vrátane tohto dňa. */
        to: z.string().optional().nullable(),
        channel: z.enum(["all", "web", "pos"]).default("all"),
        search: z.string().max(200).optional().nullable(),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<CancellationsResult> => {
    await assertAdmin(context.userId);

    let q = supabaseAdmin
      .from("orders")
      .select(
        "id, channel, status, total_amount, refunded_amount, refunded_at, refund_reason, refunded_by, currency, customer_name, customer_email, receipt_number, event_id, event_date_id",
      )
      .gt("refunded_amount", 0)
      .order("refunded_at", { ascending: false, nullsFirst: false })
      .limit(data.limit);

    if (data.from) q = q.gte("refunded_at", `${data.from}T00:00:00`);
    if (data.to) q = q.lte("refunded_at", `${data.to}T23:59:59`);
    if (data.channel !== "all") q = q.eq("channel", data.channel);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const orders = rows || [];
    const eventIds = [...new Set(orders.map((o) => o.event_id).filter(Boolean))];
    const dateIds = [...new Set(orders.map((o) => o.event_date_id).filter(Boolean))];
    const userIds = [...new Set(orders.map((o) => o.refunded_by).filter(Boolean))] as string[];
    const orderIds = orders.map((o) => o.id);

    const [{ data: events }, { data: dates }, { data: profiles }, { data: tickets }, paidTotal] =
      await Promise.all([
        eventIds.length
          ? supabaseAdmin.from("events").select("id, title").in("id", eventIds)
          : Promise.resolve({ data: [] as { id: string; title: string }[] }),
        dateIds.length
          ? supabaseAdmin.from("event_dates").select("id, event_date").in("id", dateIds)
          : Promise.resolve({ data: [] as { id: string; event_date: string }[] }),
        userIds.length
          ? supabaseAdmin.from("profiles").select("id, full_name").in("id", userIds)
          : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
        orderIds.length
          ? supabaseAdmin.from("tickets").select("order_id").in("order_id", orderIds)
          : Promise.resolve({ data: [] as { order_id: string }[] }),
        // Predaj za rovnaké obdobie — kvôli mierke pri sume storien.
        loadPaidTotal(data.from, data.to, data.channel),
      ]);

    const eventTitles = new Map((events || []).map((e) => [e.id, e.title]));
    const eventDates = new Map((dates || []).map((d) => [d.id, d.event_date]));
    const names = new Map((profiles || []).map((p) => [p.id, p.full_name]));
    const ticketCounts = new Map<string, number>();
    for (const t of tickets || []) {
      ticketCounts.set(t.order_id, (ticketCounts.get(t.order_id) || 0) + 1);
    }

    let list: CancellationRow[] = orders.map((o) => {
      const refunded = Number(o.refunded_amount || 0);
      const total = Number(o.total_amount || 0);
      return {
        order_id: o.id,
        refunded_at: o.refunded_at,
        channel: o.channel || "web",
        full: Math.abs(refunded - total) < 0.01,
        total_amount: total,
        refunded_amount: refunded,
        currency: o.currency || "EUR",
        reason: o.refund_reason,
        refunded_by_name: o.refunded_by ? (names.get(o.refunded_by) ?? null) : null,
        customer_name: o.customer_name,
        customer_email: o.customer_email,
        event_title: eventTitles.get(o.event_id) ?? null,
        event_date: eventDates.get(o.event_date_id) ?? null,
        receipt_number: o.receipt_number,
        tickets_count: ticketCounts.get(o.id) || 0,
      };
    });

    // Hľadanie ide až nad načítaným zoznamom — mieša stĺpce z viacerých tabuliek
    // (názov podujatia, meno spracovateľa), ktoré sa v jednom dotaze filtrovať nedajú.
    if (data.search) {
      const s = data.search.trim().toLowerCase();
      list = list.filter((r) =>
        [
          r.customer_name,
          r.customer_email,
          r.event_title,
          r.reason,
          r.receipt_number,
          r.refunded_by_name,
          r.order_id,
        ].some((v) => (v ?? "").toLowerCase().includes(s)),
      );
    }

    const byReason = new Map<string, { count: number; amount: number }>();
    for (const r of list) {
      const key = r.reason?.trim() || "Bez uvedeného dôvodu";
      const cur = byReason.get(key) || { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += r.refunded_amount;
      byReason.set(key, cur);
    }

    return {
      rows: list,
      summary: {
        count: list.length,
        refunded_amount: round(list.reduce((s, r) => s + r.refunded_amount, 0)),
        paid_amount: round(paidTotal.total),
        full_count: list.filter((r) => r.full).length,
        partial_count: list.filter((r) => !r.full).length,
        by_reason: [...byReason.entries()]
          .map(([reason, v]) => ({ reason, count: v.count, amount: round(v.amount) }))
          .sort((a, b) => b.amount - a.amount),
      },
    };
  });

/** Zaplatené za rovnaké obdobie, aby mala suma storien mierku. */
async function loadPaidTotal(
  from?: string | null,
  to?: string | null,
  channel?: string,
): Promise<{ total: number }> {
  let q = supabaseAdmin.from("orders").select("total_amount, paid_at").not("paid_at", "is", null);
  if (from) q = q.gte("paid_at", `${from}T00:00:00`);
  if (to) q = q.lte("paid_at", `${to}T23:59:59`);
  if (channel && channel !== "all") q = q.eq("channel", channel);
  const { data } = await q;
  return { total: (data || []).reduce((s, o) => s + Number(o.total_amount || 0), 0) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
