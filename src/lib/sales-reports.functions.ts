// Reporty predajov — jedno obdobie, viac spôsobov, ako sa naň pozrieť.
//
// Základ je vždy ten istý: zaplatené objednávky. Refundácie sa odpočítavajú
// z objednávky (`refunded_amount`), takže čísla sedia s tým, čo naozaj ostalo
// na účte, nie s tým, čo sa kedysi predalo.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SalesReportRow = {
  key: string;
  label: string;
  sublabel: string | null;
  orders: number;
  tickets: number;
  gross: number;
  refunded: number;
  /** Tržba po odpočítaní refundácií — to je to, čo ostalo. */
  net: number;
};

export type SalesReportResult = {
  rows: SalesReportRow[];
  totals: { orders: number; tickets: number; gross: number; refunded: number; net: number };
  /** Denný priebeh za obdobie, na graf. */
  timeline: { day: string; net: number; orders: number }[];
};

export type SalesReportGroup = "event" | "organizer" | "channel" | "day" | "category";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

export const salesReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        from: z.string().optional().nullable(),
        to: z.string().optional().nullable(),
        group_by: z.enum(["event", "organizer", "channel", "day", "category"]).default("event"),
        organizer_id: z.string().uuid().optional().nullable(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<SalesReportResult> => {
    await assertAdmin(context.userId);

    let q = supabaseAdmin
      .from("orders")
      .select("id, event_id, channel, total_amount, refunded_amount, paid_at")
      .not("paid_at", "is", null)
      .order("paid_at", { ascending: true })
      .limit(5000);
    if (data.from) q = q.gte("paid_at", `${data.from}T00:00:00`);
    if (data.to) q = q.lte("paid_at", `${data.to}T23:59:59`);

    const { data: orderRows, error } = await q;
    if (error) throw new Error(error.message);

    let orders = orderRows || [];
    const eventIds = [...new Set(orders.map((o) => o.event_id).filter(Boolean))];

    const [{ data: events }, { data: tickets }] = await Promise.all([
      eventIds.length
        ? supabaseAdmin
            .from("events")
            .select("id, title, event_date, city, category, organizer_id")
            .in("id", eventIds)
        : Promise.resolve({ data: [] as EventRef[] }),
      orders.length
        ? supabaseAdmin
            .from("tickets")
            .select("order_id")
            .in(
              "order_id",
              orders.map((o) => o.id),
            )
            .is("refunded_at", null)
        : Promise.resolve({ data: [] as { order_id: string }[] }),
    ]);

    const eventMap = new Map((events || []).map((e) => [e.id, e]));

    // Filter podľa organizátora sa dá uplatniť až tu — objednávka o ňom nevie,
    // vlastníkom je podujatie.
    if (data.organizer_id) {
      orders = orders.filter((o) => eventMap.get(o.event_id)?.organizer_id === data.organizer_id);
    }

    const organizerIds = [
      ...new Set((events || []).map((e) => e.organizer_id).filter(Boolean)),
    ] as string[];
    const { data: profiles } = organizerIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, full_name, company_name")
          .in("id", organizerIds)
      : { data: [] as { id: string; full_name: string | null; company_name: string | null }[] };
    const names = new Map(
      (profiles || []).map((p) => [p.id, p.company_name || p.full_name || "—"]),
    );

    const ticketsByOrder = new Map<string, number>();
    for (const t of tickets || []) {
      ticketsByOrder.set(t.order_id, (ticketsByOrder.get(t.order_id) || 0) + 1);
    }

    const buckets = new Map<string, SalesReportRow>();
    const timeline = new Map<string, { net: number; orders: number }>();

    for (const o of orders) {
      const e = eventMap.get(o.event_id);
      const day = (o.paid_at || "").slice(0, 10);
      const gross = Number(o.total_amount || 0);
      const refunded = Number(o.refunded_amount || 0);

      const { key, label, sublabel } = bucketOf(data.group_by, o, e, names, day);
      const b = buckets.get(key) ?? {
        key,
        label,
        sublabel,
        orders: 0,
        tickets: 0,
        gross: 0,
        refunded: 0,
        net: 0,
      };
      b.orders += 1;
      b.tickets += ticketsByOrder.get(o.id) || 0;
      b.gross += gross;
      b.refunded += refunded;
      b.net += gross - refunded;
      buckets.set(key, b);

      const t = timeline.get(day) ?? { net: 0, orders: 0 };
      t.net += gross - refunded;
      t.orders += 1;
      timeline.set(day, t);
    }

    const rows = [...buckets.values()]
      .map((b) => ({
        ...b,
        gross: round2(b.gross),
        refunded: round2(b.refunded),
        net: round2(b.net),
      }))
      // Podľa dňa chce človek chronologicky, inak od najväčšieho.
      .sort((a, b) => (data.group_by === "day" ? a.key.localeCompare(b.key) : b.net - a.net));

    return {
      rows,
      totals: {
        orders: rows.reduce((s, r) => s + r.orders, 0),
        tickets: rows.reduce((s, r) => s + r.tickets, 0),
        gross: round2(rows.reduce((s, r) => s + r.gross, 0)),
        refunded: round2(rows.reduce((s, r) => s + r.refunded, 0)),
        net: round2(rows.reduce((s, r) => s + r.net, 0)),
      },
      timeline: [...timeline.entries()]
        .map(([day, v]) => ({ day, net: round2(v.net), orders: v.orders }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    };
  });

type EventRef = {
  id: string;
  title: string;
  event_date: string;
  city: string;
  category: string;
  organizer_id: string;
};

type OrderRef = {
  id: string;
  event_id: string;
  channel: string;
  total_amount: number;
  refunded_amount: number;
  paid_at: string | null;
};

function bucketOf(
  groupBy: SalesReportGroup,
  o: OrderRef,
  e: EventRef | undefined,
  names: Map<string, string>,
  day: string,
): { key: string; label: string; sublabel: string | null } {
  switch (groupBy) {
    case "organizer": {
      const id = e?.organizer_id ?? "—";
      return { key: id, label: names.get(id) || "—", sublabel: null };
    }
    case "channel":
      return {
        key: o.channel || "web",
        label: o.channel === "pos" ? "Pokladňa" : "Web",
        sublabel: null,
      };
    case "day":
      return { key: day, label: day, sublabel: null };
    case "category": {
      const c = e?.category || "—";
      return { key: c, label: c, sublabel: null };
    }
    default:
      return {
        key: o.event_id,
        label: e?.title || "—",
        sublabel: e ? `${e.event_date} · ${e.city}` : null,
      };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
