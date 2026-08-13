// Číselník dôvodov refundácie.
//
// `refundOrder` prijímal voľný text, z ktorého sa nedala urobiť štatistika —
// „zrušené podujatie", „zrusene" aj prázdny reťazec znamenali to isté.
// Číselník číta ktokoľvek prihlásený (potrebuje ho refundačný dialóg),
// meniť ho smie len admin.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RefundReasonRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  requires_note: boolean;
  organizer_fault: boolean;
  active: boolean;
  sort_order: number;
  /** Koľkokrát sa dôvod použil (podľa textu v `payments.raw_response`). */
  used_count: number;
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

export const listRefundReasons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ only_active: z.boolean().default(false) }).parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<RefundReasonRecord[]> => {
    let q = supabaseAdmin
      .from("refund_reasons")
      .select("id, code, name, description, requires_note, organizer_fault, active, sort_order")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (data.only_active) q = q.eq("active", true);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = rows || [];
    if (list.length === 0) return [];

    // Použitie zisťujeme z refundačných záznamov v `payment_logs` — dôvod sa
    // ukladá do ich `request_payload`. Refund cez GoPay má v `endpoint`
    // `/refund`, ručný refund `manual_refund`; obidva chytí to isté `ilike`.
    const { data: refunds } = await supabaseAdmin
      .from("payment_logs")
      .select("request_payload")
      .ilike("endpoint", "%refund%")
      .limit(2000);
    const counts = new Map<string, number>();
    for (const r of refunds || []) {
      const reason = (r.request_payload as { reason?: string } | null)?.reason;
      if (!reason) continue;
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }

    return list.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      requires_note: r.requires_note,
      organizer_fault: r.organizer_fault,
      active: r.active,
      sort_order: r.sort_order,
      used_count: counts.get(r.name) || 0,
    }));
  });

const ReasonInput = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_]+$/, "Kód smie mať len malé písmená, číslice a podčiarkovník"),
  name: z.string().min(1).max(160),
  description: z.string().max(1000).optional().nullable(),
  requires_note: z.boolean().default(false),
  organizer_fault: z.boolean().default(false),
  active: z.boolean().default(true),
  sort_order: z.number().int().nonnegative().default(100),
});

export type RefundReasonInputData = z.input<typeof ReasonInput>;

export const upsertRefundReason = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ReasonInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.userId);

    const row = {
      code: data.code.trim().toLowerCase(),
      name: data.name.trim(),
      description: data.description || null,
      requires_note: data.requires_note,
      organizer_fault: data.organizer_fault,
      active: data.active,
      sort_order: data.sort_order,
    };

    if (data.id) {
      const { error } = await supabaseAdmin.from("refund_reasons").update(row).eq("id", data.id);
      if (error) throw new Error(friendly(error.message));
      return { id: data.id };
    }
    const { data: created, error } = await supabaseAdmin
      .from("refund_reasons")
      .insert(row)
      .select("id")
      .single();
    if (error || !created)
      throw new Error(friendly(error?.message || "Dôvod sa nepodarilo uložiť"));
    return { id: created.id };
  });

function friendly(message: string): string {
  if (message.includes("refund_reasons_code_key")) return "Takýto kód už existuje.";
  return message;
}

/** Dôvod sa nemaže natvrdo, keď sa už použil — inak by zmizol z histórie. */
export const deleteRefundReason = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("refund_reasons").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
