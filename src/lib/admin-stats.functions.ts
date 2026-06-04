// Server functions powering the admin dashboard.
// Every fn re-checks admin role via user_roles (RLS would otherwise hide rows).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

export type OverviewKPI = {
  today_revenue: number;
  today_tickets: number;
  active_events: number;
  organizers: number;
  pending_refunds: number;
  paid_orders_total: number;
};

export type DailyPoint = { d: string; revenue: number; tickets: number };
export type TopEvent = { id: string; name: string; sold: number };
export type RecentOrder = {
  id: string;
  event_title: string | null;
  customer_email: string | null;
  total_amount: number;
  status: string;
  created_at: string;
  qty: number;
};

export type AdminOverview = {
  kpi: OverviewKPI;
  series: DailyPoint[];
  top_events: TopEvent[];
  recent_orders: RecentOrder[];
};

export const getAdminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminOverview> => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const start7 = new Date(Date.now() - 6 * 86400_000);
    start7.setHours(0, 0, 0, 0);

    const [todayOrdersRes, weekOrdersRes, eventsRes, organizersRes, refundsRes, paidTotalRes, topRes, recentRes] =
      await Promise.all([
        supabaseAdmin
          .from("orders")
          .select("total_amount, id")
          .eq("status", "paid")
          .gte("paid_at", startToday),
        supabaseAdmin
          .from("orders")
          .select("total_amount, paid_at, id")
          .eq("status", "paid")
          .gte("paid_at", start7.toISOString()),
        supabaseAdmin
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("status", "published"),
        supabaseAdmin
          .from("user_roles")
          .select("user_id", { count: "exact", head: true })
          .eq("role", "organizer"),
        supabaseAdmin
          .from("orders")
          .select("id", { count: "exact", head: true })
          .in("status", ["refunded"]),
        supabaseAdmin.from("orders").select("total_amount").eq("status", "paid"),
        supabaseAdmin
          .from("tickets")
          .select("event_id, events ( id, title )")
          .limit(2000),
        supabaseAdmin
          .from("orders")
          .select("id, customer_email, total_amount, status, created_at, event_id, events ( title ), order_items ( quantity )")
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

    // tickets today (count of tickets with issued_at today)
    const { count: todayTickets } = await supabaseAdmin
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .gte("issued_at", startToday);

    const today_revenue = (todayOrdersRes.data || []).reduce(
      (s, r: any) => s + Number(r.total_amount || 0),
      0,
    );
    const paid_orders_total = (paidTotalRes.data || []).reduce(
      (s, r: any) => s + Number(r.total_amount || 0),
      0,
    );

    // Build 7-day series
    const buckets = new Map<string, { revenue: number; tickets: number }>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(start7.getTime() + i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { revenue: 0, tickets: 0 });
    }
    for (const r of weekOrdersRes.data || []) {
      const key = (r as any).paid_at?.slice(0, 10);
      const b = key && buckets.get(key);
      if (b) b.revenue += Number((r as any).total_amount || 0);
    }
    // tickets per day
    const { data: weekTickets } = await supabaseAdmin
      .from("tickets")
      .select("issued_at")
      .gte("issued_at", start7.toISOString());
    for (const t of weekTickets || []) {
      const key = (t as any).issued_at?.slice(0, 10);
      const b = key && buckets.get(key);
      if (b) b.tickets += 1;
    }
    const dayLabels = ["Ne", "Po", "Ut", "St", "Št", "Pi", "So"];
    const series: DailyPoint[] = [...buckets.entries()].map(([key, v]) => {
      const d = new Date(key + "T00:00:00");
      return { d: dayLabels[d.getDay()], revenue: v.revenue, tickets: v.tickets };
    });

    // Top events (aggregate from tickets sample)
    const evMap = new Map<string, { name: string; sold: number }>();
    for (const t of topRes.data || []) {
      const ev = (t as any).events;
      if (!ev?.id) continue;
      const cur = evMap.get(ev.id) || { name: ev.title, sold: 0 };
      cur.sold += 1;
      evMap.set(ev.id, cur);
    }
    const top_events: TopEvent[] = [...evMap.entries()]
      .map(([id, v]) => ({ id, name: v.name, sold: v.sold }))
      .sort((a, b) => b.sold - a.sold)
      .slice(0, 6);

    const recent_orders: RecentOrder[] = (recentRes.data || []).map((r: any) => ({
      id: r.id,
      event_title: r.events?.title ?? null,
      customer_email: r.customer_email,
      total_amount: Number(r.total_amount || 0),
      status: r.status,
      created_at: r.created_at,
      qty: (r.order_items || []).reduce((s: number, it: any) => s + Number(it.quantity || 0), 0),
    }));

    return {
      kpi: {
        today_revenue,
        today_tickets: todayTickets || 0,
        active_events: eventsRes.count || 0,
        organizers: organizersRes.count || 0,
        pending_refunds: refundsRes.count || 0,
        paid_orders_total,
      },
      series,
      top_events,
      recent_orders,
    };
  });

// ---------- Orders list (admin sales) ----------
export type AdminOrderRow = {
  id: string;
  created_at: string;
  paid_at: string | null;
  status: string;
  total_amount: number;
  currency: string;
  customer_name: string | null;
  customer_email: string | null;
  event_title: string | null;
  qty: number;
  invoice_number: string | null;
  invoice_pdf_url: string | null;
};

