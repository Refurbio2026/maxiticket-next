// Zrušenie podujatia alebo jedného termínu.
//
// Keď kapela odriekne koncert, treba vrátiť peniaze všetkým, zneplatniť
// vstupenky, uvoľniť sedadlá a ľuďom to povedať. Ručne, objednávku po
// objednávke, to pri dvesto predaných lístkoch znamená večer práce a istotu,
// že sa na niekoho zabudne.
//
// Celé je to idempotentné: refund už vrátenej objednávky sa preskočí, takže
// opakované spustenie po výpadku dorobí len zvyšok.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { vratPeniaze } from "./refunds.server";
import { errorMessage } from "./error-message";
import { renderEmail } from "./email-templates.server";
import { sendMail } from "./mailer.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

export type ZruseniePodujatiaVysledok = {
  /** Koľko zaplatených objednávok sa zrušenia týkalo. */
  objednavok: number;
  vratenych: number;
  vratenaSuma: number;
  /** Objednávky, pri ktorých refund neprešiel — treba ich dobiť ručne. */
  zlyhalo: Array<{ order_id: string; dovod: string }>;
  /** Brány, ktoré peniaze cez API nevracajú; suma tam čaká na ručné vrátenie. */
  rucne: Array<{ order_id: string; poznamka: string }>;
  upovedomenych: number;
};

/**
 * Náhľad pred zrušením — koľko ľudí a peňazí sa to týka. Nič nemení.
 */
export const previewEventCancellation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        event_id: z.string().uuid(),
        /** Bez neho sa ruší celé podujatie so všetkými termínmi. */
        event_date_id: z.string().uuid().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const objednavky = await zaplateneObjednavky(data.event_id, data.event_date_id);
    return {
      objednavok: objednavky.length,
      suma: Number(
        objednavky
          .reduce((s, o) => s + (Number(o.total_amount) - Number(o.refunded_amount || 0)), 0)
          .toFixed(2),
      ),
      vstupeniek: objednavky.reduce((s, o) => s + (o.pocet_vstupeniek ?? 0), 0),
      emailov: objednavky.filter((o) => !!o.customer_email).length,
    };
  });

export const cancelEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        event_id: z.string().uuid(),
        event_date_id: z.string().uuid().optional().nullable(),
        /** Ide zákazníkovi do e-mailu, takže je to text pre neho. */
        reason: z.string().min(1).max(500),
        refund: z.boolean().default(true),
        notify: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ZruseniePodujatiaVysledok> => {
    await assertAdmin(context.userId);

    const objednavky = await zaplateneObjednavky(data.event_id, data.event_date_id);
    const vysledok: ZruseniePodujatiaVysledok = {
      objednavok: objednavky.length,
      vratenych: 0,
      vratenaSuma: 0,
      zlyhalo: [],
      rucne: [],
      upovedomenych: 0,
    };

    // 1) Najprv zavrieť predaj, až potom vracať peniaze. Opačné poradie by
    //    dovolilo kúpiť lístok na podujatie, ktoré sa práve ruší.
    const teraz = new Date().toISOString();
    if (data.event_date_id) {
      await supabaseAdmin
        .from("event_dates")
        .update({ status: "cancelled", cancelled_at: teraz, cancel_reason: data.reason })
        .eq("id", data.event_date_id);
    } else {
      await supabaseAdmin
        .from("events")
        .update({
          status: "cancelled",
          cancelled_at: teraz,
          cancel_reason: data.reason,
          cancelled_by: context.userId,
        })
        .eq("id", data.event_id);
      await supabaseAdmin
        .from("event_dates")
        .update({ status: "cancelled", cancelled_at: teraz, cancel_reason: data.reason })
        .eq("event_id", data.event_id)
        .is("cancelled_at", null);
    }

    // 2) Rezervácie, ktoré ešte nikto nedoplatil, netreba vracať — stačí ich
    //    zavrieť, nech neblokujú sedadlá.
    let rozrobeneQ = supabaseAdmin
      .from("orders")
      .select("id")
      .eq("event_id", data.event_id)
      .in("status", ["pending", "awaiting_payment"]);
    if (data.event_date_id) rozrobeneQ = rozrobeneQ.eq("event_date_id", data.event_date_id);
    const { data: rozrobene } = await rozrobeneQ;
    for (const o of rozrobene || []) {
      await supabaseAdmin.from("orders").update({ status: "cancelled" }).eq("id", o.id);
      await supabaseAdmin
        .from("seat_inventory")
        .update({ status: "available", order_id: null, reserved_until: null })
        .eq("order_id", o.id);
    }

    // 3) Peniaze a oznámenie. Zlyhanie jednej objednávky nesmie zastaviť
    //    zvyšok — inak by sa prvý problém premietol do stoviek nevrátených platieb.
    //
    //    Oznámenie zámerne nevisí na refunde. Keď sa peniaze vracajú mimo
    //    systému alebo refund neprejde, človek sa aj tak musí dozvedieť, že
    //    podujatie nebude — inak príde k dverám s platnou vstupenkou.
    const popisTerminu = await popisPodujatia(data.event_id, data.event_date_id);
    for (const o of objednavky) {
      let poznamkaOPeniazoch = "O vrátení peňazí sa vám ozveme.";

      if (data.refund) {
        try {
          const r = await vratPeniaze({
            order_id: o.id,
            reason: `Zrušené podujatie: ${data.reason}`,
            // Zákazníkovi píšeme sami, nižšie — jedným e-mailom, ktorý povie
            // aj to, že sa podujatie ruší. Dva e-maily naraz sú mätúce.
            notifyCustomer: false,
            userId: context.userId,
          });
          vysledok.vratenych++;
          vysledok.vratenaSuma += r.refunded_amount;
          if (r.manual_action_required) {
            vysledok.rucne.push({ order_id: o.id, poznamka: r.manual_action_required });
          } else {
            poznamkaOPeniazoch =
              `Sumu ${r.refunded_amount.toFixed(2)} ${o.currency || "EUR"} posielame späť ` +
              "na účet, z ktorého ste platili. Pripísanie trvá zvyčajne pár pracovných dní.";
          }
        } catch (e) {
          const dovod = errorMessage(e);
          vysledok.zlyhalo.push({ order_id: o.id, dovod });
          console.error("Refund pri zrušení podujatia zlyhal", o.id, dovod);
          await supabaseAdmin.from("payment_logs").insert({
            order_id: o.id,
            provider: (o.payment_provider ?? "gopay") as "gopay" | "gpwebpay" | "tatrapayplus",
            endpoint: "zrusenie_podujatia",
            status: "error",
            error_message: dovod,
          });
        }
      }

      if (
        data.notify &&
        (await posliOznamZrusenia(o, popisTerminu, data.reason, poznamkaOPeniazoch))
      ) {
        vysledok.upovedomenych++;
      }
    }

    vysledok.vratenaSuma = Number(vysledok.vratenaSuma.toFixed(2));
    return vysledok;
  });

