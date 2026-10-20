// Stripe ako platobná brána — Checkout Session s destination charge.
//
// AKO TEČÚ PENIAZE: zákazník platí nám (platforma je obchodník), Stripe
// z platby odvedie našu províziu (`application_fee_amount`) a zvyšok prevedie
// na Express účet organizátora (`transfer_data[destination]`). Zákazník má
// teda na výpise nás, čo sedí s obchodnými podmienkami — predaj
// „v mene a na účet usporiadateľa" — a organizátor dostane svoje bez toho,
// aby sme mu peniaze posielali ručne prevodom.
//
// PREČO BEZ SDK: `stripe` balík by pribral závislosť kvôli trom endpointom.
// Ostatné brány sú riešené rovnako — priamo cez `fetch`.
//
// POZOR: Stripe API berie `application/x-www-form-urlencoded`, nie JSON.
// Skladanie tela aj počítanie provízie žije v `stripe-telo.ts` a je pokryté
// testami, lebo sú to peniaze.
import type { Json } from "@/integrations/supabase/types";
import { hodnota, polozka } from "../pristupy.server";
import { centy, naFormBody, postavRefund, postavSession, provizia, type Telo } from "./stripe-telo";
import type {
  GatewayStatus,
  PaymentGateway,
  PaymentState,
  PolozkaKonfiguracie,
  StartPaymentInput,
  StartPaymentResult,
  TestBrany,
} from "./types";

const API = "https://api.stripe.com";

function tajnyKluc(): string | undefined {
  return hodnota("stripe", "STRIPE_SECRET_KEY");
}

export function podpisoveTajomstvo(): string | undefined {
  return hodnota("stripe", "STRIPE_WEBHOOK_SECRET");
}

function jeNakonfigurovany(): boolean {
  return Boolean(tajnyKluc());
}

/** Testovacia prevádzka sa u Stripe pozná z kľúča, nie z adresy. */
function rezimKluca(): "test" | "ostrá" | "neznáma" {
  const k = tajnyKluc() ?? "";
  if (k.startsWith("sk_test_") || k.startsWith("rk_test_")) return "test";
  if (k.startsWith("sk_live_") || k.startsWith("rk_live_")) return "ostrá";
  return "neznáma";
}

export type StripeOdpoved = { status: number; data: Record<string, unknown>; text: string };

/**
 * Jedno volanie Stripe API.
 *
 * `idempotency` posielame pri každom zápise: Stripe podľa nej druhé rovnaké
 * volanie nevykoná znova, len vráti pôvodný výsledok. Bez toho by opakovaná
 * notifikácia alebo obnovenie stránky vedeli vyrobiť druhú platbu či druhý
 * refund.
 */
export async function volajStripe(
  cesta: string,
  moznosti?: { telo?: Telo; idempotency?: string; metoda?: "GET" | "POST" },
): Promise<StripeOdpoved> {
  const kluc = tajnyKluc();
  if (!kluc) throw new Error("Stripe nie je nastavený — chýba STRIPE_SECRET_KEY.");

  const metoda = moznosti?.metoda ?? (moznosti?.telo ? "POST" : "GET");
  const hlavicky: Record<string, string> = {
    Authorization: `Bearer ${kluc}`,
    // Verziu API pripíname zámerne: bez nej by Stripe po svojej aktualizácii
    // začal posielať iné polia a prestalo by to fungovať bez nášho zásahu.
    "Stripe-Version": "2024-06-20",
  };
  if (moznosti?.telo) hlavicky["Content-Type"] = "application/x-www-form-urlencoded";
  if (moznosti?.idempotency) hlavicky["Idempotency-Key"] = moznosti.idempotency;

  const r = await fetch(`${API}${cesta}`, {
    method: metoda,
    headers: hlavicky,
    body: moznosti?.telo ? naFormBody(moznosti.telo) : undefined,
  });
  const text = await r.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* Stripe vracia JSON vždy; keby nie, nech zostane text na chybovú hlášku */
  }
  return { status: r.status, data, text };
}

/** Z odpovede Stripe vytiahne hlášku, ktorá sa dá zobraziť a zalogovať. */
export function chybaStripe(o: StripeOdpoved): string {
  const e = (o.data?.error ?? {}) as Record<string, unknown>;
  const sprava = typeof e.message === "string" ? e.message : o.text.slice(0, 200);
  const kod = typeof e.code === "string" ? ` (${e.code})` : "";
  return `Stripe ${o.status}: ${sprava}${kod}`;
}

