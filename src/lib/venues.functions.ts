// Miesta konania (číselník hál a adries).
//
// Podujatie si adresu naďalej nesie aj ako text — číta ju verejný katalóg, PDF
// aj e-maily. Miesto je zdroj pravdy, text je jeho odtlačok v momente uloženia.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VenueRecord = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  note: string | null;
  default_layout_id: string | null;
  default_layout_name: string | null;
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

/** Zoznam miest. Verejný — adresa podujatia je súčasť ponuky. */
export const listVenues = createServerFn({ method: "POST" }).handler(
  async (): Promise<VenueRecord[]> => {
    const [{ data: venues, error }, { data: layouts }, { data: events }] = await Promise.all([
      supabaseAdmin
        .from("venues")
        .select("id, name, city, address, note, default_layout_id")
        .order("name", { ascending: true }),
      supabaseAdmin.from("venue_layouts").select("id, name"),
      supabaseAdmin.from("events").select("venue_id"),
    ]);
    if (error) throw new Error(error.message);

    const layoutNames = new Map((layouts || []).map((l) => [l.id, l.name]));
    const counts = new Map<string, number>();
    for (const e of events || []) {
      if (!e.venue_id) continue;
      counts.set(e.venue_id, (counts.get(e.venue_id) || 0) + 1);
    }

    return (venues || []).map((v) => ({
      id: v.id,
      name: v.name,
      city: v.city,
      address: v.address,
      note: v.note,
      default_layout_id: v.default_layout_id,
      default_layout_name: v.default_layout_id
        ? (layoutNames.get(v.default_layout_id) ?? null)
        : null,
      events_count: counts.get(v.id) || 0,
    }));
  },
);

const VenueInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(300),
  city: z.string().min(1).max(200),
  address: z.string().max(400).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  default_layout_id: z.string().uuid().optional().nullable(),
});

export type VenueInputData = z.input<typeof VenueInput>;

export const upsertVenue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => VenueInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.userId);
    const row = {
      name: data.name.trim(),
      city: data.city.trim(),
      address: data.address?.trim() || null,
      note: data.note?.trim() || null,
      default_layout_id: data.default_layout_id || null,
    };

    if (data.id) {
      const { error } = await supabaseAdmin.from("venues").update(row).eq("id", data.id);
      if (error) throw new Error(mapVenueError(error.message));

      // Podujatia si nesú adresu ako text — po premenovaní miesta by inak
      // ostali s pôvodným názvom a katalóg by ukazoval dva rôzne údaje.
      await supabaseAdmin
        .from("events")
        .update({ venue: row.name, city: row.city, address: row.address })
        .eq("venue_id", data.id);
      return { id: data.id };
    }

    const { data: created, error } = await supabaseAdmin
      .from("venues")
      .insert(row)
      .select("id")
      .single();
    if (error || !created) throw new Error(mapVenueError(error?.message || "Uloženie zlyhalo"));
    return { id: created.id };
  });

export const deleteVenue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    // Väzba je `on delete set null`, takže podujatie prežije — ostane mu text.
    // Aj tak radšej upozorníme, nech sa miesto nemaže omylom spod podujatí.
    const { count } = await supabaseAdmin
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", data.id);
    if ((count ?? 0) > 0) {
      throw new Error(
        `Miesto používa ${count} podujatí. Najprv im nastav iné miesto, potom ho zmaž.`,
      );
    }
    const { error } = await supabaseAdmin.from("venues").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function mapVenueError(message: string): string {
  if (message.includes("venues_name_city_uniq")) {
    return "Miesto s týmto názvom už v danom meste existuje.";
  }
  return message;
}
