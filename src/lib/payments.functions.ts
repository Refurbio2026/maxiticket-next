// Server functions for the GoPay + SuperFaktúra checkout flow.
// Keep this file thin: only createServerFn declarations and their imports.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createGoPayPayment,
  getGoPayPaymentStatus,
  mapGoPayStateToOrder,
} from "./gopay.server";
import { createPaidInvoice } from "./superfaktura.server";
import { signOrderAccess, verifyOrderAccess } from "./order-access.server";
import { newSignedTicket } from "./qr-token.server";

function getOrigin(): string {
  const fromEnv = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return "https://project--dff07d0a-f011-4a35-b195-c8c7bc1b200f-dev.lovable.app";
}

// Server-side admin check for privileged operations.
async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

const CustomerSchema = z.object({
  first_name: z.string().min(1).max(120),
  last_name: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().max(40).optional().nullable(),
});

const ItemSchema = z.object({
  seat_id: z.string().max(120).optional().nullable(),
  label: z.string().min(1).max(200),
  unit_price: z.number().nonnegative(),
  quantity: z.number().int().positive().default(1),
});

// 1) Submit order: create Supabase order + items + seat_inventory reservation.
export const submitOrder = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        event_id: z.string().uuid(),
        customer: CustomerSchema,
        items: z.array(ItemSchema).min(1).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const total = data.items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        event_id: data.event_id,
        customer_name: `${data.customer.first_name} ${data.customer.last_name}`.trim(),
        customer_email: data.customer.email,
        customer_phone: data.customer.phone || null,
        total_amount: total,
        currency: "EUR",
        status: "pending",
        expires_at: expiresAt,
      })
      .select()
      .single();
    if (orderErr || !order) throw new Error(orderErr?.message || "Nepodarilo sa vytvoriť objednávku");

    const itemsRows = data.items.map((it) => ({
      order_id: order.id,
      seat_id: it.seat_id || null,
      label: it.label,
      unit_price: it.unit_price,
      quantity: it.quantity,
    }));
    const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(itemsRows);
    if (itemsErr) throw new Error(itemsErr.message);

    // Reserve seats in inventory (only for items with seat_id)
    const seats = data.items.filter((it) => !!it.seat_id);
    if (seats.length > 0) {
      const seatIds = seats.map((it) => it.seat_id!);
      const nowIso = new Date().toISOString();

      // SECURITY/CORRECTNESS: never blind-upsert over a seat that is already
      // sold or actively reserved by someone else — that would oversell it.
      const { data: existing } = await supabaseAdmin
        .from("seat_inventory")
        .select("seat_id, status, reserved_until, order_id")
        .eq("event_id", data.event_id)
        .in("seat_id", seatIds);

      const conflict = (existing || []).find(
        (r: any) =>
          r.order_id !== order.id &&
          (r.status === "sold" ||
            (r.status === "reserved" && (!r.reserved_until || r.reserved_until > nowIso))),
      );
      if (conflict) {
        // Roll back the just-created order so we don't leave an orphan.
        await supabaseAdmin.from("order_items").delete().eq("order_id", order.id);
        await supabaseAdmin.from("orders").delete().eq("id", order.id);
        throw new Error("Niektoré sedadlá už nie sú dostupné. Skús vybrať iné.");
      }

      const inv = seats.map((it) => ({
        event_id: data.event_id,
        seat_id: it.seat_id!,
        status: "reserved" as const,
        price: it.unit_price,
        label: it.label,
        order_id: order.id,
        reserved_until: expiresAt,
      }));
      await supabaseAdmin.from("seat_inventory").upsert(inv, { onConflict: "event_id,seat_id" });
    }
    return { order_id: order.id };
  });

// 2) Create GoPay payment for an existing pending order.
export const createGoPayPaymentForOrder = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", data.order_id)
      .single();
    if (error || !order) throw new Error("Objednávka sa nenašla");
    if (order.status !== "pending" && order.status !== "awaiting_payment") {
      throw new Error(`Objednávka má stav ${order.status}, nedá sa znovu zaplatiť`);
    }
    if (order.gopay_payment_url && order.status === "awaiting_payment") {
      return { payment_url: order.gopay_payment_url, payment_id: order.gopay_payment_id };
    }
    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("*")
      .eq("order_id", order.id);

    const origin = getOrigin();
    const orderShort = order.id.slice(0, 8).toUpperCase();

    let result;
    try {
      result = await createGoPayPayment({
        orderNumber: orderShort,
        orderDescription: `Vstupenky vstupenky.sk ${orderShort}`,
        amountCents: Math.round(Number(order.total_amount) * 100),
        currency: order.currency || "EUR",
        customer: {
          firstName: (order.customer_name || "").split(" ")[0] || "",
          lastName: (order.customer_name || "").split(" ").slice(1).join(" ") || "",
          email: order.customer_email || "",
          phone: order.customer_phone || "",
        },
        items: (items || []).map((it) => ({
          name: it.label,
          amountCents: Math.round(Number(it.unit_price) * 100),
          count: it.quantity || 1,
        })),
        returnUrl: `${origin}/checkout/return?orderId=${order.id}&t=${signOrderAccess(order.id)}`,
        notificationUrl: `${origin}/api/public/payments/gopay/webhook?orderId=${order.id}`,
        lang: "SK",
      });
    } catch (e: any) {
      await supabaseAdmin.from("payment_logs").insert({
        order_id: order.id,
        provider: "gopay",
        endpoint: "/payments/payment",
        request_payload: { order_id: order.id },
        status: "error",
        error_message: String(e?.message || e),
      });
      throw e;
    }

    await supabaseAdmin.from("payment_logs").insert({
      order_id: order.id,
      provider: "gopay",
      endpoint: "/payments/payment",
      request_payload: { order_id: order.id, total: order.total_amount },
      response_payload: result.raw as any,
      status: "ok",
    });

    await supabaseAdmin
      .from("orders")
      .update({
        gopay_payment_id: String(result.id),
        gopay_payment_url: result.gw_url,
        status: "awaiting_payment",
      })
      .eq("id", order.id);

    await supabaseAdmin.from("payments").insert({
      order_id: order.id,
      provider: "gopay",
      provider_payment_id: String(result.id),
      amount: order.total_amount,
      currency: order.currency || "EUR",
      status: "pending",
      raw_response: result.raw as any,
    });

    return { payment_url: result.gw_url, payment_id: String(result.id) };
  });