/** Stav platby podľa Stripe → náš stav. */
export function stavZSession(session: Record<string, unknown>): PaymentState {
  const platba = String(session.payment_status ?? "");
  const stav = String(session.status ?? "");
  if (platba === "paid" || platba === "no_payment_required") return "paid";
  if (stav === "expired") return "cancelled";
  return "pending";
}

export const stripeGateway: PaymentGateway = {
  id: "stripe",
  label: "Platba kartou (Stripe)",
  hint: "Visa, Mastercard, Apple Pay a Google Pay. Peniaze idú priamo organizátorovi.",
  isConfigured: jeNakonfigurovany,

  async start(input: StartPaymentInput): Promise<StartPaymentResult> {
    // Bez účtu organizátora sa platba nezaloží. Je to vedomé: inak by peniaze
    // skončili na našom účte bez toho, aby bolo kam ich previesť, a museli by
    // sa rozposielať ručne.
    const { ucetOrganizatora, sadzbaProvizie } = await ucetPreObjednavku(input.orderId);

    const celkomCentov = centy(input.amount);
    const telo = postavSession({
      orderId: input.orderId,
      nazovPodujatia: input.description,
      polozky: input.items,
      celkom: input.amount,
      mena: input.currency,
      email: input.customer.email ?? null,
      returnUrl: input.returnUrl,
      // Zrušenú platbu vedieme na tú istú stránku — tá si stav dopýta sama.
      zrusenaUrl: input.returnUrl,
      jazyk: input.lang,
      ucetOrganizatora,
      provizaCentov: provizia(celkomCentov, sadzbaProvizie),
      referencia: input.reference,
    });

    const o = await volajStripe("/v1/checkout/sessions", {
      telo,
      // Jedna objednávka = jedna session. Druhý pokus vráti tú istú.
      idempotency: `session:${input.orderId}`,
    });
    if (o.status >= 300) throw new Error(chybaStripe(o));

    const url = typeof o.data.url === "string" ? o.data.url : "";
    const id = typeof o.data.id === "string" ? o.data.id : "";
    if (!url || !id) throw new Error("Stripe nevrátil adresu platby.");

    // Audit provízie k objednávke: po roku sa tak dá doložiť, koľko si
    // platforma vzala a komu išiel zvyšok, bez dopytovania Stripe API.
    // Zlyhanie zápisu platbu nezastaví — to by bola horšia škoda než chýbajúci
    // záznam (a kým nie je prehraná migrácia, tie stĺpce ešte neexistujú).
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("orders")
        .update({
          application_fee_cents: provizia(celkomCentov, sadzbaProvizie),
          transfer_destination: ucetOrganizatora,
        })
        .eq("id", input.orderId);
    } catch (e) {
      console.error("Stripe: províziu sa nepodarilo zapísať k objednávke", input.orderId, e);
    }

    return {
      providerRef: id,
      redirectUrl: url,
      raw: o.data as Json,
    };
  },

  async getStatus(providerRef: string): Promise<GatewayStatus | null> {
    // `providerRef` je id session. Platbu (`pi_…`) z nej vyčítame až tu, lebo
    // pri zakladaní ešte neexistuje.
    const o = await volajStripe(`/v1/checkout/sessions/${encodeURIComponent(providerRef)}`);
    if (o.status >= 300) throw new Error(chybaStripe(o));
    return { state: stavZSession(o.data), raw: o.data as Json };
  },

  supportsRefund: true,

  async refund(providerRef: string, amount: number): Promise<{ raw: Json }> {
    // Refundovať sa dá platba, nie session — tak si ju dohľadáme.
    const platba = await platbaZSession(providerRef);
    const o = await volajStripe("/v1/refunds", {
      telo: postavRefund(platba, amount > 0 ? centy(amount) : null),
      // Druhé volanie toho istého refundu nevráti peniaze dvakrát.
      idempotency: `refund:${platba}:${centy(amount)}`,
    });
    if (o.status >= 300) throw new Error(chybaStripe(o));
    return { raw: o.data as Json };
  },

  async zrus(providerRef: string): Promise<boolean> {
    const o = await volajStripe(`/v1/checkout/sessions/${encodeURIComponent(providerRef)}/expire`, {
      telo: {},
      idempotency: `expire:${providerRef}`,
    });
    // Už zaplatenú alebo vypršanú session zrušiť nemožno — to nie je chyba.
    return o.status < 300;
  },

  konfiguracia(): PolozkaKonfiguracie[] {
    return [
      polozka("stripe", {
        premenna: "STRIPE_SECRET_KEY",
        nazov: "Tajný kľúč",
        popis: "Z dashboard.stripe.com → Developers → API keys. Ostrý začína sk_live_",
        povinna: true,
        tajna: true,
      }),
      polozka("stripe", {
        premenna: "STRIPE_WEBHOOK_SECRET",
        nazov: "Podpisové tajomstvo webhooku",
        popis:
          "Z Developers → Webhooks po pridaní adresy /api/public/payments/stripe/webhook. Začína whsec_",
        povinna: true,
        tajna: true,
      }),
    ];
  },

  endpoint(): string {
    return API;
  },

  rezim(): "test" | "ostrá" | "neznáma" {
    return rezimKluca();
  },

  async test(): Promise<TestBrany> {
    try {
      const o = await volajStripe("/v1/balance");
      if (o.status >= 300) return { ok: false, detail: chybaStripe(o) };
      const r = rezimKluca();
      const podpis = podpisoveTajomstvo()
        ? ""
        : " Pozor: chýba podpisové tajomstvo webhooku, bez neho sa vstupenky po platbe nevydajú.";
      return {
        ok: true,
        detail: `Kľúč platí, prevádzka je ${r}.${podpis}`,
      };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "Spojenie zlyhalo" };
    }
  },
};

