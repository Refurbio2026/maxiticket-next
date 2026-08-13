// Vyúčtovanie organizátorom: sadzby, prepočet za obdobie a vyúčtovacie protokoly.
//
// Peniaze od kupujúcich chodia na účet platformy, takže organizátorovi treba
// vedieť povedať (a doložiť), koľko mu z toho patrí. Protokol si čísla zmrazí
// pri vytvorení — neskoršia refundácia už nesmie prepísať to, čo bolo
// odsúhlasené a vyplatené.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

async function defaultCommissionRate(): Promise<number> {
  const { data } = await supabaseAdmin
    .from("platform_settings")
    .select("default_commission_rate")
    .maybeSingle();
  return Number(data?.default_commission_rate ?? 10);
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type OrganizerAccount = {
  id: string;
  full_name: string | null;
  email: string;
  company_name: string | null;
  ico: string | null;
  dic: string | null;
  ic_dph: string | null;
  billing_address: string | null;
  phone: string | null;
  payout_iban: string | null;
  /** NULL = platí predvolená sadzba platformy. */
  commission_rate: number | null;
  effective_rate: number;
  events_count: number;
  gross_all_time: number;
  settled_all_time: number;
};

/** Organizátori s fakturačnými údajmi, sadzbou a hrubým prehľadom tržieb. */
export const listOrganizerAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OrganizerAccount[]> => {
    await assertAdmin(context.userId);
    const fallback = await defaultCommissionRate();

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "organizer");
    const ids = [...new Set((roles || []).map((r) => r.user_id))];
    if (ids.length === 0) return [];

    const [{ data: profiles }, { data: events }, { data: authList }, { data: settlements }] =
      await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select(
            "id, full_name, company_name, ico, dic, ic_dph, billing_address, phone, payout_iban, commission_rate",
          )
          .in("id", ids),
        supabaseAdmin.from("events").select("id, organizer_id").in("organizer_id", ids),
        supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        supabaseAdmin
          .from("settlements")
          .select("organizer_id, net_amount, status")
          .in("organizer_id", ids),
      ]);

    const emails = new Map((authList?.users || []).map((u) => [u.id, u.email || ""]));
    const eventsByOrganizer = new Map<string, string[]>();
    for (const e of events || []) {
      const list = eventsByOrganizer.get(e.organizer_id as string) || [];
      list.push(e.id as string);
      eventsByOrganizer.set(e.organizer_id as string, list);
    }

    // Hrubá tržba za celý čas — z objednávok, ktoré sa niekedy zaplatili.
    const allEventIds = (events || []).map((e) => e.id as string);
    const grossByEvent = new Map<string, number>();
    if (allEventIds.length > 0) {
      const { data: orders } = await supabaseAdmin
        .from("orders")
        .select("event_id, total_amount, status")
        .in("event_id", allEventIds)
        .in("status", ["paid", "refunded"]);
      for (const o of orders || []) {
        const id = o.event_id as string;
        grossByEvent.set(id, (grossByEvent.get(id) || 0) + Number(o.total_amount || 0));
      }
    }

    const settledByOrganizer = new Map<string, number>();
    for (const s of settlements || []) {
      if (s.status !== "paid") continue;
      const id = s.organizer_id as string;
      settledByOrganizer.set(id, (settledByOrganizer.get(id) || 0) + Number(s.net_amount || 0));
    }

    return (profiles || [])
      .map((p) => {
        const evIds = eventsByOrganizer.get(p.id) || [];
        const gross = evIds.reduce((s, id) => s + (grossByEvent.get(id) || 0), 0);
        const rate = p.commission_rate === null ? null : Number(p.commission_rate);
        return {
          id: p.id,
          full_name: p.full_name,
          email: emails.get(p.id) || "",
          company_name: p.company_name,
          ico: p.ico,
          dic: p.dic,
          ic_dph: p.ic_dph,
          billing_address: p.billing_address,
          phone: p.phone,
          payout_iban: p.payout_iban,
          commission_rate: rate,
          effective_rate: rate ?? fallback,
          events_count: evIds.length,
          gross_all_time: round2(gross),
          settled_all_time: round2(settledByOrganizer.get(p.id) || 0),
        };
      })
      .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
  });

