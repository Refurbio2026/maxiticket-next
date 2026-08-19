// Cenové zóny sály a ich ceny na podujatie.
//
// Zóna je číselník platformy (`price_categories`) — editor hál z neho ponúka
// hodnoty pre tvary. Cena zóny je vlastnosť podujatia (`event_price_categories`),
// lebo tá istá sála sa dá predávať za rôzne ceny.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PriceCategoryRecord = {
  id: string;
  name: string;
  slug: string;
  color?: string;
  description?: string;
  sort_order: number;
  active: boolean;
};

export type EventZonePrice = {
  price_category_id: string;
  name: string;
  color?: string;
  price: number;
};

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

async function assertAdmin(userId: string) {
  if (!(await isAdmin(userId))) throw new Error("Forbidden: vyžaduje sa rola admin");
}

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Číselník zón. Verejný — editor aj zákaznícka mapa podľa neho farbia sedadlá. */
export const listPriceCategories = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ only_active: z.boolean().default(false) }).parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<PriceCategoryRecord[]> => {
    let q = supabaseAdmin
      .from("price_categories")
      .select("id, name, slug, color, description, sort_order, active")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (data.only_active) q = q.eq("active", true);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows || []).map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      color: r.color ?? undefined,
      description: r.description ?? undefined,
      sort_order: r.sort_order,
      active: r.active,
    }));
  });

const CategoryInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Farba musí byť v tvare #rrggbb")
    .optional()
    .nullable(),
  description: z.string().max(2000).optional().nullable(),
  sort_order: z.number().int().min(0).max(9999).default(100),
  active: z.boolean().default(true),
});

export type PriceCategoryInput = z.input<typeof CategoryInput>;

export const upsertPriceCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CategoryInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.userId);
    const name = data.name.trim();
    const row = {
      name,
      slug: slugify(name),
      color: data.color || null,
      description: data.description?.trim() || null,
      sort_order: data.sort_order,
      active: data.active,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await supabaseAdmin.from("price_categories").update(row).eq("id", data.id);
      if (error) throw new Error(friendly(error.message));
      return { id: data.id };
    }
    const { data: created, error } = await supabaseAdmin
      .from("price_categories")
      .insert(row)
      .select("id")
      .single();
    if (error || !created) throw new Error(friendly(error?.message || "Uloženie zlyhalo"));
    return { id: created.id };
  });

function friendly(message: string): string {
  if (
    message.includes("price_categories_name_key") ||
    message.includes("price_categories_slug_key")
  ) {
    return "Zóna s týmto názvom už existuje.";
  }
  return message;
}

/**
 * Zónu použitú v niektorom podujatí nemažeme — deaktivujeme ju. Rozloženia sál
 * si názov zóny nesú v JSONB tvaroch, takže zmazaním by sa sedadlá ticho
 * preceňovali na základnú cenu.
 */
export const deletePriceCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { count } = await supabaseAdmin
      .from("event_price_categories")
      .select("event_id", { count: "exact", head: true })
      .eq("price_category_id", data.id);
    if ((count ?? 0) > 0) {
      await supabaseAdmin
        .from("price_categories")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", data.id);
      return { ok: true, deactivated: true, events_count: count ?? 0 };
    }
    const { error } = await supabaseAdmin.from("price_categories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, deactivated: false, events_count: 0 };
  });

/**
 * Ceny zón pre jedno podujatie. Verejné — zákaznícka mapa podľa nich vypisuje
 * cenu sedadla a musí sedieť s tým, čo naúčtuje server.
 */
export const listEventZonePrices = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ event_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<EventZonePrice[]> => {
    const { data: rows, error } = await supabaseAdmin
      .from("event_price_categories")
      .select("price_category_id, price, price_categories ( name, color, sort_order )")
      .eq("event_id", data.event_id);
    if (error) throw new Error(error.message);

    type Joined = {
      price_category_id: string;
      price: number;
      price_categories?: { name: string; color: string | null; sort_order: number } | null;
    };
    return ((rows || []) as unknown as Joined[])
      .map((r) => ({
        price_category_id: r.price_category_id,
        name: r.price_categories?.name ?? "",
        color: r.price_categories?.color ?? undefined,
        price: Number(r.price),
        sort: r.price_categories?.sort_order ?? 100,
      }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ sort: _sort, ...rest }) => rest);
  });

/**
 * Prepíše ceny zón podujatia. Zoznam je úplný — zóna, ktorá v ňom nie je, sa
 * zmaže a jej sedadlá sa vrátia na základnú (resp. VIP) cenu podujatia.
 *
 * Zóny sa posielajú názvom, nie id: rozloženie sály nesie v tvaroch názov a
 * ocenenie ho podľa názvu aj hľadá. Názov, ktorý číselník ešte nepozná, sa doň
 * doplní — inak by sa zóna prenesenej sály nedala oceniť vôbec.
 */
