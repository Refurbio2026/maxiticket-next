// Výplaty organizátorom a ich bilancie.
//
// Nič tu nie je nová evidencia — je to pohľad na to, čo už v databáze je:
// vyúčtovacie protokoly (`settlements`), náklady (`organizer_costs`) a
// zaplatené objednávky. Výplata = protokol, ktorý čaká na prevod alebo je
// prevedený; bilancia = koľko organizátorovi ešte dlhujeme.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OrganizerPayout = {
  settlement_id: string;
  organizer_id: string;
  organizer_name: string;
  payout_iban: string | null;
  period_from: string;
  period_to: string;
  amount: number;
  status: "draft" | "approved" | "paid";
  paid_at: string | null;
  payout_reference: string | null;
  note: string | null;
};

export type PayoutsResult = {
  rows: OrganizerPayout[];
  /** Schválené, ale ešte neprevedené — to sú peniaze, ktoré máme poslať. */
  due_amount: number;
  due_count: number;
  paid_amount: number;
  /** Schválená výplata bez IBAN-u sa nedá odoslať — treba to vidieť dopredu. */
  missing_iban: number;
};

export type OrganizerBalance = {
  organizer_id: string;
  organizer_name: string;
  payout_iban: string | null;
  commission_rate: number;
  /** Zaplatené objednávky za všetky podujatia organizátora. */
  gross_all_time: number;
  /** Tržba, ktorá už prešla do protokolu. */
  settled_gross: number;
  /** Tržba, na ktorú protokol ešte nikto nevystavil. */
  unsettled_gross: number;
  /** Nevyúčtované náklady — znížia najbližšiu výplatu. */
  open_costs: number;
  /** Protokoly čakajúce na prevod. */
  due_amount: number;
  paid_amount: number;
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

/** Meno + výplatné údaje organizátorov. */
async function loadOrganizers(ids: string[]) {
  if (ids.length === 0) {
    return new Map<
      string,
      { name: string; payout_iban: string | null; commission_rate: number | null }
    >();
  }
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, company_name, payout_iban, commission_rate")
    .in("id", ids);
  return new Map(
    (data || []).map((p) => [
      p.id,
      {
        name: p.company_name || p.full_name || "—",
        payout_iban: p.payout_iban,
        commission_rate: p.commission_rate === null ? null : Number(p.commission_rate),
      },
    ]),
  );
}

export const listOrganizerPayouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        /** `due` = schválené a čakajúce na prevod. */
        state: z.enum(["all", "due", "paid"]).default("all"),
        organizer_id: z.string().uuid().optional().nullable(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<PayoutsResult> => {
    await assertAdmin(context.userId);

    // Návrh protokolu ešte nie je výplata — dostane sa sem až po schválení.
    let q = supabaseAdmin
      .from("settlements")
      .select(
        "id, organizer_id, period_from, period_to, net_amount, status, paid_at, payout_reference, note",
      )
      .in("status", ["approved", "paid"])
      .order("paid_at", { ascending: false, nullsFirst: true })
      .order("period_to", { ascending: false })
      .limit(300);
    if (data.state === "due") q = q.eq("status", "approved");
    if (data.state === "paid") q = q.eq("status", "paid");
    if (data.organizer_id) q = q.eq("organizer_id", data.organizer_id);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const list = rows || [];
    const organizers = await loadOrganizers([...new Set(list.map((r) => r.organizer_id))]);

    const payouts: OrganizerPayout[] = list.map((r) => {
      const o = organizers.get(r.organizer_id);
      return {
        settlement_id: r.id,
        organizer_id: r.organizer_id,
        organizer_name: o?.name || "—",
        payout_iban: o?.payout_iban ?? null,
        period_from: r.period_from,
        period_to: r.period_to,
        amount: Number(r.net_amount || 0),
        status: r.status,
        paid_at: r.paid_at,
        payout_reference: r.payout_reference,
        note: r.note,
      };
    });

    const due = payouts.filter((p) => p.status === "approved");
    return {
      rows: payouts,
      due_amount: round2(due.reduce((s, p) => s + p.amount, 0)),
      due_count: due.length,
      paid_amount: round2(
        payouts.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0),
      ),
      missing_iban: due.filter((p) => !p.payout_iban).length,
    };
  });