type ObjednavkaNaZrusenie = {
  id: string;
  total_amount: number;
  refunded_amount: number | null;
  customer_name: string | null;
  customer_email: string | null;
  currency: string | null;
  payment_provider: string | null;
  pocet_vstupeniek: number;
};

/** Zaplatené objednávky, ktorých sa zrušenie týka. Už vrátené sa vynechajú. */
async function zaplateneObjednavky(
  eventId: string,
  eventDateId?: string | null,
): Promise<ObjednavkaNaZrusenie[]> {
  let q = supabaseAdmin
    .from("orders")
    .select(
      "id, total_amount, refunded_amount, customer_name, customer_email, currency, payment_provider, tickets(count)",
    )
    .eq("event_id", eventId)
    .eq("status", "paid");
  if (eventDateId) q = q.eq("event_date_id", eventDateId);

  const { data, error } = await q.limit(2000);
  if (error) throw new Error(error.message);

  return (data || []).map((o) => ({
    id: o.id,
    total_amount: Number(o.total_amount),
    refunded_amount: o.refunded_amount === null ? null : Number(o.refunded_amount),
    customer_name: o.customer_name,
    customer_email: o.customer_email,
    currency: o.currency,
    payment_provider: o.payment_provider,
    pocet_vstupeniek: (o.tickets as unknown as Array<{ count: number }>)?.[0]?.count ?? 0,
  }));
}

type PopisPodujatia = { title: string; datum: string };

/** Názov a dátum do e-mailu. Pri zrušení jedného termínu ide dátum z termínu. */
async function popisPodujatia(
  eventId: string,
  eventDateId?: string | null,
): Promise<PopisPodujatia> {
  const { data: event } = await supabaseAdmin
    .from("events")
    .select("title, event_date")
    .eq("id", eventId)
    .maybeSingle();

  let datum = event?.event_date ?? null;
  if (eventDateId) {
    const { data: termin } = await supabaseAdmin
      .from("event_dates")
      .select("event_date")
      .eq("id", eventDateId)
      .maybeSingle();
    if (termin?.event_date) datum = termin.event_date;
  }

  return {
    title: event?.title || "Podujatie",
    datum: datum ? new Date(datum).toLocaleDateString("sk") : "",
  };
}

/**
 * Oznámi zákazníkovi zrušenie. Vracia `true`, len keď e-mail naozaj odišiel —
 * počítadlo v prehľade nesmie tvrdiť, že sme upovedomili niekoho, komu
 * odosielanie zlyhalo.
 */
async function posliOznamZrusenia(
  o: ObjednavkaNaZrusenie,
  popis: PopisPodujatia,
  dovod: string,
  poznamkaOPeniazoch: string,
): Promise<boolean> {
  if (!o.customer_email) return false;
  try {
    const rendered = await renderEmail("cancel", {
      customer_name: (o.customer_name || "").split(" ")[0] || "",
      event_title: popis.title,
      event_date: popis.datum,
      reason: dovod,
      order_short: o.id.slice(0, 8).toUpperCase(),
      refund_note: poznamkaOPeniazoch,
    });
    const sent = await sendMail({
      to: o.customer_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    await supabaseAdmin.from("email_logs").insert({
      order_id: o.id,
      recipient: o.customer_email,
      subject: rendered.subject,
      provider: "resend",
      provider_message_id: sent.ok ? sent.id : null,
      status: sent.ok ? "ok" : "error",
      error_message: sent.ok ? null : sent.message,
    });
    return sent.ok;
  } catch (e) {
    console.error("Oznam o zrušení zlyhal", o.id, errorMessage(e));
    return false;
  }
}