export const setEventZonePrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        event_id: z.string().uuid(),
        prices: z
          .array(
            z.object({
              name: z.string().min(1).max(120),
              price: z.number().nonnegative(),
            }),
          )
          .max(60),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: event } = await supabaseAdmin
      .from("events")
      .select("id, organizer_id")
      .eq("id", data.event_id)
      .maybeSingle();
    if (!event) throw new Error("Podujatie sa nenašlo");
    if (event.organizer_id !== context.userId && !(await isAdmin(context.userId))) {
      throw new Error("Forbidden: podujatie patrí inému organizátorovi");
    }

    const ids = await resolveZoneIds(data.prices.map((p) => p.name));
    const rows = data.prices
      .map((p) => ({ id: ids.get(p.name.trim().toLowerCase()), price: p.price }))
      .filter((r): r is { id: string; price: number } => !!r.id);

    const keep = [...new Set(rows.map((r) => r.id))];
    let del = supabaseAdmin.from("event_price_categories").delete().eq("event_id", data.event_id);
    if (keep.length > 0) del = del.not("price_category_id", "in", `(${keep.join(",")})`);
    await del;

    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from("event_price_categories").upsert(
        rows.map((r) => ({
          event_id: data.event_id,
          price_category_id: r.id,
          price: r.price,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "event_id,price_category_id" },
      );
      if (error) throw new Error(error.message);
    }
    return { ok: true, count: rows.length };
  });

/** Jedna cenová zóna tak, ako ju naozaj používa rozloženie konkrétnej sály. */
export type LayoutZone = {
  name: string;
  color?: string;
  /** Koľko miest do zóny spadá — pomáha rozlíšiť hlavnú zónu od pár doplnkov. */
  seats: number;
};

type ZoneShape = {
  kind?: string;
  priceCategory?: string;
  color?: string;
  rows?: number;
  cols?: number;
  capacity?: number;
};

/**
 * Zóny prítomné v rozložení sály.
 *
 * Číselník `price_categories` je platformový, ale sály prenesené zo starého
 * systému si nesú vlastné názvy zón („Kategória 1", „Balkón", „Tribúny"…).
 * Formulár podujatia musí ponúkať tie, ktoré má vybraná sála — inak organizátor
 * nemá kam zadať cenu a sedadlá sa predajú za základnú cenu.
 */
export const listLayoutZones = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ layout_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<LayoutZone[]> => {
    const { data: row, error } = await supabaseAdmin
      .from("venue_layouts")
      .select("shapes")
      .eq("id", data.layout_id)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const zones = new Map<string, LayoutZone>();
    for (const shape of (row?.shapes as ZoneShape[] | null) ?? []) {
      const name = (shape.priceCategory ?? "").trim();
      if (!name) continue;
      const seats =
        shape.kind === "seats" ? (shape.rows ?? 1) * (shape.cols ?? 1) : (shape.capacity ?? 0);
      const key = name.toLowerCase();
      const found = zones.get(key);
      if (found) found.seats += seats;
      else zones.set(key, { name, color: shape.color || undefined, seats });
    }
    return [...zones.values()].sort((a, b) => b.seats - a.seats || a.name.localeCompare(b.name));
  });

/**
 * Doplní do číselníka zóny, ktoré sála používa, ale platforma ich ešte nepozná.
 * Vracia mapu `názov malými písmenami → id`. Zakladá len to, čo naozaj treba —
 * číselník tak nerastie o stovky názvov zo všetkých prenesených sál.
 */
async function resolveZoneIds(names: string[]): Promise<Map<string, string>> {
  const wanted = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name && slugify(name)) wanted.set(name.toLowerCase(), name);
  }
  const byName = new Map<string, string>();
  if (wanted.size === 0) return byName;

  const { data: existing } = await supabaseAdmin
    .from("price_categories")
    .select("id, name, slug")
    .in("slug", [...wanted.values()].map(slugify));
  for (const row of existing || []) {
    byName.set(row.name.toLowerCase(), row.id);
    // Zhoda cez slug: „Kategória 1" a „kategoria 1" sú tá istá zóna.
    for (const [key, name] of wanted) {
      if (slugify(name) === row.slug) byName.set(key, row.id);
    }
  }

  const missing = [...wanted].filter(([key]) => !byName.has(key));
  if (missing.length > 0) {
    const { data: created, error } = await supabaseAdmin
      .from("price_categories")
      .insert(
        missing.map(([, name]) => ({
          name,
          slug: slugify(name),
          sort_order: 100,
          active: true,
        })),
      )
      .select("id, name");
    if (error) throw new Error(error.message);
    for (const row of created || []) byName.set(row.name.toLowerCase(), row.id);
  }
  return byName;
}
