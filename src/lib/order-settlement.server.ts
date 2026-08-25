// Doúčtovanie objednávky po platbe — nezávisle od toho, ktorá brána ju
// spracovala. Doteraz existovala táto logika dvakrát (v payments.functions.ts
// a v GoPay webhooku) a s pribudnutím GP webpay a tatrapay+ by ju bolo treba
// štyrikrát; preto je tu raz.
//
// Celý postup musí byť idempotentný: brána vie notifikáciu poslať viackrát,
// zákazník vie stránku návratu obnoviť a dopytovací sken beží dokola.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { branaPodlaId, pripravPristupy } from "./payment-gateways/index.server";
import type { GatewayId, PaymentState } from "./payment-gateways/types";
import { createPaidInvoice } from "./superfaktura.server";
import { newSignedTicket } from "./qr-token.server";
import { sendTicketsEmail } from "./ticket-mail.server";
import { releaseCouponForOrder } from "./coupons.server";
import { errorMessage } from "./error-message";

export type SettleResult = {
  changed: boolean;
  status: string;
  reason?: string;
};

/**
 * Ktorej platby sa doúčtovanie týka.
 *
 * Bez toho by sa platba pripísala tomu, na čo práve ukazuje
 * `orders.payment_ref` — a to nemusí byť tá istá platba, ktorá sa vrátila.
 * Zákazník totiž mohol medzitým skúsiť inú bránu.
 *
 * `state` sa vypĺňa iba vtedy, keď brána stav dopytovať nevie a výsledok
 * prišiel overeným návratom (GP webpay). Inak sa stav zistí dopytom.
 */
export type ZdrojStavu = {
  provider: GatewayId;
  ref: string;
  /** Vyplniť len pri stave, ktorého podpis už bol overený. */
  state?: PaymentState;
  raw?: Json;
};

/** @deprecated Ponechané pre staršie volania; použi ZdrojStavu. */
export type OverenyStav = ZdrojStavu;

/**
 * Zistí stav platby a dotiahne objednávku do zodpovedajúceho stavu.
 *
 * @param overeny Keď brána stav dopytovať nevie, dá sa jej výsledok podstrčiť —
 *   ale iba taký, ktorého podpis už bol overený. Nepodpísaný vstup sem nesmie.
 */
export async function settleOrder(orderId: string, zdroj?: ZdrojStavu): Promise<SettleResult> {
  await pripravPristupy();
  const { data: order } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).single();
  if (!order) throw new Error("Objednávka sa nenašla");

  // Brána a referencia platby, ktorej sa toto doúčtovanie týka. Pri overenom
  // návrate sú to údaje tej platby, ktorá sa vrátila — nie tie, čo má práve
  // objednávka. Zákazník totiž mohol medzitým založiť platbu inou bránou.
  const providerId =
    zdroj?.provider ??
    ((order.payment_provider || (order.gopay_payment_id ? "gopay" : null)) as GatewayId | null);
  const providerRef = zdroj?.ref ?? order.payment_ref ?? order.gopay_payment_id;
  if (!providerId || !providerRef) {
    return { changed: false, status: order.status, reason: "no_payment_id" };
  }

  let stav: { state: PaymentState; raw: Json } | undefined =
    zdroj?.state !== undefined ? { state: zdroj.state, raw: zdroj.raw ?? null } : undefined;
  if (!stav) {
    const brana = branaPodlaId(providerId);
    const zistene = await brana.getStatus(providerRef);
    if (!zistene) {
      // Brána sa dopytovať nedá a nikto nám overený stav nepodstrčil.
      return { changed: false, status: order.status, reason: "provider_has_no_status_api" };
    }
    stav = zistene;
  }

  await supabaseAdmin.from("payment_logs").insert({
    order_id: order.id,
    provider: providerId,
    endpoint: `status:${providerRef}`,
    request_payload: null,
    response_payload: stav.raw,
    status: "ok",
  });

  // Aktualizuje sa riadok tej platby, ktorá sa naozaj vrátila.
  const novyStavPlatby =
    stav.state === "paid"
      ? "paid"
      : stav.state === "cancelled"
        ? "cancelled"
        : stav.state === "failed"
          ? "failed"
          : stav.state === "refunded"
            ? "refunded"
            : "pending";

  let zapisPlatby = supabaseAdmin
    .from("payments")
    .update({ status: novyStavPlatby, raw_response: stav.raw })
    .eq("order_id", order.id)
    .eq("provider", providerId)
    .eq("provider_payment_id", String(providerRef));
  if (novyStavPlatby !== "paid" && novyStavPlatby !== "refunded") {
    // Prijatú platbu nesmie zhodiť neskorá alebo zopakovaná správa o zrušení.
    // Z „paid" sa smie ísť už len na „refunded".
    zapisPlatby = zapisPlatby.not("status", "eq", "paid");
  }
  await zapisPlatby;

  if (stav.state === "paid") {
    // Preklopenie na zaplatenú vyhrá práve jeden volajúci. Ostatní sa
    // vstupeniek, faktúry ani e-mailu nedotknú — inak by ich pri súbežných
    // návratoch z brány vzniklo toľko, koľko prišlo požiadaviek.
    const { data: vyhral, error: chybaClaim } = await supabaseAdmin.rpc("claim_order_paid", {
      p_order_id: order.id,
    });
    if (chybaClaim) throw new Error(chybaClaim.message);

    if (!vyhral) {
      // Objednávka už zaplatená bola. Ak to bola iná platba než táto, práve
      // sme prijali peniaze druhýkrát a treba ich vrátiť.
      const inaPlatba = String(order.payment_ref ?? "") !== String(providerRef);
      if (inaPlatba || order.status !== "paid") {
        await supabaseAdmin.from("payment_logs").insert({
          order_id: order.id,
          provider: providerId,
          endpoint: `duplicitna_platba:${providerRef}`,
          response_payload: stav.raw,
          status: "error",
          error_message:
            `Objednávka už bola zaplatená iným zámerom (${order.payment_provider ?? "?"} ` +
            `${order.payment_ref ?? "?"}). Túto platbu treba zákazníkovi vrátiť.`,
        });
        console.error("Duplicitná platba pre objednávku", order.id, providerId, providerRef);
      }
      return {
        changed: false,
        status: "paid",
        reason: inaPlatba ? "duplicitna_platba" : undefined,
      };
    }

    await supabaseAdmin
      .from("seat_inventory")
      .update({ status: "sold", reserved_until: null })
      .eq("order_id", order.id);

    await vydajVstupenky(order);
    await vystavFakturu(order);

    // Zlyhanie e-mailu nesmie zhodiť doúčtovanie — peniaze sú prijaté
    // a vstupenky vydané. Opakovanému odoslaniu bráni tickets_emailed_at.
    try {
      await sendTicketsEmail(order.id);
    } catch (e) {
      console.error("Odoslanie vstupeniek zlyhalo pre objednávku", order.id, e);
    }

    return { changed: true, status: "paid" };
  }

  if (stav.state === "cancelled" || stav.state === "failed") {
    // Zaplatenú objednávku už nič nezhodí. Bez tejto podmienky by neskoré
    // „vypršalo" z opusteného zámeru zrušilo objednávku, za ktorú už prišli
    // peniaze, a uvoľnilo predané sedadlá.
    const { data: zmenene } = await supabaseAdmin
      .from("orders")
      .update({ status: stav.state })
      .eq("id", order.id)
      .in("status", ["pending", "awaiting_payment"])
      .select("id");
    if (!zmenene || zmenene.length === 0) {
      return { changed: false, status: order.status, reason: "objednavka_uz_uzavreta" };
    }

    await supabaseAdmin
      .from("seat_inventory")
      .update({ status: "available", reserved_until: null, order_id: null })
      .eq("order_id", order.id);
    // Za nezaplatenú objednávku kupón neprepadá.
    await releaseCouponForOrder(order.id);
    return { changed: true, status: stav.state };
  }

  return { changed: false, status: order.status };
}

