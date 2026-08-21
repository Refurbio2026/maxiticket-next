// Doúčtovanie objednávky po platbe — nezávisle od toho, ktorá brána ju
// spracovala. Doteraz existovala táto logika dvakrát (v payments.functions.ts
// a v GoPay webhooku) a s pribudnutím GP webpay a tatrapay+ by ju bolo treba
// štyrikrát; preto je tu raz.
//
// Celý postup musí byť idempotentný: brána vie notifikáciu poslať viackrát,
// zákazník vie stránku návratu obnoviť a dopytovací sken beží dokola.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { branaPodlaId, pripravPristupy } from "./payment-gateways/index.server";
import type { GatewayId, PaymentState } from "./payment-gateways/types";
import { createPaidInvoice } from "./superfaktura.server";
import { newSignedTicket } from "./qr-token.server";
import { sendTicketsEmail } from "./ticket-mail.server";
import { releaseCouponForOrder } from "./coupons.server";
import { errorMessage } from "./error-message";

export type SettleResult = {
  changed: boolean;
  status: string;
  reason?: string;
};

/** Stav, ktorý nám doručil overený návrat z brány (GP webpay). */
export type OverenyStav = { state: PaymentState; raw: Json };

/**
 * Zistí stav platby a dotiahne objednávku do zodpovedajúceho stavu.
 *
 * @param overeny Keď brána stav dopytovať nevie, dá sa jej výsledok podstrčiť —
 *   ale iba taký, ktorého podpis už bol overený. Nepodpísaný vstup sem nesmie.
 */
export async function settleOrder(orderId: string, overeny?: OverenyStav): Promise<SettleResult> {
  await pripravPristupy();
  const { data: order } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).single();
  if (!order) throw new Error("Objednávka sa nenašla");

  // Staré objednávky majú bránu len v gopay_* stĺpcoch.
  const providerId = (order.payment_provider ||
    (order.gopay_payment_id ? "gopay" : null)) as GatewayId | null;
  const providerRef = order.payment_ref || order.gopay_payment_id;
  if (!providerId || !providerRef) {
    return { changed: false, status: order.status, reason: "no_payment_id" };
  }

  let stav = overeny;
  if (!stav) {
    const brana = branaPodlaId(providerId);
    const zistene = await brana.getStatus(providerRef);
    if (!zistene) {
      // Brána sa dopytovať nedá a nikto nám overený stav nepodstrčil.
      return { changed: false, status: order.status, reason: "provider_has_no_status_api" };
    }
    stav = zistene;
  }

  await supabaseAdmin.from("payment_logs").insert({
    order_id: order.id,
    provider: providerId,
    endpoint: `status:${providerRef}`,
    request_payload: null,
    response_payload: stav.raw,
    status: "ok",
  });

  await supabaseAdmin
    .from("payments")
    .update({
      status:
        stav.state === "paid"
          ? "paid"
          : stav.state === "cancelled"
            ? "cancelled"
            : stav.state === "failed"
              ? "failed"
              : stav.state === "refunded"
                ? "refunded"
                : "pending",
      raw_response: stav.raw,
    })
    .eq("order_id", order.id)
    .eq("provider_payment_id", String(providerRef));

  // Už zaplatená objednávka sa druhýkrát nespracúva.
  if (order.status === "paid" && stav.state === "paid") {
    return { changed: false, status: "paid" };
  }

  if (stav.state === "paid") {
    await supabaseAdmin
      .from("orders")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", order.id);

    await supabaseAdmin
      .from("seat_inventory")
      .update({ status: "sold", reserved_until: null })
      .eq("order_id", order.id);

    await vydajVstupenky(order);
    await vystavFakturu(order);

    // Zlyhanie e-mailu nesmie zhodiť doúčtovanie — peniaze sú prijaté
    // a vstupenky vydané. Opakovanému odoslaniu bráni tickets_emailed_at.
    try {
      await sendTicketsEmail(order.id);
    } catch (e) {
      console.error("Odoslanie vstupeniek zlyhalo pre objednávku", order.id, e);
    }

    return { changed: true, status: "paid" };
  }

  if (stav.state === "cancelled" || stav.state === "failed") {
    await supabaseAdmin.from("orders").update({ status: stav.state }).eq("id", order.id);
    await supabaseAdmin
      .from("seat_inventory")
      .update({ status: "available", reserved_until: null, order_id: null })
      .eq("order_id", order.id);
    // Za nezaplatenú objednávku kupón neprepadá.
    await releaseCouponForOrder(order.id);
    return { changed: true, status: stav.state };
  }

  return { changed: false, status: order.status };
}

type Objednavka = { id: string; event_id: string; event_date_id: string } & Record<string, unknown>;

async function vydajVstupenky(order: Objednavka): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from("tickets")
    .select("id")
    .eq("order_id", order.id)
    .limit(1);
  if (existing && existing.length > 0) return;

  const { data: items } = await supabaseAdmin
    .from("order_items")
    .select("*")
    .eq("order_id", order.id);
  const tickets = (items || []).flatMap((it) =>
    Array.from({ length: it.quantity || 1 }).map((_, i) => {
      const { id, token } = newSignedTicket();
      return {
        id,
        order_id: order.id,
        event_id: order.event_id,
        event_date_id: order.event_date_id,
        seat_id: it.seat_id,
        seat_label: it.label + ((it.quantity || 1) > 1 ? ` #${i + 1}` : ""),
        qr_code: token,
        qr_token: token,
      };
    }),
  );
  if (tickets.length > 0) await supabaseAdmin.from("tickets").insert(tickets);
}

async function vystavFakturu(order: Objednavka): Promise<void> {
  if (order.superfaktura_invoice_id) return;
  try {
    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("*")
      .eq("order_id", order.id);
    const result = await createPaidInvoice({
      orderId: order.id,
      // Variabilný symbol je ten istý, aký šiel do banky — inak by sa platba
      // na výpise nedala spárovať s faktúrou.
      variableSymbol: order.payment_vs
        ? String(order.payment_vs)
        : order.id.slice(0, 8).toUpperCase(),
      customer: {
        name: (order.customer_name as string) || "Zákazník",
        email: (order.customer_email as string) || "",
        phone: (order.customer_phone as string) || undefined,
      },
      items: (items || []).map((it) => ({
        name: it.label,
        unit_price: Number(it.unit_price),
        quantity: it.quantity || 1,
        tax: 20,
      })),
      paymentType: "card",
    });
    await supabaseAdmin
      .from("orders")
      .update({
        superfaktura_invoice_id: result.invoice_id,
        superfaktura_invoice_number: result.invoice_number,
        superfaktura_invoice_pdf_url: result.pdf_url,
      })
      .eq("id", order.id);
    await supabaseAdmin.from("superfaktura_logs").insert({
      order_id: order.id,
      invoice_id: result.invoice_id,
      endpoint: "/invoices/create",
      response_payload: result.raw,
      status: "ok",
    });
  } catch (e) {
    await supabaseAdmin.from("superfaktura_logs").insert({
      order_id: order.id,
      endpoint: "/invoices/create",
      status: "error",
      error_message: errorMessage(e),
    });
    // Nepadáme — platba je úspešná, faktúru vie admin vystaviť znovu.
    console.error("SuperFaktúra zlyhala pre objednávku", order.id, e);
  }
}