/** Fakturačné a výplatné údaje organizátora vrátane jeho sadzby. */
export const updateOrganizerAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        company_name: z.string().max(300).optional().nullable(),
        ico: z.string().max(40).optional().nullable(),
        dic: z.string().max(40).optional().nullable(),
        ic_dph: z.string().max(40).optional().nullable(),
        billing_address: z.string().max(500).optional().nullable(),
        phone: z.string().max(60).optional().nullable(),
        payout_iban: z.string().max(60).optional().nullable(),
        commission_rate: z.number().min(0).max(100).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { id, ...rest } = data;
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getPlatformSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ default_commission_rate: number }> => {
    await assertAdmin(context.userId);
    return { default_commission_rate: await defaultCommissionRate() };
  });

export const updatePlatformSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ default_commission_rate: z.number().min(0).max(100) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("platform_settings")
      .update({
        default_commission_rate: data.default_commission_rate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type SettlementEventLine = {
  event_id: string;
  title: string;
  event_date: string;
  orders: number;
  tickets: number;
  gross: number;
};

export type SettlementPreview = {
  organizer_id: string;
  organizer_name: string;
  period_from: string;
  period_to: string;
  commission_rate: number;
  tickets_sold: number;
  gross_amount: number;
  refunded_amount: number;
  commission_amount: number;
  net_amount: number;
  lines: SettlementEventLine[];
};

const PeriodInput = z.object({
  organizer_id: z.string().uuid(),
  event_id: z.string().uuid().optional().nullable(),
  period_from: z.string().min(8),
  period_to: z.string().min(8),
});

/**
 * Prepočet za obdobie. Do hrubej tržby ide, čo sa v období zaplatilo;
 * refundácie sa odpočítavajú podľa dátumu refundácie, nie objednávky — inak by
 * protokol za minulý mesiac menil sumu spätne pri každom vrátení peňazí.
 */
async function computePreview(input: z.infer<typeof PeriodInput>): Promise<SettlementPreview> {
  const from = `${input.period_from}T00:00:00.000Z`;
  const to = `${input.period_to}T23:59:59.999Z`;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("full_name, company_name, commission_rate")
    .eq("id", input.organizer_id)
    .maybeSingle();
  const rate =
    profile?.commission_rate === null || profile?.commission_rate === undefined
      ? await defaultCommissionRate()
      : Number(profile.commission_rate);

  let eventsQuery = supabaseAdmin
    .from("events")
    .select("id, title, event_date")
    .eq("organizer_id", input.organizer_id);
  if (input.event_id) eventsQuery = eventsQuery.eq("id", input.event_id);
  const { data: events } = await eventsQuery;
  const eventIds = (events || []).map((e) => e.id as string);

  const empty: SettlementPreview = {
    organizer_id: input.organizer_id,
    organizer_name: profile?.company_name || profile?.full_name || "Organizátor",
    period_from: input.period_from,
    period_to: input.period_to,
    commission_rate: rate,
    tickets_sold: 0,
    gross_amount: 0,
    refunded_amount: 0,
    commission_amount: 0,
    net_amount: 0,
    lines: [],
  };
  if (eventIds.length === 0) return empty;

  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id, event_id, total_amount, status, paid_at")
    .in("event_id", eventIds)
    .in("status", ["paid", "refunded"])
    .gte("paid_at", from)
    .lte("paid_at", to);

  const orderIds = (orders || []).map((o) => o.id as string);
  const ticketsByEvent = new Map<string, number>();
  if (orderIds.length > 0) {
    const { data: tickets } = await supabaseAdmin
      .from("tickets")
      .select("event_id, order_id")
      .in("order_id", orderIds);
    for (const t of tickets || []) {
      const id = t.event_id as string;
      ticketsByEvent.set(id, (ticketsByEvent.get(id) || 0) + 1);
    }
  }

  // Refundácie berieme z `payments` (záporné sumy), aby sedeli aj čiastočné —
  // pri tých objednávka zostáva v stave `paid`.
  let refunded = 0;
  {
    const { data: eventOrders } = await supabaseAdmin
      .from("orders")
      .select("id")
      .in("event_id", eventIds);
    const allIds = (eventOrders || []).map((o) => o.id as string);
    if (allIds.length > 0) {
      const { data: refunds } = await supabaseAdmin
        .from("payments")
        .select("amount, created_at, order_id, status")
        .in("order_id", allIds)
        .eq("status", "refunded")
        .gte("created_at", from)
        .lte("created_at", to);
      refunded = (refunds || []).reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    }
  }

  const byEvent = new Map<string, SettlementEventLine>();
  for (const e of events || []) {
    byEvent.set(e.id as string, {
      event_id: e.id as string,
      title: e.title as string,
      event_date: e.event_date as string,
      orders: 0,
      tickets: ticketsByEvent.get(e.id as string) || 0,
      gross: 0,
    });
  }
  let gross = 0;
  for (const o of orders || []) {
    const line = byEvent.get(o.event_id as string);
    if (!line) continue;
    line.orders += 1;
    line.gross = round2(line.gross + Number(o.total_amount || 0));
    gross += Number(o.total_amount || 0);
  }

  const lines = [...byEvent.values()].filter((l) => l.orders > 0 || l.tickets > 0);
  const base = round2(gross - refunded);
  const commission = round2((base * rate) / 100);
  return {
    ...empty,
    tickets_sold: lines.reduce((s, l) => s + l.tickets, 0),
    gross_amount: round2(gross),
    refunded_amount: round2(refunded),
    commission_amount: commission,
    net_amount: round2(base - commission),
    lines: lines.sort((a, b) => b.gross - a.gross),
  };
}

export const previewSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PeriodInput.parse(input))
  .handler(async ({ data, context }): Promise<SettlementPreview> => {
    await assertAdmin(context.userId);
    return computePreview(data);
  });

export const createSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    PeriodInput.extend({ note: z.string().max(2000).optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.userId);
    const p = await computePreview(data);
    const { data: created, error } = await supabaseAdmin
      .from("settlements")
      .insert({
        organizer_id: data.organizer_id,
        event_id: data.event_id ?? null,
        period_from: data.period_from,
        period_to: data.period_to,
        tickets_sold: p.tickets_sold,
        gross_amount: p.gross_amount,
        commission_rate: p.commission_rate,
        commission_amount: p.commission_amount,
        refunded_amount: p.refunded_amount,
        net_amount: p.net_amount,
        note: data.note || null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "Protokol sa nepodarilo vytvoriť");
    return { id: created.id };
  });

export type SettlementRow = {
  id: string;
  organizer_id: string;
  organizer_name: string;
  event_title: string | null;
  period_from: string;
  period_to: string;
  tickets_sold: number;
  gross_amount: number;
  refunded_amount: number;
  commission_rate: number;
  commission_amount: number;
  net_amount: number;
  status: "draft" | "approved" | "paid";
  paid_at: string | null;
  payout_reference: string | null;
  note: string | null;
  created_at: string;
};

export const listSettlements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        organizer_id: z.string().uuid().optional().nullable(),
        status: z.enum(["draft", "approved", "paid", "all"]).default("all"),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<SettlementRow[]> => {
    await assertAdmin(context.userId);
    let q = supabaseAdmin
      .from("settlements")
      .select("*, events ( title )")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.organizer_id) q = q.eq("organizer_id", data.organizer_id);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const ids = [...new Set((rows || []).map((r: any) => r.organizer_id as string))];
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, company_name")
        .in("id", ids);
      for (const p of profiles || []) {
        names.set(p.id, p.company_name || p.full_name || p.id);
      }
    }

    return (rows || []).map((r: any) => ({
      id: r.id,
      organizer_id: r.organizer_id,
      organizer_name: names.get(r.organizer_id) || "—",
      event_title: r.events?.title ?? null,
      period_from: r.period_from,
      period_to: r.period_to,
      tickets_sold: r.tickets_sold,
      gross_amount: Number(r.gross_amount),
      refunded_amount: Number(r.refunded_amount),
      commission_rate: Number(r.commission_rate),
      commission_amount: Number(r.commission_amount),
      net_amount: Number(r.net_amount),
      status: r.status,
      paid_at: r.paid_at,
      payout_reference: r.payout_reference,
      note: r.note,
      created_at: r.created_at,
    }));
  });

/** Posun stavu protokolu. `paid` si zapamätá dátum aj referenciu platby. */
export const setSettlementStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["draft", "approved", "paid"]),
        payout_reference: z.string().max(200).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("settlements")
      .update({
        status: data.status,
        paid_at: data.status === "paid" ? new Date().toISOString() : null,
        payout_reference: data.status === "paid" ? (data.payout_reference ?? null) : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    // Vyplatený protokol je doklad — ten sa nemaže.
    const { data: row } = await supabaseAdmin
      .from("settlements")
      .select("status")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.status === "paid") throw new Error("Vyplatený protokol sa nedá zmazať.");
    const { error } = await supabaseAdmin.from("settlements").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
