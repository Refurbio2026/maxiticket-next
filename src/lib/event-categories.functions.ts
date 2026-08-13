// Číselník kategórií podujatí.
//
// `events.category` je naďalej text (číta ho verejný katalóg aj filtre), tento
// číselník je zdroj pravdy pre ponuku vo formulári podujatia. Premenovanie sa
// preto prepíše aj do podujatí — inak by kategória zmizla z filtra.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EventCategoryRecord = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  sort_order: number;
  active: boolean;
  /** Koľko podujatí túto kategóriu práve používa. */
  events_count: number;
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

/** Prevedie názov na slug bez diakritiky — rovnako ako to robí migrácia. */
function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const listEventCategories = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ only_active: z.boolean().default(false) }).parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<EventCategoryRecord[]> => {
    let q = supabaseAdmin
      .from("event_categories")
      .select("id, name, slug, description, sort_order, active")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (data.only_active) q = q.eq("active", true);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Počty podujatí — kategória sa v podujatí drží ako text, takže sa páruje
    // podľa názvu.
    const { data: events } = await supabaseAdmin.from("events").select("category");
    const counts = new Map<string, number>();
    for (const e of events || []) {
      const key = (e.category || "").toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return (rows || []).map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description ?? undefined,
      sort_order: r.sort_order,
      active: r.active,
      events_count: counts.get(r.name.toLowerCase()) || 0,
    }));
  });

const CategoryInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  sort_order: z.number().int().min(0).max(9999).default(100),
  active: z.boolean().default(true),
});

export type EventCategoryInput = z.input<typeof CategoryInput>;

export const upsertEventCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CategoryInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.userId);
    const name = data.name.trim();
    const row = {
      name,
      slug: slugify(name),
      description: data.description?.trim() || null,
      sort_order: data.sort_order,
      active: data.active,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("event_categories")
        .select("id, name")
        .eq("id", data.id)
        .maybeSingle();
      if (!existing) throw new Error("Kategória sa nenašla");

      const { error } = await supabaseAdmin.from("event_categories").update(row).eq("id", data.id);
      if (error) throw new Error(friendly(error.message));

      // Premenovanie prepíšeme do podujatí, inak by ich filter v katalógu
      // zaradil pod názov, ktorý už neexistuje.
      if (existing.name !== name) {
        await supabaseAdmin.from("events").update({ category: name }).eq("category", existing.name);
      }
      return { id: data.id };
    }

    const { data: created, error } = await supabaseAdmin
      .from("event_categories")
      .insert(row)
      .select("id")
      .single();
    if (error || !created) throw new Error(friendly(error?.message || "Uloženie zlyhalo"));
    return { id: created.id };
  });

function friendly(message: string): string {
  if (
    message.includes("event_categories_name_key") ||
    message.includes("event_categories_slug_key")
  ) {
    return "Kategória s týmto názvom už existuje.";
  }
  return message;
}

/**
 * Kategóriu, ktorú niektoré podujatie používa, nemažeme — deaktivujeme ju.
 * Zmazanie by z podujatia nespravilo nič zlé (kategória je text), ale zmizla by
 * z ponuky aj z filtra a nedala by sa vrátiť späť.
 */
export const deleteEventCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: cat } = await supabaseAdmin
      .from("event_categories")
      .select("id, name")
      .eq("id", data.id)
      .maybeSingle();
    if (!cat) throw new Error("Kategória sa nenašla");

    const { count } = await supabaseAdmin
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("category", cat.name);
    if ((count ?? 0) > 0) {
      await supabaseAdmin
        .from("event_categories")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", data.id);
      return { ok: true, deactivated: true, events_count: count ?? 0 };
    }

    const { error } = await supabaseAdmin.from("event_categories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, deactivated: false, events_count: 0 };
  });
