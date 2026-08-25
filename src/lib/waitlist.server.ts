// Upovedomenie čakajúcich, keď sa miesta uvoľnia.
//
// Zámerne to nevisí na jednotlivých miestach, kde sa kapacita vracia (storno,
// refund, vypršaná rezervácia, zrušený termín). Tých je veľa a jedno
// zabudnuté by znamenalo čakačku, ktorá ticho nefunguje. Namiesto toho sa
// voľná kapacita raz za beh cronu spočíta a porovná so zoznamom.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { renderEmail } from "./email-templates.server";
import { sendMail } from "./mailer.server";
import { siteUrl } from "./site-url.server";
import { errorMessage } from "./error-message";

export type VysledokCakacky = {
  terminov: number;
  upovedomenych: number;
  zlyhalo: number;
};

/** Koľko vstupeniek na termín ešte zostáva. `null` = kapacita nie je určená. */
async function volnaKapacita(
  eventDateId: string,
  totalTickets: number | null,
): Promise<number | null> {
  if (!totalTickets || totalTickets <= 0) return null;

  // Rovnaké počítanie ako pri kontrole kapacity: rezervované aj zaplatené
  // objednávky miesto držia, sedadlá z mapy sa rátajú zvlášť.
  const { data: polozky } = await supabaseAdmin
    .from("order_items")
    .select("quantity, orders!inner(event_date_id, status)")
    .eq("orders.event_date_id", eventDateId)
    .in("orders.status", ["pending", "awaiting_payment", "paid"])
    .is("seat_id", null);
  const obsadene = (polozky || []).reduce((s, r) => s + (r.quantity || 0), 0);
  return Math.max(0, totalTickets - obsadene);
}

export async function upovedomCakajucich(): Promise<VysledokCakacky> {
  const vysledok: VysledokCakacky = { terminov: 0, upovedomenych: 0, zlyhalo: 0 };

  const { data: cakajuci } = await supabaseAdmin
    .from("waitlist")
    .select("id, event_id, event_date_id, email, wanted")
    .is("notified_at", null)
    .limit(2000);
  if (!cakajuci || cakajuci.length === 0) return vysledok;

  // Zoskupíme podľa termínu, nech sa kapacita počíta raz.
  const podlaTerminu = new Map<string, typeof cakajuci>();
  for (const c of cakajuci) {
    if (!c.event_date_id) continue;
    const zoznam = podlaTerminu.get(c.event_date_id) ?? [];
    zoznam.push(c);
    podlaTerminu.set(c.event_date_id, zoznam);
  }

  for (const [dateId, ludia] of podlaTerminu) {
    try {
      const { data: termin } = await supabaseAdmin
        .from("event_dates")
        .select("id, event_id, event_date, event_time, status, total_tickets")
        .eq("id", dateId)
        .maybeSingle();
      // Zrušený alebo neexistujúci termín nikomu neponúkame.
      if (!termin || termin.status !== "on_sale") continue;
      if (termin.event_date < new Date().toISOString().slice(0, 10)) continue;

      const { data: event } = await supabaseAdmin
        .from("events")
        .select("id, title, venue, city, status, total_tickets")
        .eq("id", termin.event_id)
        .maybeSingle();
      if (!event || event.status !== "published") continue;

      const volne = await volnaKapacita(dateId, termin.total_tickets ?? event.total_tickets);
      if (volne === null || volne <= 0) continue;

      vysledok.terminov++;
      const rendered = await renderEmail("waitlist", {
        event_title: event.title,
        event_date: new Date(termin.event_date).toLocaleDateString("sk"),
        event_time: (termin.event_time || "").slice(0, 5),
        venue: event.venue,
        city: event.city,
        available: String(volne),
        event_url: `${siteUrl()}/events/${event.id}`,
      });

      // Píše sa všetkým čakajúcim, nie len prvým — miesto si zaistí ten, kto
      // kúpi. Držať ho niekomu bokom by znamenalo blokovať predaj.
      for (const c of ludia) {
        try {
          const sent = await sendMail({
            to: c.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          });
          await supabaseAdmin.from("email_logs").insert({
            recipient: c.email,
            subject: rendered.subject,
            provider: "resend",
            provider_message_id: sent.ok ? sent.id : null,
            status: sent.ok ? "ok" : "error",
            error_message: sent.ok ? null : sent.message,
          });
          if (sent.ok) {
            await supabaseAdmin
              .from("waitlist")
              .update({ notified_at: new Date().toISOString() })
              .eq("id", c.id);
            vysledok.upovedomenych++;
          } else {
            vysledok.zlyhalo++;
          }
        } catch (e) {
          vysledok.zlyhalo++;
          console.error("Upovedomenie z čakačky zlyhalo", c.email, errorMessage(e));
        }
      }
    } catch (e) {
      console.error("Čakačka pre termín zlyhala", dateId, errorMessage(e));
    }
  }

  return vysledok;
}
