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
      await supabaseAdmin.from("orders").update({ status: "refunded" }).eq("id", order.id);
      // Free seats and invalidate tickets
      await supabaseAdmin
        .from("seat_inventory")
        .update({ status: "available", order_id: null, reserved_until: null })
        .eq("order_id", order.id);
      // Označíme ich ako refundované, nie ako použité. Skener podľa toho
      // personálu povie „refundovaná" namiesto zavádzajúceho „už bola použitá",
      // a štatistika skenov nezapočíta refundy medzi vstupy.
      await supabaseAdmin
        .from("tickets")
        .update({ refunded_at: new Date().toISOString() })
        .eq("order_id", order.id)
        .is("refunded_at", null);
    }

    // 4) Notify customer — try the queue if email infra is set up, else skip.
    let email_queued = false;
    let email_skipped_reason: string | undefined;
    if (data.notify_customer && order.customer_email) {
      try {
        const orderShort = order.id.slice(0, 8).toUpperCase();

        // Znenie je šablóna `refund` v databáze; keď chýba, použije sa vstavaná.
        const { renderEmail } = await import("./email-templates.server");
        const rendered = await renderEmail("refund", {
          customer_name: order.customer_name || "",
          order_short: orderShort,
          amount: amount.toFixed(2),
          currency: order.currency || "EUR",
          refund_type: full ? "Plný refund" : "Čiastočný refund",
          reason: data.reason || "",
        });
        const subject = full
          ? rendered.subject
          : rendered.subject.replace("refund objednávky", "čiastočný refund objednávky");

        // Pôvodne to volalo RPC `enqueue_email` do fronty `transactional_emails`.
        // Tá funkcia v databáze neexistuje (ani schéma pgmq), takže oznámenie
        // o refunde nikdy neodišlo — chyba sa len ticho zapísala do dôvodu a
        // admin videl „ok". Ide to cez ten istý mailer ako vstupenky.
        const { sendMail } = await import("./mailer.server");
        const sent = await sendMail({
          to: order.customer_email,
          subject,
          html: rendered.html,
          text: rendered.text,
        });
        await supabaseAdmin.from("email_logs").insert({
          order_id: order.id,
          recipient: order.customer_email,
          subject,
          provider: "resend",
          provider_message_id: sent.ok ? sent.id : null,
          status: sent.ok ? "ok" : "error",
          error_message: sent.ok ? null : sent.message,
        });
        if (sent.ok) {
          email_queued = true;
        } else {
          email_skipped_reason = sent.message;
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
