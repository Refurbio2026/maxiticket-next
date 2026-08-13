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
import { renderEmail } from "./email-templates.server";

function getOrigin(): string {
  const fromEnv = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return "https://vipky.sk";
}

type MailEvent = {
  title: string;
  event_date: string;
  event_time: string;
  venue: string;
  city: string;
};

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

  // Znenie e-mailu je šablóna v databáze (upravuje ju admin). Keď chýba,
  // `renderEmail` vráti vstavané znenie, takže odoslanie nikdy nezávisí od
  // toho, či niekto šablónu založil.
  const ev = (event as MailEvent | null) ?? null;
  const rendered = await renderEmail("tickets", {
    customer_name: (order.customer_name || "").split(" ")[0] || "zákazník",
    order_short: orderShort,
    event_title: ev?.title ?? "",
    event_date: ev?.event_date ?? "",
    event_time: ev?.event_time ?? "",
    venue: ev?.venue ?? "",
    city: ev?.city ?? "",
    ticket_count: tickets.length,
    ticket_sentence:
      tickets.length === 1 ? "Vstupenku nájdeš" : `${tickets.length} vstupenky nájdeš`,
    total: Number(order.total_amount).toFixed(2),
    currency: order.currency || "EUR",
    tickets_url: ticketsUrl,
    invoice_url: order.superfaktura_invoice_pdf_url ?? "",
  });

  // Bez názvu podujatia by bol predmet „Vstupenky: " — vtedy radšej číslo objednávky.
  const subject = ev ? rendered.subject : `Vstupenky · objednávka ${orderShort}`;

  const result = await sendMail({
    to: order.customer_email,
    subject,
    html: rendered.html,
    text: rendered.text,
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
