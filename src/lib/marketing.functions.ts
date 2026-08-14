// Reklamné kampane, reklamné účty a meracie kódy.
//
// Napojenie na Google Ads a Meta je zatiaľ **evidencia, nie integrácia** —
// žiadne API sa nevolá, takže výkonnostné čísla sú tie, ktoré niekto zapíše.
// Dôležité je, že kampaň už nežije v localStorage jedného prehliadača.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

export type AdPlatform = "google" | "meta";
export type CampaignStatus = "draft" | "active" | "paused" | "ended";

export type AdAccountRecord = {
  id: string;
  organizer_id: string;
  platform: AdPlatform;
  account_id: string;
  account_name: string | null;
  business_account_id: string | null;
  pixel_id: string | null;
  page_name: string | null;
  status: "connected" | "disconnected";
  credit_eur: number;
  last_sync_at: string | null;
  connected_at: string;
};

export type CampaignRecord = {
  id: string;
  organizer_id: string;
  organizer_name: string | null;
  event_id: string | null;
  event_title: string | null;
  platform: AdPlatform;
  name: string;
  goal: string;
  budget_eur: number;
  status: CampaignStatus;
  /** Voľná štruktúra cielenia a kreatívy — do JSONB sa nedotazujeme. */
  audience: Json;
  creative: Json;
  impressions: number;
  clicks: number;
  spend_eur: number;
  conversions: number;
  revenue_eur: number;
  auto_generated: boolean;
  created_at: string;
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

async function resolveOrganizer(userId: string, requested?: string | null): Promise<string> {
  if (requested && requested !== userId) {
    if (!(await isAdmin(userId))) throw new Error("Forbidden: cudzí reklamný účet");
    return requested;
  }
  return userId;
}

// --- Reklamné účty ------------------------------------------------------

export const listAdAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ organizer_id: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<AdAccountRecord[]> => {
    const admin = await isAdmin(context.userId);
    let q = supabaseAdmin
      .from("ad_accounts")
      .select("*")
      .order("connected_at", { ascending: false });
    if (!(admin && !data.organizer_id)) {
      q = q.eq("organizer_id", await resolveOrganizer(context.userId, data.organizer_id));
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows || []).map((a) => ({
      id: a.id,
      organizer_id: a.organizer_id,
      platform: a.platform as AdPlatform,
      account_id: a.account_id,
      account_name: a.account_name,
      business_account_id: a.business_account_id,
      pixel_id: a.pixel_id,
      page_name: a.page_name,
      status: a.status as "connected" | "disconnected",
      credit_eur: Number(a.credit_eur),
      last_sync_at: a.last_sync_at,
      connected_at: a.connected_at,
    }));
  });

export const upsertAdAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        organizer_id: z.string().uuid().optional(),
        platform: z.enum(["google", "meta"]),
        account_id: z.string().min(1).max(120),
        account_name: z.string().max(200).optional().nullable(),
        business_account_id: z.string().max(120).optional().nullable(),
        pixel_id: z.string().max(120).optional().nullable(),
        page_name: z.string().max(200).optional().nullable(),
        status: z.enum(["connected", "disconnected"]).default("connected"),
        credit_eur: z.number().nonnegative().default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
    const row = {
      organizer_id: organizerId,
      platform: data.platform,
      account_id: data.account_id.trim(),
      account_name: data.account_name || null,
      business_account_id: data.business_account_id || null,
      pixel_id: data.pixel_id || null,
      page_name: data.page_name || null,
      status: data.status,
      credit_eur: data.credit_eur,
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      const { error } = await supabaseAdmin.from("ad_accounts").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: created, error } = await supabaseAdmin
      .from("ad_accounts")
      .insert(row)
      .select("id")
      .single();
    if (error || !created) {
      throw new Error(
        error?.message.includes("ad_accounts_unique")
          ? "Tento reklamný účet je už pripojený."
          : error?.message || "Uloženie zlyhalo",
      );
    }
    return { id: created.id };
  });

export const deleteAdAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: acc } = await supabaseAdmin
      .from("ad_accounts")
      .select("organizer_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!acc) throw new Error("Účet sa nenašiel");
    await resolveOrganizer(context.userId, acc.organizer_id);
    const { error } = await supabaseAdmin.from("ad_accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// --- Meracie kódy -------------------------------------------------------

export const getPixelSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ organizer_id: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
    const { data: row } = await supabaseAdmin
      .from("pixel_settings")
      .select("*")
      .eq("organizer_id", organizerId)
      .maybeSingle();
    return {
      organizer_id: organizerId,
      ga4_measurement_id: row?.ga4_measurement_id ?? "",
      gtm_id: row?.gtm_id ?? "",
      google_ads_conversion_id: row?.google_ads_conversion_id ?? "",
      google_ads_conversion_label: row?.google_ads_conversion_label ?? "",
      meta_pixel_id: row?.meta_pixel_id ?? "",
      updated_at: row?.updated_at ?? null,
    };
  });

