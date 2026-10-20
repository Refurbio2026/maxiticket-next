// Stripe: skladanie tiel požiadaviek a počítanie provízie.
//
// Čisté funkcie, žiadna sieť ani databáza — práve preto, že sa tu počítajú
// peniaze a chcem to mať pokryté testami.
//
// POZOR NA FORMÁT: Stripe API neberie JSON, ale `application/x-www-form-
// urlencoded` so zátvorkovou notáciou (`line_items[0][price_data][currency]`).
// Preto je tu `naFormBody` a nie `JSON.stringify`.

/** Eurá na centy. Stripe pracuje v najmenšej jednotke a zlomok centu neexistuje. */
export function centy(eur: number): number {
  if (!Number.isFinite(eur)) throw new Error("Suma nie je číslo");
  if (eur < 0) throw new Error("Suma nemôže byť negatívna");
  // Násobenie 100 nad desatinným číslom vie dať 1234.9999999; preto zaokrúhliť.
  return Math.round(eur * 100);
}

/**
 * Provízia platformy v centoch.
 *
 * `sadzba` je percento 0–100, tak ako ho drží `profiles.commission_rate`
 * a `platform_settings.default_commission_rate`. Výsledok sa zastropuje
 * celkovou sumou: províziu vyššiu než platba by Stripe odmietol a bola by to
 * aj tak chyba v nastavení.
 */
export function provizia(celkomCentov: number, sadzba: number | null | undefined): number {
  if (celkomCentov <= 0) return 0;
  const s = Number(sadzba ?? 0);
  if (!Number.isFinite(s) || s <= 0) return 0;
  const vypocet = Math.round((celkomCentov * Math.min(s, 100)) / 100);
  return Math.max(0, Math.min(vypocet, celkomCentov));
}

type Hodnota = string | number | boolean | null | undefined | Telo | Hodnota[];
export type Telo = { [kluc: string]: Hodnota };

/**
 * Zloží telo pre Stripe. Vnorené objekty a polia sa prevedú na zátvorkovú
 * notáciu; `null` a `undefined` sa vynechajú, nech sa neposielajú prázdne
 * polia, ktoré by Stripe odmietol.
 */
export function naFormBody(telo: Telo): string {
  const out: string[] = [];

  const chod = (kluc: string, hodnota: Hodnota) => {
    if (hodnota === null || hodnota === undefined) return;
    if (Array.isArray(hodnota)) {
      hodnota.forEach((h, i) => chod(`${kluc}[${i}]`, h));
      return;
    }
    if (typeof hodnota === "object") {
      for (const [k, v] of Object.entries(hodnota)) chod(`${kluc}[${k}]`, v);
      return;
    }
    out.push(`${encodeURIComponent(kluc)}=${encodeURIComponent(String(hodnota))}`);
  };

  for (const [k, v] of Object.entries(telo)) chod(k, v);
  return out.join("&");
}

export type SessionVstup = {
  orderId: string;
  /** Čo zákazník uvidí na riadku v Stripe checkoute. */
  nazovPodujatia: string;
  polozky: Array<{ name: string; unitPrice: number; quantity: number }>;
  celkom: number;
  mena: string;
  email: string | null;
  returnUrl: string;
  /** Kam sa vráti, keď platbu zruší. */
  zrusenaUrl: string;
  jazyk: string;
  /** Stripe účet organizátora (`acct_…`); bez neho sa platba nezaloží. */
  ucetOrganizatora: string;
  /** Provízia platformy v centoch. */
  provizaCentov: number;
  /** Referencia, podľa ktorej sa platba spáruje s objednávkou. */
  referencia: string;
};

/** Jazyky, ktoré Stripe Checkout pozná; na čokoľvek iné nech si vyberie sám. */
const JAZYKY = new Set(["sk", "cs", "en", "de", "hu", "pl"]);

export function jazykPreStripe(jazyk: string | null | undefined): string {
  const j = (jazyk || "").toLowerCase().slice(0, 2);
  return JAZYKY.has(j) ? j : "auto";
}

/**
 * Telo pre `POST /v1/checkout/sessions` — destination charge.
 *
 * Peniaze idú na účet platformy a odtiaľ sa prevedú organizátorovi
 * (`transfer_data[destination]`) zmenšené o províziu
 * (`payment_intent_data[application_fee_amount]`). Tým zostáva platforma
 * obchodníkom voči zákazníkovi, čo sedí s obchodnými podmienkami (predaj
 * „v mene a na účet usporiadateľa") a zákazník vidí na výpise nás.
 */
