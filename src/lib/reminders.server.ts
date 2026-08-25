// Pripomienka deň pred podujatím.
//
// Znižuje neúčasť aj otázky typu „kde mám vstupenku". Beží z cronu spolu
// s dopytovacím skenom.
//
// Idempotencia stojí na `orders.reminder_sent_at` — sken beží opakovane
// a bez toho by posielal ďalší e-mail pri každom behu.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { renderEmail } from "./email-templates.server";
import { sendMail } from "./mailer.server";
import { siteUrl } from "./site-url.server";
import { signOrderAccess } from "./order-access.server";
import { errorMessage } from "./error-message";

export type VysledokPripomienok = {
  /** Koľko objednávok spadalo do okna. */
  najdenych: number;
  odoslanych: number;
  preskocenych: number;
  zlyhalo: number;
};

/**
 * Pošle pripomienku na termíny, ktoré sú o `zaKolkoDni` dní.
 *
 * Zrušené termíny sa vynechajú — tým už odišlo oznámenie o zrušení a ďalší
 * e-mail „zajtra sa vidíme" by bol výsmech.
 */
export async function posliPripomienky(zaKolkoDni = 1): Promise<VysledokPripomienok> {
  const vysledok: VysledokPripomienok = {
    najdenych: 0,
    odoslanych: 0,
    preskocenych: 0,
    zlyhalo: 0,
  };

  const cielovyDen = new Date(Date.now() + zaKolkoDni * 86_400_000).toISOString().slice(0, 10);
  const { data: terminy } = await supabaseAdmin
    .from("event_dates")
    .select("id, event_id, event_date, event_time, status")
    .eq("event_date", cielovyDen)
    .eq("status", "on_sale");
  if (!terminy || terminy.length === 0) return vysledok;

  for (const termin of terminy) {
    const { data: event } = await supabaseAdmin
      .from("events")
      .select("title, venue, city, status")
      .eq("id", termin.event_id)
      .maybeSingle();
    if (!event || event.status === "cancelled") continue;

    const { data: objednavky } = await supabaseAdmin
      .from("orders")
      .select("id, customer_name, customer_email")
      .eq("event_date_id", termin.id)
      .eq("status", "paid")
      .is("reminder_sent_at", null)
      .limit(1000);

    for (const order of objednavky || []) {
      vysledok.najdenych++;
      if (!order.customer_email) {
        vysledok.preskocenych++;
        continue;
      }
      try {
        const { count } = await supabaseAdmin
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("order_id", order.id)
          .is("refunded_at", null);
        // Objednávka bez platných vstupeniek nemá čo pripomínať.
        if ((count ?? 0) === 0) {
          vysledok.preskocenych++;
          continue;
        }

        const rendered = await renderEmail("reminder", {
          customer_name: (order.customer_name || "").split(" ")[0] || "",
          event_title: event.title,
          event_date: new Date(termin.event_date).toLocaleDateString("sk"),
          event_time: (termin.event_time || "").slice(0, 5),
          venue: event.venue,
          city: event.city,
          ticket_count: String(count ?? 0),
          tickets_url: `${siteUrl()}/checkout/success/${order.id}?t=${signOrderAccess(order.id)}`,
        });

        const sent = await sendMail({
          to: order.customer_email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });

        await supabaseAdmin.from("email_logs").insert({
          order_id: order.id,
          recipient: order.customer_email,
          subject: rendered.subject,
          provider: "resend",
          provider_message_id: sent.ok ? sent.id : null,
          status: sent.ok ? "ok" : "error",
          error_message: sent.ok ? null : sent.message,
        });

        if (sent.ok) {
          // Značku dáme až po úspešnom odoslaní — nedoručená pripomienka sa
          // má skúsiť znovu pri ďalšom behu.
          await supabaseAdmin
            .from("orders")
            .update({ reminder_sent_at: new Date().toISOString() })
            .eq("id", order.id);
          vysledok.odoslanych++;
        } else {
          vysledok.zlyhalo++;
        }
      } catch (e) {
        vysledok.zlyhalo++;
        console.error("Pripomienka zlyhala pre objednávku", order.id, errorMessage(e));
      }
    }
  }

  return vysledok;
}
