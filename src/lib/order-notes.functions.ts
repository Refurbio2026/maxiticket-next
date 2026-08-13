// Interné poznámky k objednávkam.
//
// Poznámka je záznam o tom, čo sa okolo objednávky dialo — telefonát,
// dohodnutá výmena termínu, sľúbený refund. Zákazník ju nikdy nevidí.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OrderNote = {
  id: string;
  order_id: string;
  body: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  author_name: string | null;
  /** Kontext objednávky — zoznam poznámok sa pozerá aj naprieč objednávkami. */
  order_short: string;
  customer_name: string | null;
  customer_email: string | null;
  order_status: string | null;
  order_total: number | null;
  currency: string;
  event_title: string | null;
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

export const listOrderNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        /** Bez neho sa vrátia poznámky naprieč všetkými objednávkami. */
        order_id: z.string().uuid().optional().nullable(),
        search: z.string().max(200).optional().nullable(),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<OrderNote[]> => {
    await assertAdmin(context.userId);

    let q = supabaseAdmin
      .from("order_notes")
      .select("id, order_id, body, pinned, created_at, updated_at, author_id")
      // Pripnuté hore, inak od najnovšej.
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.order_id) q = q.eq("order_id", data.order_id);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const notes = rows || [];
    if (notes.length === 0) return [];

    const orderIds = [...new Set(notes.map((n) => n.order_id))];
    const authorIds = [...new Set(notes.map((n) => n.author_id).filter(Boolean))] as string[];

    const [{ data: orders }, { data: profiles }] = await Promise.all([
      supabaseAdmin
        .from("orders")
        .select("id, customer_name, customer_email, status, total_amount, currency, event_id")
        .in("id", orderIds),
      authorIds.length
        ? supabaseAdmin.from("profiles").select("id, full_name").in("id", authorIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    ]);

    const eventIds = [...new Set((orders || []).map((o) => o.event_id).filter(Boolean))];
    const { data: events } = eventIds.length
      ? await supabaseAdmin.from("events").select("id, title").in("id", eventIds)
      : { data: [] as { id: string; title: string }[] };

    const eventTitles = new Map((events || []).map((e) => [e.id, e.title]));
    const orderMap = new Map((orders || []).map((o) => [o.id, o]));
    const names = new Map((profiles || []).map((p) => [p.id, p.full_name]));

    let list: OrderNote[] = notes.map((n) => {
      const o = orderMap.get(n.order_id);
      return {
        id: n.id,
        order_id: n.order_id,
        body: n.body,
        pinned: n.pinned,
        created_at: n.created_at,
        updated_at: n.updated_at,
        author_name: n.author_id ? (names.get(n.author_id) ?? null) : null,
        order_short: n.order_id.slice(0, 8).toUpperCase(),
        customer_name: o?.customer_name ?? null,
        customer_email: o?.customer_email ?? null,
        order_status: o?.status ?? null,
        order_total: o ? Number(o.total_amount || 0) : null,
        currency: o?.currency || "EUR",
        event_title: o ? (eventTitles.get(o.event_id) ?? null) : null,
      };
    });

    // Hľadanie až nad výsledkom — mieša text poznámky s údajmi objednávky,
    // ktoré sú v inej tabuľke.
    if (data.search) {
      const s = data.search.trim().toLowerCase();
      list = list.filter((n) =>
        [n.body, n.customer_name, n.customer_email, n.event_title, n.author_name, n.order_short]
          .join(" ")
          .toLowerCase()
          .includes(s),
      );
    }

    return list;
  });

/** Počty poznámok pre zoznam objednávok — aby bolo vidieť, kde nejaká je. */
export const countOrderNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ order_ids: z.array(z.string().uuid()) }).parse(input))
  .handler(async ({ data, context }): Promise<Record<string, number>> => {
    await assertAdmin(context.userId);
    if (data.order_ids.length === 0) return {};
    const { data: rows, error } = await supabaseAdmin
      .from("order_notes")
      .select("order_id")
      .in("order_id", data.order_ids);
    if (error) throw new Error(error.message);
    const out: Record<string, number> = {};
    for (const r of rows || []) out[r.order_id] = (out[r.order_id] || 0) + 1;
    return out;
  });

export const upsertOrderNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        order_id: z.string().uuid(),
        body: z.string().min(1).max(4000),
        pinned: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.userId);

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("id", data.order_id)
      .maybeSingle();
    if (!order) throw new Error("Objednávka sa nenašla");

    if (data.id) {
      // Autora pri úprave nemeníme — poznámku napísal ten, kto ju napísal.
      const { error } = await supabaseAdmin
        .from("order_notes")
        .update({ body: data.body.trim(), pinned: data.pinned })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    const { data: created, error } = await supabaseAdmin
      .from("order_notes")
      .insert({
        order_id: data.order_id,
        body: data.body.trim(),
        pinned: data.pinned,
        author_id: context.userId,
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "Uloženie zlyhalo");
    return { id: created.id };
  });

export const deleteOrderNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("order_notes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
