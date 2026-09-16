// Platba prevodom na účet — nastavenie, lehoty a e-maily.
//
// Objednávka na prevod nie je zvláštny druh objednávky, len iná splatnosť:
// dostane variabilný symbol, `expires_at` niekoľko pracovných dní dopredu
// a e-mail s platobnými údajmi. Dokončí ju až spárovanie bankového výpisu.
//
// Zrušenie po lehote nepíšeme znova — robí to `expire_stale_orders()`, ktorá
// už uvoľní sedadlá aj vráti kupón. Tu je len pripomienka a oznámenia.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { renderEmail } from "./email-templates.server";
import { sendMail } from "./mailer.server";
import { errorMessage } from "./error-message";
import { loadEventInfo } from "./event-info.server";
import { siteUrl } from "./site-url.server";

export type NastaveniePrevodu = {
  enabled: boolean;
  dniDoPripomienky: number;
  dniDoZrusenia: number;
  povolenePriSedadlach: boolean;
  iban: string | null;
  majitel: string | null;
  banka: string | null;
};

/**
 * Nastavenie kanála. Bez vyplneného IBAN-u je prevod vypnutý aj keď je
 * zapnutý prepínač — zákazníkovi nemá kam poslať peniaze a objednávka by
 * len držala sedadlá.
 */
export async function nastaveniePrevodu(): Promise<NastaveniePrevodu> {
  const { data } = await supabaseAdmin
    .from("platform_settings")
    // Jeden reťazcový literál, nie zložený výraz — inak PostgREST typy
    // nevedia odvodiť stĺpce a výsledok sa tvári ako chyba.
    .select(
      "transfer_enabled, transfer_days_to_reminder, transfer_days_to_cancel, transfer_seated_allowed, transfer_iban, transfer_holder, transfer_bank_name",
    )
    .eq("id", true)
    .maybeSingle();

  const iban = data?.transfer_iban?.trim() || null;
  return {
    enabled: Boolean(data?.transfer_enabled) && !!iban,
    dniDoPripomienky: data?.transfer_days_to_reminder ?? 2,
    dniDoZrusenia: data?.transfer_days_to_cancel ?? 2,
    povolenePriSedadlach: Boolean(data?.transfer_seated_allowed),
    iban,
    majitel: data?.transfer_holder?.trim() || null,
    banka: data?.transfer_bank_name?.trim() || null,
  };
}

/**
 * Dokedy má prevod doraziť.
 *
 * Počíta sa v pracovných dňoch so slovenskými sviatkami — cez Veľkú noc alebo
 * v novoročnom týždni by sa objednávka zrušila skôr, než mal zákazník šancu
 * zaplatiť, lebo banka medzitým nepracovala.
 */
export async function lehotaPrevodu(n: NastaveniePrevodu): Promise<string> {
  const dni = n.dniDoPripomienky + n.dniDoZrusenia;
  const { data, error } = await supabaseAdmin.rpc("add_business_days", {
    p_from: new Date().toISOString(),
    p_days: dni,
  });
  if (error || !data) {
    // Keby funkcia zlyhala, radšej štedrejšia lehota v kalendárnych dňoch než
    // objednávka, ktorá vyprší o pätnásť minút ako pri platbe kartou.
    console.error("add_business_days zlyhalo, používam kalendárne dni", error?.message);
    return new Date(Date.now() + (dni + 2) * 86_400_000).toISOString();
  }
  return String(data);
}

