// Skupiny podujatí — série, festivalové ročníky, predplatné cykly.
//
// Väzba je 1:N cez `events.group_id`. Na rozdiel od kategórie tu podujatie
// nedrží žiadny text: skupina je voliteľná a keď zanikne, podujatie ostane bez
// nej. Preto sa premenovanie nikam neprepisuje.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EventGroupEventRef = {
  id: string;
  title: string;
  event_date: string;
  city: string;
};

export type EventGroupRecord = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  active: boolean;
  events_count: number;
  events: EventGroupEventRef[];
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

/** Názov na slug bez diakritiky — rovnaký postup ako pri kategóriách. */
function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Zoznam skupín. Verejný — filtruje sa podľa nich katalóg. */
export const listEventGroups = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ only_active: z.boolean().default(false) }).parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<EventGroupRecord[]> => {
    let q = supabaseAdmin
      .from("event_groups")
      .select("id, name, slug, description, image_url, sort_order, active")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (data.only_active) q = q.eq("active", true);

    const [{ data: rows, error }, { data: events }] = await Promise.all([
      q,
      supabaseAdmin
        .from("events")
        .select("id, title, event_date, city, group_id")
        .not("group_id", "is", null)
        .order("event_date", { ascending: true }),
    ]);
    if (error) throw new Error(error.message);

    const byGroup = new Map<string, EventGroupEventRef[]>();
    for (const e of events || []) {
      const key = e.group_id as string;
      const list = byGroup.get(key) ?? [];
      list.push({ id: e.id, title: e.title, event_date: e.event_date, city: e.city });
      byGroup.set(key, list);
    }

    return (rows || []).map((g) => {
      const list = byGroup.get(g.id) ?? [];
      return {
        id: g.id,
        name: g.name,
        slug: g.slug,
        description: g.description,
        image_url: g.image_url,
        sort_order: g.sort_order,
        active: g.active,
        events_count: list.length,
        events: list,
      };
    });
  });

const GroupInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  image_url: z.string().max(1000).optional().nullable(),
  sort_order: z.number().int().min(0).max(9999).default(100),
  active: z.boolean().default(true),
  /** Ak je pole zadané, prepíše celé zloženie skupiny. */
  event_ids: z.array(z.string().uuid()).optional(),
});

export type EventGroupInput = z.input<typeof GroupInput>;

export const upsertEventGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => GroupInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.userId);
    const name = data.name.trim();
    const row = {
      name,
      slug: slugify(name),
      description: data.description?.trim() || null,
      image_url: data.image_url?.trim() || null,
      sort_order: data.sort_order,
      active: data.active,
      updated_at: new Date().toISOString(),
    };

    let id = data.id;
    if (id) {
      const { error } = await supabaseAdmin.from("event_groups").update(row).eq("id", id);
      if (error) throw new Error(friendly(error.message));
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("event_groups")
        .insert(row)
        .select("id")
        .single();
      if (error || !created) throw new Error(friendly(error?.message || "Uloženie zlyhalo"));
      id = created.id;
    }

    if (data.event_ids) {
      // Podujatie patrí najviac do jednej skupiny, takže priradenie znamená
      // odobrať tie, ktoré v zozname nie sú, a pripísať tie nové.
      await supabaseAdmin.from("events").update({ group_id: null }).eq("group_id", id);
      if (data.event_ids.length > 0) {
        const { error } = await supabaseAdmin
          .from("events")
          .update({ group_id: id })
          .in("id", data.event_ids);
        if (error) throw new Error(error.message);
      }
    }
    return { id };
  });

function friendly(message: string): string {
  if (message.includes("event_groups_name_key") || message.includes("event_groups_slug_key")) {
    return "Skupina s týmto názvom už existuje.";
  }
  return message;
}

/**
 * Skupinu s podujatiami nemažeme — skryjeme ju. Zmazanie by podujatia nechalo
 * bez väzby (`on delete set null`), ale späť by sa už nedala poskladať.
 */
export const deleteEventGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { count } = await supabaseAdmin
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("group_id", data.id);

    if ((count ?? 0) > 0) {
      const { error } = await supabaseAdmin
        .from("event_groups")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, deactivated: true, events_count: count ?? 0 };
    }

    const { error } = await supabaseAdmin.from("event_groups").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, deactivated: false, events_count: 0 };
  });
