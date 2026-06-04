// Admin refund flow for orders. Handles GoPay refund call (full or partial),
// updates order/payment/seat/ticket state, logs to payment_logs and queues a
// customer notification entry.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

export type RefundOrderResult = {
  ok: true;
  order_id: string;
  refunded_amount: number;
  full: boolean;
  email_queued: boolean;
  email_skipped_reason?: string;
};

export const refundOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        order_id: z.string().uuid(),
        amount: z.number().positive().optional(),
        reason: z.string().max(500).optional().nullable(),
        notify_customer: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<RefundOrderResult> => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { refundGoPayPayment } = await import("./gopay.server");

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", data.order_id)
      .single();
    if (error || !order) throw new Error("Objednávka sa nenašla");
    if (order.status !== "paid") {
      throw new Error(`Nemožno refundovať — objednávka má stav '${order.status}'.`);
    }

    const total = Number(order.total_amount);
    const amount = data.amount ?? total;
    if (amount <= 0 || amount > total + 0.01) {
      throw new Error(`Neplatná suma refundu (max ${total.toFixed(2)} ${order.currency}).`);
    }
    const full = Math.abs(amount - total) < 0.01;

    // 1) Call GoPay if we have a payment id; otherwise treat as manual refund.
    let providerOk = false;
    let providerRaw: any = null;
    if (order.gopay_payment_id) {
      try {
        const res = await refundGoPayPayment(order.gopay_payment_id, Math.round(amount * 100));
        providerOk = true;
        providerRaw = res.raw;
        await supabaseAdmin.from("payment_logs").insert({
          order_id: order.id,
          provider: "gopay",
          endpoint: `/payments/payment/${order.gopay_payment_id}/refund`,
          request_payload: { amount, full, reason: data.reason || null, by: context.userId },
          response_payload: providerRaw,
          status: "ok",
        });
      } catch (e: any) {
        await supabaseAdmin.from("payment_logs").insert({
          order_id: order.id,
          provider: "gopay",
          endpoint: `/payments/payment/${order.gopay_payment_id}/refund`,
          request_payload: { amount, full, reason: data.reason || null, by: context.userId },
          status: "error",
          error_message: String(e?.message || e),
        });
        throw e;
      }
    } else {
      await supabaseAdmin.from("payment_logs").insert({
        order_id: order.id,
        provider: "gopay",
        endpoint: "manual_refund",
        request_payload: { amount, full, reason: data.reason || null, by: context.userId },
        status: "ok",
      });
    }

    // 2) Insert a payment row marking the refund.
    await supabaseAdmin.from("payments").insert({
      order_id: order.id,
      provider: "gopay",
      provider_payment_id: order.gopay_payment_id || null,
      amount: -Math.abs(amount),
      currency: order.currency || "EUR",
      status: "refunded",
      raw_response: providerRaw,
    });

    // 3) Update order status (full only). Partial keeps it paid.
    if (full) {
      await supabaseAdmin
        .from("orders")
        .update({ status: "refunded" })
        .eq("id", order.id);
      // Free seats and invalidate tickets
      await supabaseAdmin
        .from("seat_inventory")
        .update({ status: "available", order_id: null, reserved_until: null })
        .eq("order_id", order.id);
      await supabaseAdmin
        .from("tickets")
        .update({ used_at: new Date().toISOString() })
        .eq("order_id", order.id)
        .is("used_at", null);
    }

    // 4) Notify customer — try the queue if email infra is set up, else skip.
    let email_queued = false;
    let email_skipped_reason: string | undefined;
    if (data.notify_customer && order.customer_email) {
      try {
        const orderShort = order.id.slice(0, 8).toUpperCase();
        const subject = full
          ? `MAXITICKET — refund objednávky #${orderShort}`
          : `MAXITICKET — čiastočný refund objednávky #${orderShort}`;
        const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#fff;padding:24px;color:#111">
<h2 style="margin:0 0 12px">Refund spracovaný</h2>
<p>Dobrý deň ${order.customer_name || ""},</p>
<p>refund za vašu objednávku <strong>#${orderShort}</strong> bol úspešne spracovaný.</p>
<table style="border-collapse:collapse;margin:16px 0">
  <tr><td style="padding:4px 12px 4px 0;color:#666">Suma:</td><td><strong>${amount.toFixed(2)} ${order.currency || "EUR"}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Typ:</td><td>${full ? "Plný refund" : "Čiastočný refund"}</td></tr>
  ${data.reason ? `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Dôvod:</td><td>${data.reason}</td></tr>` : ""}
</table>
<p>Suma sa vráti na pôvodný spôsob platby (zvyčajne do 5 pracovných dní).</p>
<p style="color:#888;font-size:12px;margin-top:24px">MAXITICKET</p>
</body></html>`;

        const { error: enqErr } = await supabaseAdmin.rpc("enqueue_email" as any, {
          queue_name: "transactional_emails",
          message: {
            to: order.customer_email,
            subject,
            html,
            template_name: "refund_notification",
            recipient_email: order.customer_email,
            idempotency_key: `refund-${order.id}-${Date.now()}`,
          },
        } as any);
        if (enqErr) {
          email_skipped_reason = enqErr.message;
        } else {
          email_queued = true;
        }
      } catch (e: any) {
        email_skipped_reason = String(e?.message || e);
      }
    } else if (!order.customer_email) {
      email_skipped_reason = "Objednávka nemá email zákazníka.";
    }

    return {
      ok: true,
      order_id: order.id,
      refunded_amount: amount,
      full,
      email_queued,
      email_skipped_reason,
    };
  });
