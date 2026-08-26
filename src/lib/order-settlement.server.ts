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
import { fakturacnySystem } from "./invoicing/index.server";
import { firemneUdaje } from "./invoicing/types";
import { newSignedTicket } from "./qr-token.server";
import { sendTicketsEmail } from "./ticket-mail.server";
import { releaseCouponForOrder } from "./coupons.server";
import { errorMessage } from "./error-message";
import { objednavkySVstupenkou } from "./tickets-by-order.server";
import { sadzbaPodujatia } from "./dph.server";
import { siteUrl } from "./site-url.server";
import { signOrderAccess } from "./order-access.server";

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

async function vydajVstupenky(order: Objednavka): Promise<number> {
  const { data: items } = await supabaseAdmin
    .from("order_items")
    .select("*")
    .eq("order_id", order.id);
  const tickets = (items || []).flatMap((it) =>
    Array.from({ length: it.quantity || 1 }).map((_, i) => {
      const { id, token } = newSignedTicket();
      return {
        id,
        event_id: order.event_id,
        event_date_id: order.event_date_id,
        seat_id: it.seat_id ?? "",
        seat_label: it.label + ((it.quantity || 1) > 1 ? ` #${i + 1}` : ""),
        qr_code: token,
        qr_token: token,
      };
    }),
  );
  if (tickets.length === 0) return 0;

  // Kontrola aj zápis v jednej transakcii so zámkom na objednávke. Dva
  // súbežné volania tak nevydajú dvojnásobok — druhé dostane nulu.
  const { data: vydane, error } = await supabaseAdmin.rpc("issue_tickets", {
    p_order_id: order.id,
    p_tickets: tickets as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return vydane ?? 0;
}

async function vystavFakturu(order: Objednavka): Promise<void> {
  if (order.superfaktura_invoice_id) return;

  const system = await fakturacnySystem();
  if (!system) {
    // Bez nastaveného fakturačného systému sa nefakturuje. Nie je to dôvod
    // zhodiť doúčtovanie — peniaze sú prijaté a vstupenky vydané. Zapíšeme to
    // však, nech to nezmizne potichu.
    await supabaseAdmin.from("superfaktura_logs").insert({
      order_id: order.id,
      endpoint: "fakturacia",
      status: "error",
      error_message:
        "Nie je nastavený fakturačný systém — faktúra nebola vystavená. " +
        "Doplň prístupy v Systém → Platobné brány, sekcia Fakturácia.",
    });
    return;
  }

  try {
    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("*")
      .eq("order_id", order.id);
    // Sadzba sa nedá odvodiť z kódu — vstup na divadlo a šport má 5 %,
    // hudobný koncert základnú. Berie sa z podujatia, inak predvolená.
    const dph = await sadzbaPodujatia(order.event_id as string);
    const result = await system.vystav({
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

        company: firemneUdaje(order as Record<string, string | null>),
      },
      items: (items || []).map((it) => ({
        name: it.label,
        unit_price: Number(it.unit_price),
        quantity: it.quantity || 1,
        tax: dph,
      })),
      paymentType: "card",
    });

    await supabaseAdmin
      .from("orders")
      .update({
        invoice_provider: system.id,
        superfaktura_invoice_id: result.invoice_id,
        superfaktura_invoice_number: result.invoice_number,
        // Systém, ktorý vydáva len krátkodobo platné odkazy, vráti prázdnu
        // adresu — vtedy ukladáme odkaz na seba a čerstvú si vypýtame až pri
        // kliknutí.
        superfaktura_invoice_pdf_url: result.pdf_url || adresaNasehoPdf(order.id),
      })
      .eq("id", order.id);
    await supabaseAdmin.from("superfaktura_logs").insert({
      order_id: order.id,
      invoice_id: result.invoice_id,
      endpoint: `${system.id}:vystav`,
      response_payload: result.raw,
      status: "ok",
    });
  } catch (e) {
    await supabaseAdmin.from("superfaktura_logs").insert({
      order_id: order.id,
      endpoint: `${system.id}:vystav`,
      status: "error",
      error_message: errorMessage(e),
    });
    // Nepadáme — platba je úspešná, faktúru vie admin vystaviť znovu.
    console.error("Fakturácia zlyhala pre objednávku", order.id, e);
  }
}

/**
 * Trvalý odkaz na PDF cez nás. Podpísané adresy z Faktera platia päť minút,
 * takže sa nedajú uložiť ani poslať e-mailom — čerstvú si vypýtame až pri
 * kliknutí. Token je ten istý, ktorým sa chráni prístup k objednávke.
 */
export function adresaNasehoPdf(orderId: string): string {
  return `${siteUrl()}/api/public/invoices/${orderId}/pdf?t=${signOrderAccess(orderId)}`;
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
  opravene: { bezVstupeniek: number; vydanych: number };
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
  const opravene = await dopravZaplatene(maxAgeHours);
  return { checked: orders?.length ?? 0, results, opravene };
}

/**
 * Dorobí, čo zostalo nedokončené na už zaplatených objednávkach.
 *
 * Vstupenky, faktúru a e-mail vybavuje ten, kto objednávku preklopil na
 * zaplatenú. Keby proces medzi preklopením a vydaním spadol (reštart,
 * výpadok siete), objednávka by zostala zaplatená a bez vstupeniek — a nič
 * by ju už nezachránilo, lebo dopyt na stav sa pozerá len na `awaiting_payment`.
 *
 * Každý krok je idempotentný, takže opakovaný beh nič nezduplikuje.
 */
async function dopravZaplatene(maxAgeHours: number): Promise<{
  bezVstupeniek: number;
  vydanych: number;
}> {
  const od = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
  const { data: zaplatene } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("status", "paid")
    .gte("created_at", od)
    .limit(200);

  let bezVstupeniek = 0;
  let vydanych = 0;

  // Ktoré objednávky vstupenky majú, sa zistí hromadne — inak by sken pri
  // dvesto objednávkach spravil dvesto dotazov len na to, že je všetko v poriadku.
  const maju = await objednavkySVstupenkou((zaplatene || []).map((o) => o.id));

  for (const order of zaplatene || []) {
    try {
      if (maju.has(order.id)) continue;

      bezVstupeniek++;
      const pocet = await vydajVstupenky(order);
      vydanych += pocet;
      if (pocet === 0) continue;

      console.error(
        "Zaplatená objednávka bola bez vstupeniek, dorobené skenom:",
        order.id,
        `${pocet} ks`,
      );
      await supabaseAdmin.from("payment_logs").insert({
        order_id: order.id,
        provider: (order.payment_provider ?? "gopay") as GatewayId,
        endpoint: "dorobene_vstupenky",
        status: "ok",
        error_message: `Objednávka bola zaplatená bez vstupeniek; sken vydal ${pocet} ks.`,
      });

      await vystavFakturu(order);
      try {
        await sendTicketsEmail(order.id);
      } catch (e) {
        console.error("Odoslanie dorobených vstupeniek zlyhalo", order.id, e);
      }
    } catch (e) {
      console.error("Doprava zaplatenej objednávky zlyhala", order.id, errorMessage(e));
    }
  }

  return { bezVstupeniek, vydanych };
}
