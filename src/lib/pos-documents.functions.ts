// Vydávanie uložených pokladničných dokumentov klientovi.
//
// Kreslenie žije v `pos-pdf.server.ts`, ukladanie v `pos-documents.server.ts`;
// tu je len autorizácia a načítanie. Obsah dokumentu sa nikdy nedostane do
// zoznamu — base64 chodí výhradne cez `downloadPosDocument`, inak by prehľad
// ťahal megabajty pri každom otvorení stránky.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildClosingDocument, buildReceiptDocument } from "./pos-documents.server";

export type PosDocumentRecord = {
  id: string;
  kind: "closing" | "receipt";
  title: string;
  filename: string;
  size_bytes: number;
  closing_id: string | null;
  order_id: string | null;
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
    if (!(await isAdmin(userId))) throw new Error("Forbidden: cudzí doklad");
    return requested;
  }
  return userId;
}

export const listPosDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        organizer_id: z.string().uuid().optional(),
        kind: z.enum(["closing", "receipt"]).optional(),
        limit: z.number().int().positive().max(200).default(50),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<PosDocumentRecord[]> => {
    const admin = await isAdmin(context.userId);
    let q = supabaseAdmin
      .from("pos_documents")
      .select("id, kind, title, filename, size_bytes, closing_id, order_id, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    // Admin bez zadaného organizátora vidí doklady všetkých.
    if (!(admin && !data.organizer_id)) {
      const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
      q = q.eq("organizer_id", organizerId);
    }
    if (data.kind) q = q.eq("kind", data.kind);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows || []) as PosDocumentRecord[];
  });

export const downloadPosDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ filename: string; content_type: string; base64: string }> => {
      const { data: doc } = await supabaseAdmin
        .from("pos_documents")
        .select("organizer_id, filename, content_type, content_base64")
        .eq("id", data.id)
        .maybeSingle();
      if (!doc) throw new Error("Dokument sa nenašiel");
      await resolveOrganizer(context.userId, doc.organizer_id);

      return {
        filename: doc.filename,
        content_type: doc.content_type,
        base64: doc.content_base64,
      };
    },
  );

/**
 * Doklad k uzávierke. Uzávierky spred zavedenia dokumentov ho ešte nemajú,
 * tak ho pri prvom stiahnutí dogenerujeme z uložených (zmrazených) čísel.
 */
export const getClosingDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ closing_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ filename: string; base64: string }> => {
    const { data: closing } = await supabaseAdmin
      .from("pos_closings")
      .select("id, organizer_id")
      .eq("id", data.closing_id)
      .maybeSingle();
    if (!closing) throw new Error("Uzávierka sa nenašla");
    await resolveOrganizer(context.userId, closing.organizer_id);

    const { data: existing } = await supabaseAdmin
      .from("pos_documents")
      .select("filename, content_base64")
      .eq("closing_id", closing.id)
      .maybeSingle();
    if (existing) return { filename: existing.filename, base64: existing.content_base64 };

    const doc = await buildClosingDocument(closing.id, context.userId);
    return { filename: doc.filename, base64: doc.base64 };
  });

/**
 * Pokladničný doklad k POS objednávke. Generuje sa až na požiadanie — pri
 * predaji by len zdržiaval frontu pri pokladni.
 */
export const getReceiptDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ order_id: z.string().uuid(), refresh: z.boolean().default(false) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ filename: string; base64: string }> => {
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, event_id")
      .eq("id", data.order_id)
      .maybeSingle();
    if (!order) throw new Error("Objednávka sa nenašla");
    const { data: event } = await supabaseAdmin
      .from("events")
      .select("organizer_id")
      .eq("id", order.event_id)
      .maybeSingle();
    if (!event) throw new Error("Podujatie sa nenašlo");
    await resolveOrganizer(context.userId, event.organizer_id);

    if (!data.refresh) {
      const { data: existing } = await supabaseAdmin
        .from("pos_documents")
        .select("filename, content_base64")
        .eq("order_id", order.id)
        .eq("kind", "receipt")
        .maybeSingle();
      if (existing) return { filename: existing.filename, base64: existing.content_base64 };
    }

    const doc = await buildReceiptDocument(order.id, context.userId);
    return { filename: doc.filename, base64: doc.base64 };
  });
