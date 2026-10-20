import { describe, it, expect } from "vitest";
import {
  centy,
  jazykPreStripe,
  naFormBody,
  postavAccountLink,
  postavExpressUcet,
  postavRefund,
  postavSession,
  precitajUcet,
  provizia,
  type SessionVstup,
} from "./stripe-telo";

describe("centy", () => {
  it("prevedie eurá bez chyby zaokrúhlenia", () => {
    expect(centy(12)).toBe(1200);
    expect(centy(12.34)).toBe(1234);
    expect(centy(0)).toBe(0);
    // 19.99 * 100 je v plávajúcej desatinnej 1998.9999…
    expect(centy(19.99)).toBe(1999);
    expect(centy(0.07)).toBe(7);
    expect(centy(1234.56)).toBe(123456);
  });

  it("odmietne nezmysel", () => {
    expect(() => centy(Number.NaN)).toThrow();
    expect(() => centy(-1)).toThrow();
  });
});

describe("provizia", () => {
  it("počíta percento z celkovej sumy", () => {
    expect(provizia(10000, 5)).toBe(500);
    expect(provizia(1999, 10)).toBe(200); // 199,9 → 200
    expect(provizia(123456, 5)).toBe(6173); // 6172,8 → 6173
  });

  it("bez sadzby je nula", () => {
    expect(provizia(10000, null)).toBe(0);
    expect(provizia(10000, undefined)).toBe(0);
    expect(provizia(10000, 0)).toBe(0);
  });

  it("nikdy neprekročí platbu a nikdy nie je negatívna", () => {
    expect(provizia(10000, 100)).toBe(10000);
    expect(provizia(10000, 250)).toBe(10000);
    expect(provizia(10000, -5)).toBe(0);
    expect(provizia(0, 10)).toBe(0);
  });

  it("nespadne na nezmyselnej sadzbe", () => {
    expect(provizia(10000, Number.NaN)).toBe(0);
    expect(provizia(10000, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("naFormBody", () => {
  it("vnorené objekty prevedie na zátvorkovú notáciu", () => {
    expect(naFormBody({ a: { b: "c" } })).toBe("a%5Bb%5D=c");
    expect(naFormBody({ mode: "payment" })).toBe("mode=payment");
  });

  it("polia čísluje", () => {
    const telo = naFormBody({ line_items: [{ quantity: 2 }, { quantity: 1 }] });
    expect(decodeURIComponent(telo)).toBe("line_items[0][quantity]=2&line_items[1][quantity]=1");
  });

  it("vynechá null aj undefined, ale nulu a false nechá", () => {
    const telo = naFormBody({ a: null, b: undefined, c: 0, d: false, e: "" });
    expect(decodeURIComponent(telo)).toBe("c=0&d=false&e=");
  });

  it("escapuje hodnoty, takže ich nikto nerozbije ampersandom", () => {
    const telo = naFormBody({ name: "Koncert & párty", url: "https://x.sk/?a=1&b=2" });
    expect(telo).not.toContain("párty&");
    expect(new URLSearchParams(telo).get("name")).toBe("Koncert & párty");
    expect(new URLSearchParams(telo).get("url")).toBe("https://x.sk/?a=1&b=2");
  });
});

describe("jazykPreStripe", () => {
  it("pozná naše jazyky", () => {
    expect(jazykPreStripe("sk")).toBe("sk");
    expect(jazykPreStripe("SK")).toBe("sk");
    expect(jazykPreStripe("hu-HU")).toBe("hu");
  });

  it("na neznámy nechá rozhodnúť Stripe", () => {
    expect(jazykPreStripe("xx")).toBe("auto");
    expect(jazykPreStripe(null)).toBe("auto");
    expect(jazykPreStripe("")).toBe("auto");
  });
});

const VSTUP: SessionVstup = {
  orderId: "7374175b-f3ef-4a68-95ee-d04eec96c149",
  nazovPodujatia: "Vianočný koncert",
  polozky: [
    { name: "Vstupenka — rad 3", unitPrice: 12, quantity: 2 },
    { name: "Vstupenka — balkón", unitPrice: 8, quantity: 1 },
  ],
  celkom: 32,
  mena: "EUR",
  email: "kupujuci@example.test",
  returnUrl: "https://eticketo.eu/checkout/abc?stav=ok",
  zrusenaUrl: "https://eticketo.eu/checkout/abc?stav=zrusene",
  jazyk: "sk",
  ucetOrganizatora: "acct_1234567890",
  provizaCentov: 160,
  referencia: "VS2026001",
};

describe("postavSession", () => {
  it("je platba v eurách po slovensky", () => {
    const t = postavSession(VSTUP);
    expect(t.mode).toBe("payment");
    expect(t.locale).toBe("sk");
    const riadky = t.line_items as Array<{ price_data: { currency: string } }>;
    expect(riadky[0].price_data.currency).toBe("eur");
  });

  it("posiela peniaze organizátorovi a províziu platforme", () => {
    const t = postavSession(VSTUP);
    const pid = t.payment_intent_data as {
      application_fee_amount?: number;
      transfer_data: { destination: string };
    };
    expect(pid.transfer_data.destination).toBe("acct_1234567890");
    expect(pid.application_fee_amount).toBe(160);
  });

  it("pri nulovej provízii pole vôbec neposiela", () => {
    const t = postavSession({ ...VSTUP, provizaCentov: 0 });
    const pid = t.payment_intent_data as { application_fee_amount?: number };
    expect(pid.application_fee_amount).toBeUndefined();
    expect(naFormBody(t)).not.toContain("application_fee_amount");
  });

  it("drží id objednávky v metadátach session aj platby", () => {
    const t = postavSession(VSTUP);
    expect((t.metadata as { orderId: string }).orderId).toBe(VSTUP.orderId);
    const pid = t.payment_intent_data as { metadata: { orderId: string } };
    expect(pid.metadata.orderId).toBe(VSTUP.orderId);
    expect(t.client_reference_id).toBe("VS2026001");
  });

  it("rozpíše riadky, keď ich súčet sedí s celkovou sumou", () => {
    const t = postavSession(VSTUP);
    const riadky = t.line_items as Array<{ quantity: number; price_data: { unit_amount: number } }>;
    expect(riadky).toHaveLength(2);
    const suma = riadky.reduce((s, r) => s + r.price_data.unit_amount * r.quantity, 0);
    expect(suma).toBe(3200);
  });

  it("pri zľave pošle jeden riadok s celkovou sumou — nech sa inkasuje správne", () => {
    // Kupón zlacnil objednávku, súčet riadkov už nesedí.
    const t = postavSession({ ...VSTUP, celkom: 25 });
    const riadky = t.line_items as Array<{ quantity: number; price_data: { unit_amount: number } }>;
    expect(riadky).toHaveLength(1);
    expect(riadky[0].price_data.unit_amount).toBe(2500);
    expect(riadky[0].quantity).toBe(1);
  });

  it("bez položiek sa nestratí suma", () => {
    const t = postavSession({ ...VSTUP, polozky: [] });
    const riadky = t.line_items as Array<{ price_data: { unit_amount: number } }>;
    expect(riadky).toHaveLength(1);
    expect(riadky[0].price_data.unit_amount).toBe(3200);
  });

  it("výsledok sa dá zakódovať do tela, ktoré Stripe berie", () => {
    const telo = naFormBody(postavSession(VSTUP));
    const p = new URLSearchParams(telo);
    expect(p.get("mode")).toBe("payment");
    expect(p.get("payment_intent_data[transfer_data][destination]")).toBe("acct_1234567890");
    expect(p.get("payment_intent_data[application_fee_amount]")).toBe("160");
    expect(p.get("line_items[0][price_data][currency]")).toBe("eur");
    expect(p.get("metadata[orderId]")).toBe(VSTUP.orderId);
  });
});

describe("postavRefund", () => {
  it("vracia aj prevod organizátorovi aj našu províziu", () => {
    const t = postavRefund("pi_123", 3200);
    expect(t.payment_intent).toBe("pi_123");
    expect(t.amount).toBe(3200);
    expect(t.reverse_transfer).toBe(true);
    expect(t.refund_application_fee).toBe(true);
  });

  it("bez sumy refunduje celú platbu", () => {
    expect(postavRefund("pi_123", null).amount).toBeUndefined();
    expect(postavRefund("pi_123", 0).amount).toBeUndefined();
  });
});

describe("postavExpressUcet", () => {
  it("žiada prevody aj platby kartou a je to Express", () => {
    const t = postavExpressUcet({
      email: "org@example.test",
      nazov: "MsKS Pezinok",
      web: "https://msks.sk",
      stat: "sk",
    });
    expect(t.type).toBe("express");
    expect(t.country).toBe("SK");
    const cap = t.capabilities as { transfers: { requested: string } };
    expect(cap.transfers.requested).toBe("true");
    const telo = naFormBody(t);
    expect(telo).toContain("capabilities%5Bcard_payments%5D%5Brequested%5D=true");
  });

  it("prázdne polia neposiela", () => {
    const telo = naFormBody(postavExpressUcet({ email: null, nazov: null, web: null, stat: "SK" }));
    expect(telo).not.toContain("email=");
    expect(telo).not.toContain("business_profile%5Bname%5D");
  });
});

describe("postavAccountLink", () => {
  it("je to onboarding odkaz s oboma adresami", () => {
    const t = postavAccountLink({
      ucet: "acct_1",
      obnovitUrl: "https://eticketo.eu/organizer/payouts?obnovit=1",
      navratUrl: "https://eticketo.eu/organizer/payouts?hotovo=1",
    });
    expect(t.type).toBe("account_onboarding");
    expect(t.account).toBe("acct_1");
    expect(t.refresh_url).toContain("obnovit=1");
    expect(t.return_url).toContain("hotovo=1");
  });
});

describe("precitajUcet", () => {
  it("prečíta hotový účet", () => {
    const s = precitajUcet({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [], past_due: [] },
    });
    expect(s).toEqual({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      chyba: [],
    });
  });

  it("zozbiera, čo Stripe ešte potrebuje, bez duplikátov", () => {
    const s = precitajUcet({
      charges_enabled: false,
      requirements: {
        currently_due: ["individual.id_number", "external_account"],
        past_due: ["external_account"],
      },
    });
    expect(s.charges_enabled).toBe(false);
    expect(s.chyba).toEqual(["individual.id_number", "external_account"]);
  });

  it("čomu nerozumie, berie ako nehotové — nikdy nie ako povolené", () => {
    expect(precitajUcet(null).charges_enabled).toBe(false);
    expect(precitajUcet(undefined).payouts_enabled).toBe(false);
    expect(precitajUcet({ charges_enabled: "true" }).charges_enabled).toBe(false);
    expect(precitajUcet({}).chyba).toEqual([]);
  });
});