// --- pomocné -----------------------------------------------------------------

/** Z id session vytiahne id platby (`pi_…`). */
export async function platbaZSession(session: string): Promise<string> {
  const o = await volajStripe(`/v1/checkout/sessions/${encodeURIComponent(session)}`);
  if (o.status >= 300) throw new Error(chybaStripe(o));
  const pi = o.data.payment_intent;
  if (typeof pi === "string" && pi) return pi;
  if (pi && typeof pi === "object" && typeof (pi as { id?: string }).id === "string") {
    return (pi as { id: string }).id;
  }
  throw new Error("K tejto platbe Stripe nevrátil payment_intent — refund sa nedá spraviť.");
}

/**
 * Účet organizátora a jeho sadzba provízie pre danú objednávku.
 *
 * Je to tu a nie v `start()` preto, aby bolo na jednom mieste vidieť, čo
 * všetko musí platiť, než sa dá platiť kartou: organizátor musí mať Express
 * účet a Stripe mu musí mať povolené prijímať platby.
 */
async function ucetPreObjednavku(
  orderId: string,
): Promise<{ ucetOrganizatora: string; sadzbaProvizie: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: objednavka } = await supabaseAdmin
    .from("orders")
    .select("id, event_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!objednavka?.event_id) throw new Error("Objednávka alebo jej podujatie sa nenašli.");

  const { data: podujatie } = await supabaseAdmin
    .from("events")
    .select("organizer_id")
    .eq("id", objednavka.event_id)
    .maybeSingle();
  if (!podujatie?.organizer_id) throw new Error("Podujatie nemá organizátora.");

  const { data: profil } = await supabaseAdmin
    .from("profiles")
    .select("stripe_account_id, stripe_charges_enabled, commission_rate, display_name")
    .eq("id", podujatie.organizer_id)
    .maybeSingle();

  if (!profil?.stripe_account_id) {
    throw new Error(
      "Organizátor nemá dokončenú registráciu u Stripe, takže kartou sa teraz zaplatiť nedá.",
    );
  }
  if (!profil.stripe_charges_enabled) {
    throw new Error(
      "Stripe organizátorovi ešte nepovolil prijímať platby — treba dokončiť overenie účtu.",
    );
  }

  const { data: nastavenia } = await supabaseAdmin
    .from("platform_settings")
    .select("default_commission_rate")
    .maybeSingle();

  const sadzba =
    profil.commission_rate === null || profil.commission_rate === undefined
      ? Number(nastavenia?.default_commission_rate ?? 10)
      : Number(profil.commission_rate);

  return { ucetOrganizatora: profil.stripe_account_id, sadzbaProvizie: sadzba };
}
