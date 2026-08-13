// Účinkujúci a ich zostavy na podujatiach.
//
// Väzba `event_performers` je M:N — na festivale hrá viac umelcov a jeden umelec
// vystupuje na viacerých podujatiach. Verejná stránka `/artists` číta ten istý
// zoznam ako admin, takže sa nemôžu rozísť.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PerformerEventRef = {
  id: string;
  title: string;
  event_date: string;
  city: string;
  status: "draft" | "published";
  /** Má ešte aspoň jeden termín v budúcnosti. */
  upcoming: boolean;
};

export type PerformerRecord = {
  id: string;
  name: string;
  slug: string;
  genre: string | null;
  city: string | null;
  bio: string | null;
  image_url: string | null;
  website: string | null;
  active: boolean;
  /** Všetky priradené podujatia — vrátane konceptov a odohraných. */
  events_count: number;
  /** Publikované podujatia s termínom v budúcnosti. */
  upcoming_count: number;
  events: PerformerEventRef[];
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

/**
 * Zoznam účinkujúcich aj s ich podujatiami.
 *
 * Verejný — zostava je súčasť ponuky. `only_active` používa verejná stránka,
 * admin chce vidieť aj skrytých.
 */
export const listPerformers = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ only_active: z.boolean().default(false) }).parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<PerformerRecord[]> => {
    let q = supabaseAdmin
      .from("performers")
      .select("id, name, slug, genre, city, bio, image_url, website, active")
      .order("name", { ascending: true });
    if (data.only_active) q = q.eq("active", true);

    const [{ data: rows, error }, { data: links }] = await Promise.all([
      q,
      supabaseAdmin.from("event_performers").select("event_id, performer_id, sort_order"),
    ]);
    if (error) throw new Error(error.message);

    const eventIds = [...new Set((links || []).map((l) => l.event_id))];
    const events = await loadEventRefs(eventIds);

    const byPerformer = new Map<string, PerformerEventRef[]>();
    for (const l of links || []) {
      const ev = events.get(l.event_id);
      if (!ev) continue;
      const list = byPerformer.get(l.performer_id) ?? [];
      list.push(ev);
      byPerformer.set(l.performer_id, list);
    }

    return (rows || []).map((p) => {
      const list = (byPerformer.get(p.id) ?? []).sort((a, b) =>
        a.event_date.localeCompare(b.event_date),
      );
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        genre: p.genre,
        city: p.city,
        bio: p.bio,
        image_url: p.image_url,
        website: p.website,
        active: p.active,
        events_count: list.length,
        upcoming_count: list.filter((e) => e.upcoming).length,
        events: list,
      };
    });
  });

export type EventPerformer = {
  id: string;
  name: string;
  slug: string;
  genre: string | null;
  image_url: string | null;
};

/** Zostava jedného podujatia pre verejný detail. Skrytých neukazujeme. */
export const listEventPerformers = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ event_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<EventPerformer[]> => {
    const { data: links, error } = await supabaseAdmin
      .from("event_performers")
      .select("performer_id, sort_order")
      .eq("event_id", data.event_id)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    if (!links || links.length === 0) return [];

    const { data: rows } = await supabaseAdmin
      .from("performers")
      .select("id, name, slug, genre, image_url")
      .in(
        "id",
        links.map((l) => l.performer_id),
      )
      .eq("active", true);

    const order = new Map(links.map((l, i) => [l.performer_id, i]));
    return (rows || [])
      .map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        genre: p.genre,
        image_url: p.image_url,
      }))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  });

/**
 * Podujatia pre výpis zostavy.
 *
 * `events.event_date` je len odtlačok najbližšieho termínu (drží ho trigger),
 * a keď sú všetky termíny minulé, ukazuje na posledný odohraný. Preto sa
 * „nadchádzajúce" počíta z termínov, nie z tohto stĺpca.
 */
