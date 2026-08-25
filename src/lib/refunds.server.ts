// Vrátenie peňazí za objednávku — jadro, ktoré používa aj refund z admina,
// aj hromadné zrušenie podujatia.
//
// Zavolá príslušnú platobnú bránu, upraví stav objednávky, platby, sedadiel
// a vstupeniek, zapíše do payment_logs a pošle oznam zákazníkovi.
//
// Brána, ktorá refund cez API nevie (GP webpay má na to len samostatné WS
// rozhranie), refund zapíše, ale vráti `manual_action_required` — peniaze
// treba poslať ručne z portálu brány.
import { errorMessage } from "./error-message";
import type { Json } from "@/integrations/supabase/types";

export type RefundOrderResult = {
  ok: true;
  order_id: string;
  refunded_amount: number;
  full: boolean;
  email_queued: boolean;
  email_skipped_reason?: string;
  /** Vyplnené, keď brána refund cez API nevie a peniaze treba vrátiť ručne. */
  manual_action_required?: string;
};

export type RefundVstup = {
  order_id: string;
  /** Bez sumy sa vráti celý zostatok. */
  amount?: number;
  reason?: string | null;
  notifyCustomer: boolean;
  /** Kto refund spustil — zapíše sa k objednávke. */
  userId: string;
};

export async function vratPeniaze(vstup: RefundVstup): Promise<RefundOrderResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { branaPodlaId, pripravPristupy } = await import("./payment-gateways/index.server");
  await pripravPristupy();

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", vstup.order_id)
    .single();
  if (error || !order) throw new Error("Objednávka sa nenašla");
  if (order.status !== "paid") {
    throw new Error(`Nemožno refundovať — objednávka má stav '${order.status}'.`);
  }

  const total = Number(order.total_amount);
  // Čiastočný refund necháva objednávku v stave `paid`, takže bez súčtu už
  // vrátenej sumy by sa dala vrátiť aj viackrát dokola.
  const alreadyRefunded = Number(order.refunded_amount || 0);
  const remaining = total - alreadyRefunded;
  const amount = vstup.amount ?? remaining;
  if (amount <= 0 || amount > remaining + 0.01) {
    throw new Error(
      alreadyRefunded > 0
        ? `Z objednávky už bolo vrátených ${alreadyRefunded.toFixed(2)} ${order.currency} — vrátiť sa dá najviac ${remaining.toFixed(2)}.`
        : `Neplatná suma refundu (max ${total.toFixed(2)} ${order.currency}).`,
    );
  }
  // „Plný" znamená, že objednávka je po tomto refunde vrátená celá — aj keď
  // sa k tomu prišlo dvoma čiastočnými.
  const full = Math.abs(alreadyRefunded + amount - total) < 0.01;

  // 1) Vrátenie peňazí cez bránu, ktorou sa platilo. Keď brána chýba alebo
  //    refund cez API nevie, zostáva len ručné vrátenie.
  const providerId = order.payment_provider || (order.gopay_payment_id ? "gopay" : null);
  const providerRef = order.payment_ref || order.gopay_payment_id;
  const brana = providerId ? branaPodlaId(providerId) : null;

  let providerRaw: Json = null;
  let manualAction: string | undefined;

  if (brana && providerRef && brana.supportsRefund) {
    try {
      const res = await brana.refund(providerRef, amount);
      providerRaw = res.raw;
      await supabaseAdmin.from("payment_logs").insert({
        order_id: order.id,
        provider: brana.id,
        endpoint: `refund:${providerRef}`,
        request_payload: { amount, full, reason: vstup.reason || null, by: vstup.userId },
        response_payload: providerRaw,
        status: "ok",
      });
    } catch (e) {
      await supabaseAdmin.from("payment_logs").insert({
        order_id: order.id,
        provider: brana.id,
        endpoint: `refund:${providerRef}`,
        request_payload: { amount, full, reason: vstup.reason || null, by: vstup.userId },
        status: "error",
        error_message: errorMessage(e),
      });
      throw e;
    }
  } else {
    manualAction = brana
      ? `Brána ${brana.label} vrátenie cez API nepodporuje — peniaze pošli z jej portálu.`
      : "Objednávka nemá online platbu — refund je zapísaný ako ručný.";
    await supabaseAdmin.from("payment_logs").insert({
      order_id: order.id,
      provider: providerId || "gopay",
      endpoint: "manual_refund",
      request_payload: {
        amount,
        full,
        reason: vstup.reason || null,
        by: vstup.userId,
        note: manualAction,
      },
      status: "ok",
    });
  }

  // 2) Insert a payment row marking the refund.
  await supabaseAdmin.from("payments").insert({
    order_id: order.id,
    provider: providerId || "gopay",
    provider_payment_id: providerRef || null,
    amount: -Math.abs(amount),
    currency: order.currency || "EUR",
    status: "refunded",
    raw_response: providerRaw,
  });

  // 3) Zápis refundu na objednávku. Bez toho by sa dôvod aj čas dali zistiť
  // len z ladiaceho logu platby a prehľad Storno by nemal z čoho čítať.
  const refundedAt = new Date().toISOString();
  await supabaseAdmin
    .from("orders")
    .update({
      refunded_at: refundedAt,
      refunded_amount: Number((alreadyRefunded + amount).toFixed(2)),
      refund_reason: vstup.reason || order.refund_reason || null,
      refunded_by: vstup.userId,
    })
    .eq("id", order.id);

  // 4) Stav mení len plný refund. Čiastočný necháva objednávku zaplatenú.
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

  // 5) Notify customer — try the queue if email infra is set up, else skip.
  let email_queued = false;
  let email_skipped_reason: string | undefined;
  if (vstup.notifyCustomer && order.customer_email) {
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
        reason: vstup.reason || "",
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
    } catch (e) {
      email_skipped_reason = errorMessage(e);
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
    manual_action_required: manualAction,
  };
}