type Objednavka = { id: string; event_id: string; event_date_id: string } & Record<string, unknown>;

async function vydajVstupenky(order: Objednavka): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from("tickets")
    .select("id")
    .eq("order_id", order.id)
    .limit(1);
  if (existing && existing.length > 0) return;

  const { data: items } = await supabaseAdmin
    .from("order_items")
    .select("*")
    .eq("order_id", order.id);
  const tickets = (items || []).flatMap((it) =>
    Array.from({ length: it.quantity || 1 }).map((_, i) => {
      const { id, token } = newSignedTicket();
      return {
        id,
        order_id: order.id,
        event_id: order.event_id,
        event_date_id: order.event_date_id,
        seat_id: it.seat_id,
        seat_label: it.label + ((it.quantity || 1) > 1 ? ` #${i + 1}` : ""),
        qr_code: token,
        qr_token: token,
      };
    }),
  );
  if (tickets.length > 0) await supabaseAdmin.from("tickets").insert(tickets);
}

async function vystavFakturu(order: Objednavka): Promise<void> {
  if (order.superfaktura_invoice_id) return;
  try {
    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("*")
      .eq("order_id", order.id);
    const result = await createPaidInvoice({
      orderId: order.id,
      // Variabilný symbol je ten istý, aký šiel do banky — inak by sa platba
      // na výpise nedala spárovať s faktúrou.
      variableSymbol: order.payment_vs
        ? String(order.payment_vs)
        : order.id.slice(0, 8).toUpperCase(),
      customer: {
        name: (order.customer_name as string) || "Zákazník",
        email: (order.customer_email as string) || "",
        phone: (order.customer_phone as string) || undefined,
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
      response_payload: result.raw,
      status: "ok",
    });
  } catch (e) {
    await supabaseAdmin.from("superfaktura_logs").insert({
      order_id: order.id,
      endpoint: "/invoices/create",
      status: "error",
      error_message: errorMessage(e),
    });
    // Nepadáme — platba je úspešná, faktúru vie admin vystaviť znovu.
    console.error("SuperFaktúra zlyhala pre objednávku", order.id, e);
  }
}

/**
 * Dopýta sa brány na objednávky, ktoré zostali visieť v `awaiting_payment`.
 *
 * Ani GP webpay, ani tatrapay+ nemajú webhook — výsledok chodí len návratom
 * zákazníka. Kto po zaplatení zavrie prehliadač, ostal by bez vstupeniek.
 * Toto je záchranná sieť a patrí do cronu.
 */
export async function dopytajCakajuce(maxAgeHours: number): Promise<{
  checked: number;
  results: Array<{ order_id: string; status: string; changed: boolean }>;
}> {
  const od = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("status", "awaiting_payment")
    .not("payment_ref", "is", null)
    .gte("created_at", od)
    .limit(200);

  const results: Array<{ order_id: string; status: string; changed: boolean }> = [];
  for (const o of orders || []) {
    try {
      const r = await settleOrder(o.id);
      results.push({ order_id: o.id, status: r.status, changed: r.changed });
    } catch (e) {
      console.error("Dopyt stavu zlyhal pre objednávku", o.id, errorMessage(e));
    }
  }
  return { checked: orders?.length ?? 0, results };
}