export const listAdminOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        status: z.string().optional().nullable(),
        search: z.string().max(200).optional().nullable(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<AdminOrderRow[]> => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("orders")
      .select(
        "id, created_at, paid_at, status, total_amount, currency, customer_name, customer_email, superfaktura_invoice_number, superfaktura_invoice_pdf_url, events ( title ), order_items ( quantity )",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status && data.status !== "all") q = q.eq("status", data.status as any);
    if (data.search) {
      const s = data.search.trim();
      q = q.or(`customer_email.ilike.%${s}%,customer_name.ilike.%${s}%,id.eq.${s}`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows || []).map((r: any) => ({
      id: r.id,
      created_at: r.created_at,
      paid_at: r.paid_at,
      status: r.status,
      total_amount: Number(r.total_amount || 0),
      currency: r.currency,
      customer_name: r.customer_name,
      customer_email: r.customer_email,
      event_title: r.events?.title ?? null,
      qty: (r.order_items || []).reduce((s: number, it: any) => s + Number(it.quantity || 0), 0),
      invoice_number: r.superfaktura_invoice_number,
      invoice_pdf_url: r.superfaktura_invoice_pdf_url,
    }));
  });

// ---------- Finance stats ----------
export type FinanceStats = {
  total_paid_amount: number;
  total_paid_orders: number;
  total_pending_amount: number;
  total_pending_orders: number;
  total_refunded_amount: number;
  total_refunded_orders: number;
  invoices_issued: number;
  invoices_failed: number;
  by_provider: { provider: string; amount: number; count: number }[];
  monthly: { month: string; revenue: number; orders: number }[];
};

export const getFinanceStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FinanceStats> => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const since = new Date();
    since.setMonth(since.getMonth() - 5);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const [ordersRes, paymentsRes, sfRes] = await Promise.all([
      supabaseAdmin.from("orders").select("total_amount, status, paid_at, created_at"),
      supabaseAdmin.from("payments").select("provider, amount, status"),
      supabaseAdmin.from("superfaktura_logs").select("status"),
    ]);

    let total_paid_amount = 0,
      total_paid_orders = 0,
      total_pending_amount = 0,
      total_pending_orders = 0,
      total_refunded_amount = 0,
      total_refunded_orders = 0;

    const monthly = new Map<string, { revenue: number; orders: number }>();
    for (let i = 0; i < 6; i++) {
      const d = new Date(since);
      d.setMonth(since.getMonth() + i);
      monthly.set(d.toISOString().slice(0, 7), { revenue: 0, orders: 0 });
    }

    for (const o of ordersRes.data || []) {
      const amt = Number((o as any).total_amount || 0);
      if ((o as any).status === "paid") {
        total_paid_amount += amt;
        total_paid_orders += 1;
        const key = ((o as any).paid_at || (o as any).created_at || "").slice(0, 7);
        const b = monthly.get(key);
        if (b) {
          b.revenue += amt;
          b.orders += 1;
        }
      } else if ((o as any).status === "pending" || (o as any).status === "awaiting_payment") {
        total_pending_amount += amt;
        total_pending_orders += 1;
      } else if ((o as any).status === "refunded") {
        total_refunded_amount += amt;
        total_refunded_orders += 1;
      }
    }

    const providerMap = new Map<string, { amount: number; count: number }>();
    for (const p of paymentsRes.data || []) {
      if ((p as any).status !== "paid") continue;
      const key = (p as any).provider || "unknown";
      const cur = providerMap.get(key) || { amount: 0, count: 0 };
      cur.amount += Number((p as any).amount || 0);
      cur.count += 1;
      providerMap.set(key, cur);
    }

    const invoices_issued = (sfRes.data || []).filter((r: any) => r.status === "ok").length;
    const invoices_failed = (sfRes.data || []).filter((r: any) => r.status === "error").length;

    return {
      total_paid_amount,
      total_paid_orders,
      total_pending_amount,
      total_pending_orders,
      total_refunded_amount,
      total_refunded_orders,
      invoices_issued,
      invoices_failed,
      by_provider: [...providerMap.entries()].map(([provider, v]) => ({ provider, ...v })),
      monthly: [...monthly.entries()].map(([month, v]) => ({ month, ...v })),
    };
  });

// ---------- Live scan stats across all events (admin) ----------
export type ScanEventRow = {
  event_id: string;
  event_title: string;
  event_date: string;
  sold: number;
  used: number;
  remaining: number;
};

export const getScanStatsAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ScanEventRow[]> => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: events } = await supabaseAdmin
      .from("events")
      .select("id, title, event_date")
      .eq("status", "published")
      .order("event_date", { ascending: true })
      .limit(50);

    const rows: ScanEventRow[] = [];
    for (const e of events || []) {
      const [{ count: sold }, { count: used }] = await Promise.all([
        supabaseAdmin.from("tickets").select("id", { count: "exact", head: true }).eq("event_id", (e as any).id),
        supabaseAdmin
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("event_id", (e as any).id)
          .not("used_at", "is", null),
      ]);
      const s = sold || 0;
      const u = used || 0;
      if (s === 0) continue;
      rows.push({
        event_id: (e as any).id,
        event_title: (e as any).title,
        event_date: (e as any).event_date,
        sold: s,
        used: u,
        remaining: Math.max(0, s - u),
      });
    }
    return rows;
  });
