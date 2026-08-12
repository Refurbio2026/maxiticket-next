// Vydávanie PDF vstupeniek klientovi. Samotné kreslenie žije v
// `ticket-pdf.server.ts`, tu je len autorizácia a načítanie dát.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { verifyOrderAccess } from "./order-access.server";
import {
  generateTicketsPdfBase64,
  generateEventTicketsPdfBase64,
  type PdfEventInfo,
} from "./ticket-pdf.server";

export type PdfResult = { filename: string; base64: string };

/**
 * PDF vstupeniek jednej objednávky pre kupujúceho.
 *
 * BEZPEČNOSŤ: PDF obsahuje QR kódy, ktorými sa vstupenka preukazuje pri vstupe.
 * Vyžadujeme preto ten istý podpísaný token ako `getOrderSummary` — samotné
 * uhádnutie čísla objednávky nestačí.
 */
export const renderOrderTicketsPdf = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ order_id: z.string().uuid(), access_token: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }): Promise<PdfResult> => {
    if (!verifyOrderAccess(data.order_id, data.access_token)) {
      throw new Error("Neplatný prístupový odkaz k objednávke.");
    }

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, event_id, customer_email, status")
      .eq("id", data.order_id)
      .maybeSingle();
    if (!order) throw new Error("Objednávka sa nenašla");

    const [{ data: tickets }, { data: event }] = await Promise.all([
      supabaseAdmin
        .from("tickets")
        .select("seat_label, qr_code")
        .eq("order_id", order.id)
        .order("issued_at", { ascending: true }),
      supabaseAdmin
        // Bez `scanner_token` — na vstupenku ani do odpovede nepatrí.
        .from("events")
        .select("title, event_date, event_time, venue, city")
        .eq("id", order.event_id)
        .maybeSingle(),
    ]);

    if (!tickets || tickets.length === 0) {
      throw new Error("K objednávke zatiaľ nie sú vydané žiadne vstupenky.");
    }

    const base64 = await generateTicketsPdfBase64({
      orderId: order.id,
      customerEmail: order.customer_email,
      event: (event as PdfEventInfo | null) ?? null,
      tickets: tickets.map((t) => ({
        seat_label: t.seat_label ?? "Vstupenka",
        qr_code: t.qr_code ?? "",
      })),
    });

    return { filename: `vstupenky-${order.id.slice(0, 8)}.pdf`, base64 };
  });

/**
 * PDF všetkých predaných vstupeniek podujatia pre organizátora.
 *
 * BEZPEČNOSŤ: rovnaká úvaha ako pri `getEventSoldTickets` — vracia QR payloady
 * aj údaje kupujúcich, takže prihlásenie nestačí. Vyžaduje admina alebo
 * vlastníka podujatia.
 */
export const renderEventTicketsPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ event_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PdfResult> => {
    const { data: event } = await supabaseAdmin
      .from("events")
      .select("id, title, event_date, event_time, venue, city, organizer_id")
      .eq("id", data.event_id)
      .maybeSingle();
    if (!event) throw new Error("Podujatie sa nenašlo");

    if (event.organizer_id !== context.userId) {
      const { data: isAdmin } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle();
      if (!isAdmin) throw new Error("Forbidden: podujatie patrí inému organizátorovi");
    }

    const { data: tickets } = await supabaseAdmin
      .from("tickets")
      .select("seat_label, qr_code, order_id, used_at, orders ( customer_name, customer_email )")
      .eq("event_id", event.id)
      .order("issued_at", { ascending: true });

    if (!tickets || tickets.length === 0) {
      throw new Error("Pre toto podujatie zatiaľ neexistujú žiadne predané lístky.");
    }

    const base64 = await generateEventTicketsPdfBase64({
      event: event as PdfEventInfo,
      tickets: tickets.map((t: any) => ({
        seat_label: t.seat_label ?? "Vstupenka",
        qr_code: t.qr_code ?? "",
        order_id: t.order_id,
        customer_name: t.orders?.customer_name ?? null,
        customer_email: t.orders?.customer_email ?? null,
        used_at: t.used_at,
      })),
    });

    const slug = event.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);
    return { filename: `qr-listky-${slug}-${event.event_date}.pdf`, base64 };
  });
