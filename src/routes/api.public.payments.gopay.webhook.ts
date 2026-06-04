// GoPay sends a notification (GET or POST) when payment state changes.
// We don't trust the notification body — we always re-fetch the payment
// status from GoPay API server-side. The orderId is provided as a query
// param we set on creation; we also fall back to the GoPay payment id.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getGoPayPaymentStatus, mapGoPayStateToOrder } from "@/lib/gopay.server";
import { createPaidInvoice } from "@/lib/superfaktura.server";
import { signTicket } from "@/lib/qr-token.server";
import crypto from "crypto";

async function settle(orderId: string) {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (!order || !order.gopay_payment_id) return;

  const status = await getGoPayPaymentStatus(order.gopay_payment_id);
  const mapped = mapGoPayStateToOrder(status.state);

  await supabaseAdmin.from("payment_logs").insert({
    order_id: order.id,
    provider: "gopay",
    endpoint: `webhook:${order.gopay_payment_id}`,
    response_payload: status.raw as any,
    status: "ok",
  });

  if (order.status === "paid" && mapped === "paid") return;

  if (mapped === "paid") {
    await supabaseAdmin
      .from("orders")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", order.id);
    await supabaseAdmin
      .from("seat_inventory")
      .update({ status: "sold", reserved_until: null })
      .eq("order_id", order.id);
    await supabaseAdmin
      .from("payments")
      .update({ status: "paid", raw_response: status.raw as any })
      .eq("order_id", order.id);

    const { data: existing } = await supabaseAdmin
      .from("tickets")
      .select("id")
      .eq("order_id", order.id)
      .limit(1);
    if (!existing || existing.length === 0) {
      const { data: items } = await supabaseAdmin
        .from("order_items")
        .select("*")
        .eq("order_id", order.id);
      const tickets = (items || []).flatMap((it) =>
        Array.from({ length: it.quantity || 1 }).map((_, i) => {
          const id = crypto.randomUUID();
          const token = signTicket(id);
          return {
            id,
            order_id: order.id,
            event_id: order.event_id,
            seat_id: it.seat_id,
            seat_label: it.label + (it.quantity > 1 ? ` #${i + 1}` : ""),
            qr_code: token,
            qr_token: token,
          };
        }),
      );
      if (tickets.length > 0) await supabaseAdmin.from("tickets").insert(tickets);
    }

    if (!order.superfaktura_invoice_id) {
      try {
        const { data: items } = await supabaseAdmin
          .from("order_items")
          .select("*")
          .eq("order_id", order.id);
        const orderShort = order.id.slice(0, 8).toUpperCase();
        const result = await createPaidInvoice({
          orderId: order.id,
          variableSymbol: orderShort,
          customer: {
            name: order.customer_name || "Zákazník",
            email: order.customer_email || "",
            phone: order.customer_phone || undefined,
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
          response_payload: result.raw as any,
          status: "ok",
        });
      } catch (e: any) {
        await supabaseAdmin.from("superfaktura_logs").insert({
          order_id: order.id,
          endpoint: "/invoices/create",
          status: "error",
          error_message: String(e?.message || e),
        });
        console.error("SF invoice failed", e);
      }
    }
  } else if (mapped === "cancelled" || mapped === "failed") {
    await supabaseAdmin.from("orders").update({ status: mapped }).eq("id", order.id);
    await supabaseAdmin
      .from("seat_inventory")
      .update({ status: "available", reserved_until: null, order_id: null })
      .eq("order_id", order.id);
    await supabaseAdmin
      .from("payments")
      .update({ status: mapped === "cancelled" ? "cancelled" : "failed", raw_response: status.raw as any })
      .eq("order_id", order.id);
  }
}

async function handler({ request }: { request: Request }) {
  try {
    const url = new URL(request.url);
    let orderId = url.searchParams.get("orderId");
    if (!orderId && request.method === "POST") {
      try {
        const body = await request.json();
        // GoPay payload contains the payment id; we look up the order by it
        const gopayId = body?.id || body?.parent_id;
        if (gopayId) {
          const { data: ord } = await supabaseAdmin
            .from("orders")
            .select("id")
            .eq("gopay_payment_id", String(gopayId))
            .maybeSingle();
          orderId = ord?.id || null;
        }
      } catch {
        /* GoPay may send empty body */
      }
    }
    if (!orderId) {
      return new Response(JSON.stringify({ ok: false, reason: "no_order_id" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    await settle(orderId);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    console.error("GoPay webhook error", e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 200, // 200 aby GoPay neretryoval do nekonečna pri našej chybe
      headers: { "content-type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/payments/gopay/webhook")({
  server: { handlers: { GET: handler, POST: handler } },
});
