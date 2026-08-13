// Odoslanie zaplatených vstupeniek zákazníkovi.
//
// Volá sa z oboch ciest vysporiadania platby (GoPay webhook aj overenie pri
// návrate z brány). Idempotenciu drží `orders.tickets_emailed_at`, takže
// opakovaná notifikácia z GoPay nepošle vstupenky druhýkrát.
//
// Zlyhanie odoslania NIKDY nezhodí vysporiadanie platby — peniaze sú prijaté a
// vstupenky vydané; e-mail vie admin poslať znovu.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendMail, isMailConfigured } from "./mailer.server";
import { generateTicketsPdfBase64 } from "./ticket-pdf.server";
import { signOrderAccess } from "./order-access.server";
import { loadEventInfo } from "./event-info.server";

function getOrigin(): string {
  const fromEnv = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return "https://vipky.sk";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type MailEvent = {
  title: string;
  event_date: string;
  event_time: string;
  venue: string;
  city: string;
};

function buildHtml(opts: {
  customerName: string;
  orderShort: string;
  event: MailEvent | null;
  ticketCount: number;
  total: number;
  currency: string;
  ticketsUrl: string;
  invoiceUrl?: string | null;
}): string {
  const { customerName, orderShort, event, ticketCount, total, currency, ticketsUrl, invoiceUrl } =
    opts;
  const eventBlock = event
    ? `
      <tr><td style="padding:4px 0;color:#64748b;">Podujatie</td><td style="padding:4px 0;font-weight:600;">${esc(event.title)}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;">Kedy</td><td style="padding:4px 0;">${esc(event.event_date)} · ${esc(event.event_time)}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;">Kde</td><td style="padding:4px 0;">${esc(event.venue)}, ${esc(event.city)}</td></tr>`
    : "";

  return `<!doctype html>
<html lang="sk"><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#0f172a;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
      <div style="font-size:22px;font-weight:700;">vipky.sk</div>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;">
      <h1 style="margin:0 0 8px;font-size:20px;">Vstupenky sú tvoje 🎟️</h1>
      <p style="margin:0 0 16px;color:#475569;line-height:1.5;">
        Ahoj ${esc(customerName)}, platba prebehla v poriadku.
        ${ticketCount === 1 ? "Vstupenku nájdeš" : `${ticketCount} vstupenky nájdeš`} v prílohe tohto e-mailu ako PDF.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
        ${eventBlock}
        <tr><td style="padding:4px 0;color:#64748b;">Objednávka</td><td style="padding:4px 0;font-family:monospace;">${esc(orderShort)}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Zaplatené</td><td style="padding:4px 0;font-weight:600;">${total.toFixed(2)} ${esc(currency)}</td></tr>
      </table>
      <a href="${esc(ticketsUrl)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;">
        Zobraziť vstupenky online
      </a>
      ${invoiceUrl ? `<p style="margin:16px 0 0;font-size:13px;"><a href="${esc(invoiceUrl)}" style="color:#2563eb;">Stiahnuť faktúru (PDF)</a></p>` : ""}
      <p style="margin:20px 0 0;font-size:13px;color:#64748b;line-height:1.5;">
        Pri vstupe stačí ukázať QR kód z mobilu alebo vytlačenú vstupenku.
        Otázky? Napíš na <a href="mailto:support@vipky.sk" style="color:#2563eb;">support@vipky.sk</a>.
      </p>
    </div>
  </div>
</body></html>`;
}

/**
 * Pošle vstupenky k zaplatenej objednávke. Bezpečné volať opakovane —
 * druhýkrát skončí ako `skipped`.
 */
export async function sendTicketsEmail(
  orderId: string,
  opts?: { force?: boolean },
): Promise<{ sent: boolean; reason?: string }> {
  if (!isMailConfigured()) return { sent: false, reason: "not_configured" };

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { sent: false, reason: "order_not_found" };
  if (order.status !== "paid") return { sent: false, reason: "not_paid" };
  if (order.tickets_emailed_at && !opts?.force) return { sent: false, reason: "already_sent" };
  if (!order.customer_email) return { sent: false, reason: "no_email" };

  const [{ data: tickets }, event] = await Promise.all([
    supabaseAdmin
      .from("tickets")
      .select("seat_label, qr_code")
      .eq("order_id", orderId)
      .order("issued_at", { ascending: true }),
    // Dátum patrí termínu objednávky, nie podujatiu — repríza nesmie prepísať
    // deň konania na už odoslanej vstupenke.
    loadEventInfo(order.event_id, order.event_date_id),
  ]);

  if (!tickets || tickets.length === 0) return { sent: false, reason: "no_tickets" };

  const orderShort = order.id.slice(0, 8).toUpperCase();
  const ticketsUrl = `${getOrigin()}/checkout/success/${order.id}?t=${signOrderAccess(order.id)}`;
  const subject = event ? `Vstupenky: ${event.title}` : `Vstupenky · objednávka ${orderShort}`;

  let attachments;
  try {
    const pdf = await generateTicketsPdfBase64({
      orderId: order.id,
      customerEmail: order.customer_email,
      event: event as MailEvent | null,
      tickets: tickets.map((t) => ({
        seat_label: t.seat_label ?? "Vstupenka",
        qr_code: t.qr_code ?? "",
      })),
    });
    attachments = [{ filename: `vstupenky-${order.id.slice(0, 8)}.pdf`, content: pdf }];
  } catch (e) {
    // PDF sa nepodarilo — e-mail aj tak pošleme, odkaz na online vstupenky v ňom je.
    console.error("PDF pre e-mail zlyhalo", order.id, e);
  }

  const html = buildHtml({
    customerName: (order.customer_name || "").split(" ")[0] || "zákazník",
    orderShort,
    event: (event as MailEvent | null) ?? null,
    ticketCount: tickets.length,
    total: Number(order.total_amount),
    currency: order.currency || "EUR",
    ticketsUrl,
    invoiceUrl: order.superfaktura_invoice_pdf_url,
  });

  const result = await sendMail({
    to: order.customer_email,
    subject,
    html,
    text: `Platba prebehla v poriadku. Vstupenky nájdeš v prílohe alebo online: ${ticketsUrl}`,
    attachments,
  });

  await supabaseAdmin.from("email_logs").insert({
    order_id: order.id,
    recipient: order.customer_email,
    subject,
    provider: "resend",
    provider_message_id: result.ok ? result.id : null,
    status: result.ok ? "ok" : "error",
    error_message: result.ok ? null : result.message,
  });

  if (!result.ok) {
    console.error("Odoslanie vstupeniek zlyhalo", order.id, result.message);
    return { sent: false, reason: result.reason };
  }

  await supabaseAdmin
    .from("orders")
    .update({ tickets_emailed_at: new Date().toISOString() })
    .eq("id", order.id);

  return { sent: true };
}