export function postavSession(v: SessionVstup): Telo {
  const mena = (v.mena || "eur").toLowerCase();

  // Riadky posielame jednotlivo, nech zákazník v checkoute vidí, za čo platí.
  // Keď by sa súčet riadkov nerovnal celkovej sume (zľava, kupón), pošle sa
  // jeden riadok s celkovou sumou — inak by Stripe inkasoval inú sumu.
  const suctyRiadkov = v.polozky.reduce((s, p) => s + centy(p.unitPrice) * p.quantity, 0);
  const sedi = suctyRiadkov === centy(v.celkom) && v.polozky.length > 0;

  const line_items = sedi
    ? v.polozky.map((p) => ({
        quantity: p.quantity,
        price_data: {
          currency: mena,
          unit_amount: centy(p.unitPrice),
          product_data: { name: p.name.slice(0, 250) },
        },
      }))
    : [
        {
          quantity: 1,
          price_data: {
            currency: mena,
            unit_amount: centy(v.celkom),
            product_data: { name: v.nazovPodujatia.slice(0, 250) },
          },
        },
      ];

  return {
    mode: "payment",
    locale: jazykPreStripe(v.jazyk),
    line_items,
    success_url: v.returnUrl,
    cancel_url: v.zrusenaUrl,
    client_reference_id: v.referencia,
    customer_email: v.email || undefined,
    // Metadáta sú jediné spoľahlivé spojenie session s našou objednávkou —
    // webhook podľa nich objednávku dohľadá.
    metadata: { orderId: v.orderId, reference: v.referencia },
    payment_intent_data: {
      // Rovnaké metadáta aj na platbe: refund a doúčtovanie pracujú s ňou.
      metadata: { orderId: v.orderId },
      application_fee_amount: v.provizaCentov > 0 ? v.provizaCentov : undefined,
      transfer_data: { destination: v.ucetOrganizatora },
    },
  };
}

/**
 * Telo pre refund.
 *
 * Pri destination charge treba povedať obe veci výslovne, inak by provízia
 * zostala platforme a peniaze sa stiahli z nej: `reverse_transfer` vráti
 * prevod od organizátora, `refund_application_fee` vráti aj našu províziu.
 * Pri zrušenom podujatí je to jediné správne — zákazník nedostal nič, takže
 * si nemáme čo nechať.
 */
export function postavRefund(platba: string, sumaCentov: number | null): Telo {
  return {
    payment_intent: platba,
    amount: sumaCentov && sumaCentov > 0 ? sumaCentov : undefined,
    reverse_transfer: true,
    refund_application_fee: true,
  };
}

/** Telo pre vytvorenie Express účtu organizátora. */
export function postavExpressUcet(v: {
  email: string | null;
  nazov: string | null;
  web: string | null;
  stat: string;
}): Telo {
  return {
    type: "express",
    country: (v.stat || "SK").toUpperCase(),
    email: v.email || undefined,
    business_profile: {
      // MCC 7922 = divadlá a predaj vstupeniek na predstavenia.
      mcc: "7922",
      name: v.nazov || undefined,
      url: v.web || undefined,
      product_description: "Predaj vstupeniek na kultúrne a spoločenské podujatia",
    },
    capabilities: {
      transfers: { requested: "true" },
      card_payments: { requested: "true" },
    },
    settings: {
      payouts: {
        // Výplaty riadi Stripe podľa svojho rozvrhu; ručné by znamenali, že
        // organizátorovi peniaze nedorazia, kým ich niekto neodošle.
        schedule: { interval: "daily", delay_days: "minimum" },
      },
    },
  };
}

/** Telo pre odkaz, ktorým organizátor dokončí registráciu u Stripe. */
export function postavAccountLink(v: {
  ucet: string;
  obnovitUrl: string;
  navratUrl: string;
}): Telo {
  return {
    account: v.ucet,
    refresh_url: v.obnovitUrl,
    return_url: v.navratUrl,
    type: "account_onboarding",
  };
}

/** Stav účtu organizátora tak, ako si ho držíme my. */
export type StavUctu = {
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  /** Čo Stripe ešte potrebuje — ukazuje sa organizátorovi. */
  chyba: string[];
};

/** Prečíta odpoveď Stripe o účte. Čo nerozumie, berie ako „ešte nie je hotovo". */
export function precitajUcet(ucet: unknown): StavUctu {
  const u = (ucet ?? {}) as Record<string, unknown>;
  const req = (u.requirements ?? {}) as Record<string, unknown>;
  const zoznam = [
    ...(Array.isArray(req.currently_due) ? req.currently_due : []),
    ...(Array.isArray(req.past_due) ? req.past_due : []),
  ].map((x) => String(x));
  return {
    charges_enabled: u.charges_enabled === true,
    payouts_enabled: u.payouts_enabled === true,
    details_submitted: u.details_submitted === true,
    chyba: [...new Set(zoznam)],
  };
}
