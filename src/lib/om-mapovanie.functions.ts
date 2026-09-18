// Starý systém v admine: prehľad predaja a potvrdzovanie väzieb na naše podujatia.
//
// Väzba `om_event_map` je jediné, čo stojí medzi automatickým odhadom a tým,
// že skener vpustí človeka dnu — preto ju potvrdzuje výhradne admin a nikdy
// sa nepotvrdzuje hromadne na slepo.
//
// Prehľad predaja **nefiltruje podľa toho, či má podujatie náprotivok u nás**.
// 87 % starého predaja ho nemá a do prevádzkového prehľadu patrí rovnako ako
// zvyšok — organizátori v starom systéme účty nemali, to je vec eticketa.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OmPredajRiadok = {
  id_plan: number;
  drama_name: string | null;
  datum: string | null;
  start_time: string | null;
  hall_name: string | null;
  promoter: string | null;
  ico: string | null;
  mapovanie: "unmapped" | "suggested" | "confirmed" | "rejected";
  event_id: string | null;
  event_date_id: string | null;
  nase_podujatie: string | null;
  nas_datum: string | null;
  nas_cas: string | null;
  confidence: number | null;
  predanych: number;
  permanentiek: number;
  rezervovanych: number;
  naskenovanych: number;
  podozrivych: number;
  trzba_s_dph: number;
};

export type OmSuhrn = {
  podujati: number;
  predanych: number;
  trzba_s_dph: number;
  navrhov: number;
  potvrdenych: number;
  bez_vazby: number;
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

const filterSchema = z.object({
  /** Hľadá v názve podujatia aj organizátora. */
  hladaj: z.string().trim().max(120).optional(),
  mapovanie: z.enum(["vsetko", "unmapped", "suggested", "confirmed", "rejected"]).default("vsetko"),
  od: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  do: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Len podujatia, kde sa naozaj niečo predalo. */
  len_s_predajom: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
});

export const listOmPredaj = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => filterSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<{ riadky: OmPredajRiadok[]; suhrn: OmSuhrn }> => {
    await assertAdmin(context.userId);

    let q = supabaseAdmin
      .from("om_predaj_prehlad")
      .select("*")
      .order("datum", { ascending: false })
      .limit(data.limit);

    if (data.mapovanie !== "vsetko") q = q.eq("mapovanie", data.mapovanie);
    if (data.od) q = q.gte("datum", data.od);
    if (data.do) q = q.lte("datum", data.do);
    if (data.len_s_predajom) q = q.gt("predanych", 0);
    if (data.hladaj) {
      const vzor = `%${data.hladaj.replace(/[%_]/g, "")}%`;
      q = q.or(`drama_name.ilike.${vzor},promoter.ilike.${vzor}`);
    }

    const { data: riadky, error } = await q;
    if (error) throw new Error(error.message);

    // Súhrn sa počíta nad **celým** starým systémom, nie nad stránkou filtra —
    // inak by číslo skákalo podľa toho, čo je práve vyfiltrované.
    const { data: vsetko, error: e2 } = await supabaseAdmin
      .from("om_predaj_prehlad")
      .select("mapovanie, predanych, trzba_s_dph");
    if (e2) throw new Error(e2.message);

    const suhrn = (vsetko ?? []).reduce<OmSuhrn>(
      (a, r) => ({
        podujati: a.podujati + 1,
        predanych: a.predanych + Number(r.predanych ?? 0),
        trzba_s_dph: a.trzba_s_dph + Number(r.trzba_s_dph ?? 0),
        navrhov: a.navrhov + (r.mapovanie === "suggested" ? 1 : 0),
        potvrdenych: a.potvrdenych + (r.mapovanie === "confirmed" ? 1 : 0),
        bez_vazby: a.bez_vazby + (r.mapovanie === "unmapped" ? 1 : 0),
      }),
      { podujati: 0, predanych: 0, trzba_s_dph: 0, navrhov: 0, potvrdenych: 0, bez_vazby: 0 },
    );

    return { riadky: (riadky ?? []) as OmPredajRiadok[], suhrn };
  });

/**
 * Potvrdenie alebo odmietnutie väzby.
 *
 * Potvrdiť sa dá len väzba, ktorá na niečo ukazuje — stráži to aj databáza.
 * Odmietnutie je platný záver, nie chyba: znamená „toto podujatie u nás
 * náprotivok nemá" a taký plán ostane v prehľade, len sa nespája.
 */
export const rozhodniOmVazbu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id_plan: z.number().int().positive(),
        rozhodnutie: z.enum(["confirmed", "rejected"]),
        note: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    const { data: vazba, error: e1 } = await supabaseAdmin
      .from("om_event_map")
      .select("id_plan, event_id, event_date_id")
      .eq("id_plan", data.id_plan)
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!vazba) throw new Error("Väzba neexistuje — plán nemá návrh na spárovanie.");

    if (data.rozhodnutie === "confirmed" && (!vazba.event_id || !vazba.event_date_id)) {
      throw new Error("Väzbu bez podujatia a termínu nemožno potvrdiť.");
    }

    const { error } = await supabaseAdmin
      .from("om_event_map")
      .update({
        status: data.rozhodnutie,
        confirmed_by: context.userId,
        confirmed_at: new Date().toISOString(),
        note: data.note ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id_plan", data.id_plan);
    if (error) throw new Error(error.message);

    return { ok: true as const };
  });

/** Doplní návrhy pre plány, ktoré ešte nikto neposúdil. */
export const navrhniOmMapovanie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ pridanych: number }> => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin.rpc("om_navrhni_mapovanie");
    if (error) throw new Error(error.message);
    return { pridanych: Number(data ?? 0) };
  });