async function loadEventRefs(eventIds: string[]): Promise<Map<string, PerformerEventRef>> {
  const out = new Map<string, PerformerEventRef>();
  if (eventIds.length === 0) return out;

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: events }, { data: dates }] = await Promise.all([
    supabaseAdmin.from("events").select("id, title, event_date, city, status").in("id", eventIds),
    supabaseAdmin
      .from("event_dates")
      .select("event_id, event_date")
      .in("event_id", eventIds)
      .eq("status", "on_sale")
      .gte("event_date", today),
  ]);

  const hasUpcoming = new Set((dates || []).map((d) => d.event_id));
  for (const e of events || []) {
    out.set(e.id, {
      id: e.id,
      title: e.title,
      event_date: e.event_date,
      city: e.city,
      status: e.status as "draft" | "published",
      upcoming: e.status === "published" && hasUpcoming.has(e.id),
    });
  }
  return out;
}

const PerformerInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  genre: z.string().max(80).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  bio: z.string().max(4000).optional().nullable(),
  image_url: z.string().max(1000).optional().nullable(),
  website: z.string().max(500).optional().nullable(),
  active: z.boolean().default(true),
  /** Ak je pole zadané, prepíše celú zostavu tohto účinkujúceho. */
  event_ids: z.array(z.string().uuid()).optional(),
});

export type PerformerInputData = z.input<typeof PerformerInput>;

export const upsertPerformer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PerformerInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.userId);
    const name = data.name.trim();
    const row = {
      name,
      slug: slugify(name),
      genre: data.genre?.trim() || null,
      city: data.city?.trim() || null,
      bio: data.bio?.trim() || null,
      image_url: data.image_url?.trim() || null,
      website: data.website?.trim() || null,
      active: data.active,
      updated_at: new Date().toISOString(),
    };

    let id = data.id;
    if (id) {
      const { error } = await supabaseAdmin.from("performers").update(row).eq("id", id);
      if (error) throw new Error(friendly(error.message));
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("performers")
        .insert(row)
        .select("id")
        .single();
      if (error || !created) throw new Error(friendly(error?.message || "Uloženie zlyhalo"));
      id = created.id;
    }

    if (data.event_ids) await replaceEvents(id, data.event_ids);
    return { id };
  });

/** Prepíše zostavu: doplní chýbajúce väzby a odoberie tie, čo v zozname nie sú. */
async function replaceEvents(performerId: string, eventIds: string[]) {
  const wanted = [...new Set(eventIds)];
  const { data: current } = await supabaseAdmin
    .from("event_performers")
    .select("event_id")
    .eq("performer_id", performerId);

  const have = new Set((current || []).map((r) => r.event_id));
  const toAdd = wanted.filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !wanted.includes(id));

  if (toAdd.length > 0) {
    const { error } = await supabaseAdmin
      .from("event_performers")
      .insert(toAdd.map((event_id) => ({ event_id, performer_id: performerId })));
    if (error) throw new Error(error.message);
  }
  if (toRemove.length > 0) {
    const { error } = await supabaseAdmin
      .from("event_performers")
      .delete()
      .eq("performer_id", performerId)
      .in("event_id", toRemove);
    if (error) throw new Error(error.message);
  }
}

function friendly(message: string): string {
  if (message.includes("performers_name_key") || message.includes("performers_slug_key")) {
    return "Účinkujúci s týmto menom už existuje.";
  }
  return message;
}

/**
 * Účinkujúceho priradeného k podujatiu nemažeme — skryjeme ho.
 * Zmazanie by `on delete cascade` odstránilo aj zo zostavy podujatia, ktoré sa
 * možno už predalo s jeho menom na plagáte.
 */
export const deletePerformer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { count } = await supabaseAdmin
      .from("event_performers")
      .select("event_id", { count: "exact", head: true })
      .eq("performer_id", data.id);

    if ((count ?? 0) > 0) {
      const { error } = await supabaseAdmin
        .from("performers")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, deactivated: true, events_count: count ?? 0 };
    }

    const { error } = await supabaseAdmin.from("performers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, deactivated: false, events_count: 0 };
  });
