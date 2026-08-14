// Nastavenie eKasy (ORP) a evidencia fiškálnych dokladov.
//
// Samotné odosielanie do eKasy je stále simulácia (`fiscal-adapter.ts`) —
// chýba certifikát a zmluva s poskytovateľom. Nastavenie a vystavené doklady
// však patria do databázy: predtým žili v localStorage, takže sa pri vymazaní
// cache stratili a druhá pokladňa o nich nevedela.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FiscalSettingsRecord = {
  organizer_id: string;
  enabled: boolean;
  provider: string | null;
  cash_register_code: string | null;
  dic: string | null;
  ic_dph: string | null;
  endpoint_url: string | null;
  connection_status: "connected" | "disconnected" | "error";
  last_check_at: string | null;
  note: string | null;
};

export type FiscalReceiptRecord = {
  id: string;
  order_id: string | null;
  order_short: string | null;
  receipt_number: string;
  fiscal_code: string | null;
  total_amount: number;
  payment_method: string | null;
  status: "issued" | "cancelled" | "error";
  error_message: string | null;
  issued_at: string;
  cancelled_at: string | null;
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

/** Nastavenie patrí organizátorovi; admin smie pozerať aj cudzie. */
async function resolveOrganizer(userId: string, requested?: string | null): Promise<string> {
  if (requested && requested !== userId) {
    if (!(await isAdmin(userId))) throw new Error("Forbidden: cudzia eKasa");
    return requested;
  }
  return userId;
}

export const getFiscalSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ organizer_id: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<FiscalSettingsRecord> => {
    const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
    const { data: row } = await supabaseAdmin
      .from("fiscal_settings")
      .select("*")
      .eq("organizer_id", organizerId)
      .maybeSingle();

    return {
      organizer_id: organizerId,
      enabled: row?.enabled ?? false,
      provider: row?.provider ?? null,
      cash_register_code: row?.cash_register_code ?? null,
      dic: row?.dic ?? null,
      ic_dph: row?.ic_dph ?? null,
      endpoint_url: row?.endpoint_url ?? null,
      connection_status: (row?.connection_status ?? "disconnected") as "disconnected",
      last_check_at: row?.last_check_at ?? null,
      note: row?.note ?? null,
    };
  });

export const updateFiscalSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        organizer_id: z.string().uuid().optional(),
        enabled: z.boolean().default(false),
        provider: z.string().max(120).optional().nullable(),
        cash_register_code: z.string().max(120).optional().nullable(),
        dic: z.string().max(40).optional().nullable(),
        ic_dph: z.string().max(40).optional().nullable(),
        endpoint_url: z.string().max(500).optional().nullable(),
        connection_status: z.enum(["connected", "disconnected", "error"]).default("disconnected"),
        note: z.string().max(2000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
    const { error } = await supabaseAdmin.from("fiscal_settings").upsert(
      {
        organizer_id: organizerId,
        enabled: data.enabled,
        provider: data.provider || null,
        cash_register_code: data.cash_register_code || null,
        dic: data.dic || null,
        ic_dph: data.ic_dph || null,
        endpoint_url: data.endpoint_url || null,
        connection_status: data.connection_status,
        last_check_at: new Date().toISOString(),
        note: data.note || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organizer_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listFiscalReceipts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        organizer_id: z.string().uuid().optional(),
        limit: z.number().int().positive().max(500).default(100),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<FiscalReceiptRecord[]> => {
    const admin = await isAdmin(context.userId);
    let q = supabaseAdmin
      .from("fiscal_receipts")
      .select("*")
      .order("issued_at", { ascending: false })
      .limit(data.limit);
    // Admin bez zadaného organizátora vidí doklady všetkých.
    if (!(admin && !data.organizer_id)) {
      const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
      q = q.eq("organizer_id", organizerId);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    return (rows || []).map((r) => ({
      id: r.id,
      order_id: r.order_id,
      order_short: r.order_id ? r.order_id.slice(0, 8).toUpperCase() : null,
      receipt_number: r.receipt_number,
      fiscal_code: r.fiscal_code,
      total_amount: Number(r.total_amount),
      payment_method: r.payment_method,
      status: r.status as FiscalReceiptRecord["status"],
      error_message: r.error_message,
      issued_at: r.issued_at,
      cancelled_at: r.cancelled_at,
    }));
  });

/**
 * Zapíše vystavený fiškálny doklad. Volá sa z pokladne po odoslaní do eKasy;
 * kým je eKasa simulovaná, `fiscal_code` ostáva prázdny.
 */
export const recordFiscalReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        organizer_id: z.string().uuid().optional(),
        order_id: z.string().uuid().optional().nullable(),
        receipt_number: z.string().min(1).max(120),
        fiscal_code: z.string().max(200).optional().nullable(),
        total_amount: z.number().nonnegative(),
        payment_method: z.string().max(40).optional().nullable(),
        status: z.enum(["issued", "cancelled", "error"]).default("issued"),
        error_message: z.string().max(1000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
    const { data: created, error } = await supabaseAdmin
      .from("fiscal_receipts")
      .insert({
        organizer_id: organizerId,
        order_id: data.order_id || null,
        receipt_number: data.receipt_number,
        fiscal_code: data.fiscal_code || null,
        total_amount: data.total_amount,
        payment_method: data.payment_method || null,
        status: data.status,
        error_message: data.error_message || null,
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "Doklad sa nepodarilo zapísať");
    return { id: created.id };
  });

/** Storno fiškálneho dokladu — doklad ostáva v evidencii, len zmení stav. */
export const cancelFiscalReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: receipt } = await supabaseAdmin
      .from("fiscal_receipts")
      .select("id, organizer_id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (!receipt) throw new Error("Doklad sa nenašiel");
    await resolveOrganizer(context.userId, receipt.organizer_id);
    if (receipt.status === "cancelled") throw new Error("Doklad je už stornovaný.");

    const { error } = await supabaseAdmin
      .from("fiscal_receipts")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
