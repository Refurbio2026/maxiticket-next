import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { buildGoogleWalletSaveLink, type WalletLinkResult } from "./google-wallet.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyTicket } from "./qr-token.server";

// Server function: postaví podpísaný odkaz „Pridať do Google Wallet" pre jednu
// vstupenku. Samotné podpisovanie (RS256) žije v google-wallet.server.ts, aby
// sa vytriaslo z klientskeho bundlu.
//
// BEZPEČNOSŤ: pôvodne táto funkcia podpísala čokoľvek, čo dostala — názov
// podujatia, miesto aj meno držiteľa prichádzali z klienta. Nič tým neunikalo
// (volajúci už musí poznať QR hodnotu), ale ktokoľvek si vedel nechať podpísať
// wallet pass s ľubovoľným textom pod issuer účtom vipky.sk. Teraz overujeme
// QR token a všetky údaje na passe berieme z databázy — klient určuje výhradne
// to, KTORÁ vstupenka sa má pridať.
export const getGoogleWalletSaveLink = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      qrValue: z.string().min(1).max(200),
      originUrl: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }): Promise<WalletLinkResult> => {
    const ticketId = verifyTicket(data.qrValue);
    if (!ticketId) {
      return { ok: false, reason: "error", message: "Neplatný kód vstupenky." };
    }

    const { data: ticket } = await supabaseAdmin
      .from("tickets")
      .select("id, seat_label, qr_code, refunded_at, event_id, order_id")
      .eq("id", ticketId)
      .maybeSingle();
    if (!ticket) {
      return { ok: false, reason: "error", message: "Vstupenka sa nenašla." };
    }
    if (ticket.refunded_at) {
      return { ok: false, reason: "error", message: "Vstupenka bola refundovaná." };
    }

    const [{ data: event }, { data: order }] = await Promise.all([
      supabaseAdmin
        .from("events")
        // Bez `scanner_token` — na wallet pass nepatrí.
        .select("title, event_date, event_time, venue, city")
        .eq("id", ticket.event_id)
        .maybeSingle(),
      supabaseAdmin.from("orders").select("customer_name").eq("id", ticket.order_id).maybeSingle(),
    ]);

    return buildGoogleWalletSaveLink({
      ticketId: ticket.id,
      qrValue: ticket.qr_code ?? data.qrValue,
      eventTitle: event?.title ?? "Podujatie",
      eventDateISO:
        event?.event_date && event?.event_time
          ? `${event.event_date}T${event.event_time}`
          : undefined,
      venue: event?.venue,
      city: event?.city,
      seatLabel: ticket.seat_label ?? undefined,
      holderName: order?.customer_name ?? undefined,
      originUrl: data.originUrl,
    });
  });