export const listOrganizerBalances = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OrganizerBalance[]> => {
    await assertAdmin(context.userId);

    const { data: defaults } = await supabaseAdmin
      .from("platform_settings")
      .select("default_commission_rate")
      .eq("id", true)
      .maybeSingle();
    const fallbackRate = Number(defaults?.default_commission_rate ?? 10);

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "organizer");
    const { data: events } = await supabaseAdmin.from("events").select("id, organizer_id");

    // Organizátorom je aj ten, kto rolu nemá, ale má podujatie — inak by jeho
    // peniaze v bilancii chýbali.
    const organizerIds = [
      ...new Set([
        ...(roles || []).map((r) => r.user_id),
        ...(events || []).map((e) => e.organizer_id),
      ]),
    ].filter(Boolean) as string[];
    if (organizerIds.length === 0) return [];

    const eventOwner = new Map((events || []).map((e) => [e.id, e.organizer_id]));

    const [{ data: orders }, { data: settlements }, { data: costs }] = await Promise.all([
      supabaseAdmin
        .from("orders")
        .select("event_id, total_amount, refunded_amount")
        .not("paid_at", "is", null),
      supabaseAdmin.from("settlements").select("organizer_id, gross_amount, net_amount, status"),
      supabaseAdmin
        .from("organizer_costs")
        .select("organizer_id, amount")
        .is("settlement_id", null),
    ]);

    const gross = new Map<string, number>();
    for (const o of orders || []) {
      const owner = eventOwner.get(o.event_id);
      if (!owner) continue;
      // Vrátené peniaze do tržby organizátora nepatria.
      const net = Number(o.total_amount || 0) - Number(o.refunded_amount || 0);
      gross.set(owner, (gross.get(owner) || 0) + net);
    }

    const settledGross = new Map<string, number>();
    const due = new Map<string, number>();
    const paid = new Map<string, number>();
    for (const s of settlements || []) {
      settledGross.set(
        s.organizer_id,
        (settledGross.get(s.organizer_id) || 0) + Number(s.gross_amount || 0),
      );
      if (s.status === "approved") {
        due.set(s.organizer_id, (due.get(s.organizer_id) || 0) + Number(s.net_amount || 0));
      }
      if (s.status === "paid") {
        paid.set(s.organizer_id, (paid.get(s.organizer_id) || 0) + Number(s.net_amount || 0));
      }
    }

    const openCosts = new Map<string, number>();
    for (const c of costs || []) {
      openCosts.set(c.organizer_id, (openCosts.get(c.organizer_id) || 0) + Number(c.amount || 0));
    }

    const organizers = await loadOrganizers(organizerIds);

    return organizerIds
      .map((id) => {
        const o = organizers.get(id);
        const g = round2(gross.get(id) || 0);
        const sg = round2(settledGross.get(id) || 0);
        return {
          organizer_id: id,
          organizer_name: o?.name || "—",
          payout_iban: o?.payout_iban ?? null,
          commission_rate: o?.commission_rate ?? fallbackRate,
          gross_all_time: g,
          settled_gross: sg,
          // Môže vyjsť aj záporné, ak protokol pokrýval obdobie so
          // stornami — vtedy je to signál, že sa treba pozrieť na protokoly.
          unsettled_gross: round2(g - sg),
          open_costs: round2(openCosts.get(id) || 0),
          due_amount: round2(due.get(id) || 0),
          paid_amount: round2(paid.get(id) || 0),
        };
      })
      .sort((a, b) => b.due_amount - a.due_amount || b.gross_all_time - a.gross_all_time);
  });

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