// Internal helper used by the webhook + verify endpoint.
async function settleOrderIfPaid(orderId: string) {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (!order) throw new Error("Objednávka sa nenašla");
  if (!order.gopay_payment_id) {
    return { changed: false, status: order.status, reason: "no_payment_id" };
  }

  const status = await getGoPayPaymentStatus(order.gopay_payment_id);
  const mapped = mapGoPayStateToOrder(status.state);

  await supabaseAdmin.from("payment_logs").insert({
    order_id: order.id,
    provider: "gopay",
    endpoint: `/payments/payment/${order.gopay_payment_id}`,
    request_payload: null,
    response_payload: status.raw as any,
    status: "ok",
  });

  await supabaseAdmin
    .from("payments")
    .update({
      status: mapped === "paid" ? "paid" : mapped === "cancelled" ? "cancelled" : mapped === "failed" ? "failed" : mapped === "refunded" ? "refunded" : "pending",
      raw_response: status.raw as any,
    })
    .eq("order_id", order.id)
    .eq("provider_payment_id", String(order.gopay_payment_id));

  // Idempotency: if already paid in DB, just return.
  if (order.status === "paid" && mapped === "paid") {
    return { changed: false, status: "paid" };
  }

  if (mapped === "paid") {
    // 1) order paid
    await supabaseAdmin
      .from("orders")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", order.id);

    // 2) seats sold
    await supabaseAdmin
      .from("seat_inventory")
      .update({ status: "sold", reserved_until: null })
      .eq("order_id", order.id);

    // 3) issue tickets if none exist yet
    const { data: existingTickets } = await supabaseAdmin
      .from("tickets")
      .select("id")
      .eq("order_id", order.id)
      .limit(1);
    if (!existingTickets || existingTickets.length === 0) {
      const { data: items } = await supabaseAdmin
        .from("order_items")
        .select("*")
        .eq("order_id", order.id);
      const tickets = (items || []).flatMap((it) =>
        Array.from({ length: it.quantity || 1 }).map((_, i) => {
          // Signed, verifiable token — identical scheme to the webhook path.
          const { id, token } = newSignedTicket();
          return {
            id,
            order_id: order.id,
            event_id: order.event_id,
            seat_id: it.seat_id,
            seat_label: it.label + ((it.quantity || 1) > 1 ? ` #${i + 1}` : ""),
            qr_code: token,
            qr_token: token,
          };
        }),
      );
      if (tickets.length > 0) {
        await supabaseAdmin.from("tickets").insert(tickets);
      }
    }

    // 4) SuperFaktúra — vystaviť faktúru, ak ešte nie je
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
        console.error("SuperFaktúra failed for order", order.id, e);
        // nepadáme — platba je úspešná, faktúru môže admin vystaviť znovu
      }
    }
    return { changed: true, status: "paid" };
  }

  if (mapped === "cancelled" || mapped === "failed") {
    await supabaseAdmin
      .from("orders")
      .update({ status: mapped })
      .eq("id", order.id);
    await supabaseAdmin
      .from("seat_inventory")
      .update({ status: "available", reserved_until: null, order_id: null })
      .eq("order_id", order.id);
    return { changed: true, status: mapped };
  }

  return { changed: false, status: order.status };
}

export const settleGoPayOrder = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    return settleOrderIfPaid(data.order_id);
  });

// Read shape for /checkout/return and /checkout/success.
// SECURITY: personal data (customer name/email/phone) is only returned when the
// caller presents a valid per-order access token (issued in the GoPay return
// URL). Without it we still return the event/items/tickets so the QR renders,
// but strip PII — so a stranger who only knows the order id can't harvest it.
export const getOrderSummary = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ order_id: z.string().uuid(), access_token: z.string().optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", data.order_id)
      .single();
    if (error || !order) return { order: null, items: [], tickets: [], event: null };
    const [{ data: items }, { data: tickets }, { data: event }] = await Promise.all([
      supabaseAdmin.from("order_items").select("*").eq("order_id", order.id),
      supabaseAdmin.from("tickets").select("*").eq("order_id", order.id),
      supabaseAdmin.from("events").select("*").eq("id", order.event_id).maybeSingle(),
    ]);

    const authorized = verifyOrderAccess(order.id, data.access_token);
    const safeOrder = authorized
      ? order
      : { ...order, customer_name: null, customer_email: null, customer_phone: null };

    return { order: safeOrder, items: items || [], tickets: tickets || [], event: event || null };
  });

// Admin: re-issue invoice manually
export const reissueInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", data.order_id)
      .single();
    if (!order) throw new Error("Objednávka sa nenašla");
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
    return { invoice_number: result.invoice_number, pdf_url: result.pdf_url };
  });