/** Odošle šablónu a zapíše výsledok do `email_logs`, ako všetky ostatné e-maily. */
async function posli(
  orderId: string,
  prijemca: string,
  kluc: "transfer_instructions" | "transfer_reminder" | "transfer_cancel",
  vars: Record<string, string>,
): Promise<boolean> {
  const email = await renderEmail(kluc, vars);
  const sent = await sendMail({
    to: prijemca,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  await supabaseAdmin.from("email_logs").insert({
    order_id: orderId,
    recipient: prijemca,
    subject: email.subject,
    provider: "resend",
    provider_message_id: sent.ok ? sent.id : null,
    status: sent.ok ? "ok" : "error",
    error_message: sent.ok ? null : sent.message,
  });
  return sent.ok;
}

type UdajePreEmail = {
  order: Record<string, unknown>;
  n: NastaveniePrevodu;
};

async function premenne({ order, n }: UdajePreEmail): Promise<Record<string, string>> {
  const info = await loadEventInfo(
    String(order.event_id),
    order.event_date_id ? String(order.event_date_id) : undefined,
  );
  const meno = String(order.customer_name || "").split(" ")[0] || "";
  const vs = order.payment_vs ? String(order.payment_vs).padStart(10, "0") : "";
  return {
    customer_name: meno,
    order_short: String(order.id).slice(0, 8).toUpperCase(),
    event_title: info?.title ?? "",
    event_date: info?.event_date ?? "",
    event_time: info?.event_time ?? "",
    venue: info?.venue ?? "",
    city: info?.city ?? "",
    total: Number(order.total_amount || 0).toFixed(2),
    currency: String(order.currency || "EUR"),
    iban: n.iban ?? "",
    holder: n.majitel ?? "",
    bank_name: n.banka ?? "",
    variable_symbol: vs,
    due_date: order.transfer_due_at
      ? new Date(String(order.transfer_due_at)).toLocaleDateString("sk-SK")
      : "",
    order_url: `${siteUrl()}/account`,
  };
}

/** E-mail s platobnými údajmi hneď po objednaní. */
export async function posliPlatobneUdaje(orderId: string): Promise<boolean> {
  const { data: order } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).single();
  if (!order?.customer_email) return false;
  const n = await nastaveniePrevodu();
  const vars = await premenne({ order, n });

  try {
    return await posli(orderId, String(order.customer_email), "transfer_instructions", vars);
  } catch (e) {
    // Zlyhanie e-mailu nesmie zhodiť objednávku — zákazník platobné údaje
    // uvidí aj na stránke po objednaní a support ich vie poslať znova.
    console.error("Platobné údaje sa nepodarilo odoslať", orderId, errorMessage(e));
    return false;
  }
}

export type VysledokLehot = {
  pripomenutych: number;
  zrusenych: number;
  chyb: number;
};

/**
 * Pripomienky a zrušenia nezaplatených prevodov.
 *
 * Púšťa sa raz denne o 15:00 v pracovný deň. Poradie je dôležité: zrušenie sa
 * zapíše **až po** úspešnom odoslaní e-mailu, inak by zákazník prišiel
 * o miesta bez jediného slova — presne to robil starý systém pri výpadku
 * pošty.
 */
export async function vybavLehotyPrevodov(): Promise<VysledokLehot> {
  const v: VysledokLehot = { pripomenutych: 0, zrusenych: 0, chyb: 0 };
  const n = await nastaveniePrevodu();

  // --- Pripomienky ---
  const { data: hranica } = await supabaseAdmin.rpc("add_business_days", {
    p_from: new Date().toISOString(),
    p_days: n.dniDoZrusenia,
  });

  const { data: naPripomenutie } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("payment_method", "transfer")
    .eq("status", "awaiting_payment")
    .is("transfer_reminder_sent_at", null)
    // Pripomína sa, keď do konca lehoty zostáva už len čas na zrušenie.
    .lte("expires_at", hranica ? String(hranica) : new Date().toISOString())
    .gt("expires_at", new Date().toISOString())
    .limit(200);

  for (const order of naPripomenutie || []) {
    try {
      const vars = await premenne({ order, n });
      const odoslane = await posli(
        order.id,
        String(order.customer_email),
        "transfer_reminder",
        vars,
      );
      if (!odoslane) {
        v.chyb++;
        continue;
      }
      // Značka až po odoslaní — nedoručená pripomienka sa má skúsiť znova.
      await supabaseAdmin
        .from("orders")
        .update({ transfer_reminder_sent_at: new Date().toISOString() })
        .eq("id", order.id);
      v.pripomenutych++;
    } catch (e) {
      v.chyb++;
      console.error("Pripomienka prevodu zlyhala", order.id, errorMessage(e));
    }
  }

  // --- Oznámenie o zrušení ---
  // Objednávku samotnú zruší `expire_stale_orders()`; tu sa len napíše tým,
  // ktorým lehota práve uplynula, nech sa to nedozvedia až pri dverách.
  const { data: zrusene } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("payment_method", "transfer")
    .eq("status", "expired")
    .not("transfer_due_at", "is", null)
    .is("tickets_emailed_at", null)
    .gte("expires_at", new Date(Date.now() - 3 * 86_400_000).toISOString())
    .limit(200);

  for (const order of zrusene || []) {
    try {
      const vars = await premenne({ order, n });
      const odoslane = await posli(order.id, String(order.customer_email), "transfer_cancel", vars);
      if (!odoslane) {
        v.chyb++;
        continue;
      }
      // `transfer_due_at` sa vynuluje, aby oznámenie neodišlo druhýkrát —
      // vlastnú značku na to nezakladáme, lehota je po zrušení bezpredmetná.
      await supabaseAdmin.from("orders").update({ transfer_due_at: null }).eq("id", order.id);
      v.zrusenych++;
    } catch (e) {
      v.chyb++;
      console.error("Oznámenie o zrušení prevodu zlyhalo", order.id, errorMessage(e));
    }
  }

  return v;
}