export const updatePixelSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        organizer_id: z.string().uuid().optional(),
        ga4_measurement_id: z.string().max(120).optional().nullable(),
        gtm_id: z.string().max(120).optional().nullable(),
        google_ads_conversion_id: z.string().max(120).optional().nullable(),
        google_ads_conversion_label: z.string().max(120).optional().nullable(),
        meta_pixel_id: z.string().max(120).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
    const { error } = await supabaseAdmin.from("pixel_settings").upsert(
      {
        organizer_id: organizerId,
        ga4_measurement_id: data.ga4_measurement_id || null,
        gtm_id: data.gtm_id || null,
        google_ads_conversion_id: data.google_ads_conversion_id || null,
        google_ads_conversion_label: data.google_ads_conversion_label || null,
        meta_pixel_id: data.meta_pixel_id || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organizer_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// --- Kampane ------------------------------------------------------------

export const listCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        organizer_id: z.string().uuid().optional(),
        status: z.enum(["draft", "active", "paused", "ended", "all"]).default("all"),
        limit: z.number().int().positive().max(500).default(200),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<CampaignRecord[]> => {
    const admin = await isAdmin(context.userId);
    let q = supabaseAdmin
      .from("ad_campaigns")
      .select("*, events ( title )")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (!(admin && !data.organizer_id)) {
      q = q.eq("organizer_id", await resolveOrganizer(context.userId, data.organizer_id));
    }
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const ids = [...new Set((rows || []).map((r) => r.organizer_id))];
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, company_name")
        .in("id", ids);
      for (const p of profiles || []) {
        names.set(p.id, p.company_name || p.full_name || "");
      }
    }

    type Joined = (typeof rows extends (infer R)[] ? R : never) & {
      events?: { title?: string } | null;
    };
    return ((rows || []) as unknown as Joined[]).map((c) => ({
      id: c.id,
      organizer_id: c.organizer_id,
      organizer_name: names.get(c.organizer_id) || null,
      event_id: c.event_id,
      event_title: c.events?.title ?? null,
      platform: c.platform as AdPlatform,
      name: c.name,
      goal: c.goal,
      budget_eur: Number(c.budget_eur),
      status: c.status as CampaignStatus,
      audience: (c.audience as Json) ?? {},
      creative: (c.creative as Json) ?? {},
      impressions: c.impressions,
      clicks: c.clicks,
      spend_eur: Number(c.spend_eur),
      conversions: c.conversions,
      revenue_eur: Number(c.revenue_eur),
      auto_generated: c.auto_generated,
      created_at: c.created_at,
    }));
  });

const CampaignInput = z.object({
  id: z.string().uuid().optional(),
  organizer_id: z.string().uuid().optional(),
  event_id: z.string().uuid().optional().nullable(),
  platform: z.enum(["google", "meta"]),
  name: z.string().min(1).max(300),
  goal: z.enum(["sales", "traffic", "remarketing", "awareness"]).default("sales"),
  budget_eur: z.number().nonnegative().default(0),
  status: z.enum(["draft", "active", "paused", "ended"]).default("draft"),
  audience: z.record(z.string(), z.any()).default({}),
  creative: z.record(z.string(), z.any()).default({}),
  auto_generated: z.boolean().default(false),
});

export type CampaignInputData = z.input<typeof CampaignInput>;

export const upsertCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CampaignInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
    const row = {
      organizer_id: organizerId,
      event_id: data.event_id || null,
      platform: data.platform,
      name: data.name.trim(),
      goal: data.goal,
      budget_eur: data.budget_eur,
      status: data.status,
      audience: data.audience as never,
      creative: data.creative as never,
      auto_generated: data.auto_generated,
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      const { error } = await supabaseAdmin.from("ad_campaigns").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: created, error } = await supabaseAdmin
      .from("ad_campaigns")
      .insert(row)
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "Kampaň sa nepodarilo uložiť");
    return { id: created.id };
  });

export const setCampaignStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["draft", "active", "paused", "ended"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: c } = await supabaseAdmin
      .from("ad_campaigns")
      .select("organizer_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!c) throw new Error("Kampaň sa nenašla");
    await resolveOrganizer(context.userId, c.organizer_id);
    const { error } = await supabaseAdmin
      .from("ad_campaigns")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: c } = await supabaseAdmin
      .from("ad_campaigns")
      .select("organizer_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!c) throw new Error("Kampaň sa nenašla");
    await resolveOrganizer(context.userId, c.organizer_id);
    const { error } = await supabaseAdmin.from("ad_campaigns").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
