// Náklady organizátorov — položky, ktoré sa mu sťahujú z výplaty.
//
// Kým náklad nemá `settlement_id`, je nevyúčtovaný a vyúčtovanie ho ponúkne na
// odpočet. Pri vytvorení protokolu sa naň prepíše, takže sa neodpočíta dvakrát.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OrganizerCost = {
  id: string;
  organizer_id: string;
  organizer_name: string;
  event_id: string | null;
  event_title: string | null;
  settlement_id: string | null;
  /** Zahrnutý do protokolu = už sa nedá meniť ani znovu odpočítať. */
  settled: boolean;
  title: string;
  amount: number;
  cost_date: string;
  note: string | null;
  created_at: string;
};

export type OrganizerCostsResult = {
  rows: OrganizerCost[];
  /** Nevyúčtované náklady — presne tie, o ktoré sa zníži najbližšia výplata. */
  open_amount: number;
  settled_amount: number;
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

export const listOrganizerCosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        organizer_id: z.string().uuid().optional().nullable(),
        /** `open` = ešte nezahrnuté do protokolu. */
        state: z.enum(["all", "open", "settled"]).default("all"),
        limit: z.number().int().min(1).max(500).default(300),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<OrganizerCostsResult> => {
    await assertAdmin(context.userId);

    let q = supabaseAdmin
      .from("organizer_costs")
      .select(
        "id, organizer_id, event_id, settlement_id, title, amount, cost_date, note, created_at",
      )
      .order("cost_date", { ascending: false })
      .limit(data.limit);
    if (data.organizer_id) q = q.eq("organizer_id", data.organizer_id);
    if (data.state === "open") q = q.is("settlement_id", null);
    if (data.state === "settled") q = q.not("settlement_id", "is", null);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const costs = rows || [];
    const organizerIds = [...new Set(costs.map((c) => c.organizer_id))];
    const eventIds = [...new Set(costs.map((c) => c.event_id).filter(Boolean))] as string[];

    const [{ data: profiles }, { data: events }] = await Promise.all([
      organizerIds.length
        ? supabaseAdmin
            .from("profiles")
            .select("id, full_name, company_name")
            .in("id", organizerIds)
        : Promise.resolve({
            data: [] as { id: string; full_name: string | null; company_name: string | null }[],
          }),
      eventIds.length
        ? supabaseAdmin.from("events").select("id, title").in("id", eventIds)
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    ]);

    const names = new Map(
      (profiles || []).map((p) => [p.id, p.company_name || p.full_name || "—"]),
    );
    const titles = new Map((events || []).map((e) => [e.id, e.title]));

    const list: OrganizerCost[] = costs.map((c) => ({
      id: c.id,
      organizer_id: c.organizer_id,
      organizer_name: names.get(c.organizer_id) || "—",
      event_id: c.event_id,
      event_title: c.event_id ? (titles.get(c.event_id) ?? null) : null,
      settlement_id: c.settlement_id,
      settled: !!c.settlement_id,
      title: c.title,
      amount: Number(c.amount || 0),
      cost_date: c.cost_date,
      note: c.note,
      created_at: c.created_at,
    }));

    return {
      rows: list,
      open_amount: round2(list.filter((c) => !c.settled).reduce((s, c) => s + c.amount, 0)),
      settled_amount: round2(list.filter((c) => c.settled).reduce((s, c) => s + c.amount, 0)),
    };
  });

const CostInput = z.object({
  id: z.string().uuid().optional(),
  organizer_id: z.string().uuid(),
  event_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(200),
  amount: z.number().positive().max(1_000_000),
  cost_date: z.string().min(8),
  note: z.string().max(2000).optional().nullable(),
});

export type OrganizerCostInput = z.input<typeof CostInput>;

export const upsertOrganizerCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CostInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.userId);
    const row = {
      organizer_id: data.organizer_id,
      event_id: data.event_id || null,
      title: data.title.trim(),
      amount: data.amount,
      cost_date: data.cost_date,
      note: data.note?.trim() || null,
    };

    if (data.id) {
      // Náklad zahrnutý v protokole je súčasť odsúhlaseného vyúčtovania —
      // zmena sumy by rozbila čísla, ktoré organizátor už videl.
      const { data: existing } = await supabaseAdmin
        .from("organizer_costs")
        .select("settlement_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!existing) throw new Error("Náklad sa nenašiel");
      if (existing.settlement_id) {
        throw new Error("Náklad je už zahrnutý vo vyúčtovacom protokole a nedá sa meniť.");
      }
      const { error } = await supabaseAdmin.from("organizer_costs").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: created, error } = await supabaseAdmin
      .from("organizer_costs")
      .insert({ ...row, created_by: context.userId })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "Uloženie zlyhalo");
    return { id: created.id };
  });

export const deleteOrganizerCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: existing } = await supabaseAdmin
      .from("organizer_costs")
      .select("settlement_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!existing) throw new Error("Náklad sa nenašiel");
    if (existing.settlement_id) {
      throw new Error("Náklad je zahrnutý vo vyúčtovacom protokole. Najprv zmaž protokol.");
    }
    const { error } = await supabaseAdmin.from("organizer_costs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
