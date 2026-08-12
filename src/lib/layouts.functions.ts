// Server funkcie pre rozloženia sál (presun z localStorage do databázy).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { HallLayout, HallType, Shape, CurveGroup } from "./layout-types";

const COLUMNS =
  "id, owner_id, name, type, city, address, note, capacity, shapes, curve_groups, created_at, updated_at";

type Row = Record<string, unknown>;

function mapLayout(r: Row): HallLayout {
  const opt = <T>(v: unknown): T | undefined =>
    v === null || v === undefined ? undefined : (v as T);
  return {
    id: r.id as string,
    name: r.name as string,
    type: r.type as HallType,
    city: opt<string>(r.city),
    address: opt<string>(r.address),
    note: opt<string>(r.note),
    capacity: opt<number>(r.capacity),
    shapes: (r.shapes as Shape[]) ?? [],
    curveGroups: (r.curve_groups as CurveGroup[]) ?? [],
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

/** Zoznam sál. Verejný — plán sály je súčasť ponuky a musí ho vidieť aj kupujúci. */
export const listLayouts = createServerFn({ method: "POST" }).handler(
  async (): Promise<HallLayout[]> => {
    const { data, error } = await supabaseAdmin
      .from("venue_layouts")
      .select(COLUMNS)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data as Row[]) || []).map(mapLayout);
  },
);

export const getLayoutById = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<HallLayout | null> => {
    const { data: row } = await supabaseAdmin
      .from("venue_layouts")
      .select(COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    return row ? mapLayout(row as Row) : null;
  });

// Tvary editora sú voľné štruktúry — validujeme hranice (počet, veľkosť), nie
// každý atribút. Prísna schéma by sa rozbila pri každej zmene editora.
const ShapeSchema = z.object({ id: z.string().min(1) }).passthrough();

const LayoutInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  type: z.string().max(60).default("koncertna-hala"),
  city: z.string().max(200).optional().nullable(),
  address: z.string().max(400).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  capacity: z.number().int().nonnegative().optional().nullable(),
  shapes: z.array(ShapeSchema).max(20000).default([]),
  curveGroups: z.array(ShapeSchema).max(2000).default([]),
});

export type LayoutInputData = z.input<typeof LayoutInput>;

/** Vytvorí alebo upraví sálu. Organizátor smie svoje, admin všetky. */
export const upsertLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => LayoutInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const admin = await isAdmin(context.userId);

    let ownerId = context.userId;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("venue_layouts")
        .select("id, owner_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!existing) throw new Error("Sála sa nenašla");
      if (existing.owner_id !== context.userId && !admin) {
        throw new Error("Forbidden: sála patrí inému organizátorovi");
      }
      ownerId = existing.owner_id ?? context.userId;
    }

    const row = {
      owner_id: ownerId,
      name: data.name,
      type: data.type,
      city: data.city ?? null,
      address: data.address ?? null,
      note: data.note ?? null,
      capacity: data.capacity ?? null,
      shapes: data.shapes as unknown as never,
      curve_groups: data.curveGroups as unknown as never,
    };

    if (data.id) {
      const { error } = await supabaseAdmin.from("venue_layouts").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: created, error } = await supabaseAdmin
      .from("venue_layouts")
      .insert(row)
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "Sálu sa nepodarilo vytvoriť");
    return { id: created.id };
  });

export const deleteLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: existing } = await supabaseAdmin
      .from("venue_layouts")
      .select("id, owner_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!existing) throw new Error("Sála sa nenašla");
    if (existing.owner_id !== context.userId && !(await isAdmin(context.userId))) {
      throw new Error("Forbidden: sála patrí inému organizátorovi");
    }
    const { error } = await supabaseAdmin.from("venue_layouts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
