import { describe, expect, it } from "vitest";
import { naPohyb, zapisatelna, type PlatbaBrany } from "./brana-zrkadlenie";

const platba = (x: Partial<PlatbaBrany> = {}): PlatbaBrany => ({
  id: "4c46d31a-f356-451f-958d-3250e3852687",
  provider: "comgate",
  provider_payment_id: "GZTX-ITBB-YBVW",
  amount: 19,
  currency: "EUR",
  status: "paid",
  created_at: "2026-10-24T13:05:00.000Z",
  ...x,
});

const objednavka = { payment_vs: 1000033, customer_name: "Eva Nová", customer_email: "e@n.sk" };

describe("ktorá platba patrí do knihy", () => {
  it("zaplatená a vrátená áno", () => {
    expect(zapisatelna(platba())).toBe(true);
    expect(zapisatelna(platba({ status: "refunded", amount: -19 }))).toBe(true);
  });

  it("zrušená, zlyhaná ani čakajúca nie — peniaze sa nepohli", () => {
    for (const status of ["cancelled", "failed", "pending", "authorized"]) {
      expect(zapisatelna(platba({ status }))).toBe(false);
    }
  });

  it("nulová suma nie", () => {
    expect(zapisatelna(platba({ amount: 0 }))).toBe(false);
  });
});

describe("prevod platby na pohyb", () => {
  it("prenesie sumu, menu, dátum a variabilný symbol objednávky", () => {
    const t = naPohyb(platba(), objednavka);
    expect(t.amount).toBe(19);
    expect(t.currency).toBe("EUR");
    expect(t.value_date).toBe("2026-10-24");
    expect(t.variable_symbol).toBe("0001000033");
    expect(t.counterparty_name).toBe("Eva Nová");
    expect(t.message).toContain("GZTX-ITBB-YBVW");
  });

  it("vrátenie má zápornú sumu a pozná sa podľa popisu", () => {
    const t = naPohyb(platba({ status: "refunded", amount: -19 }), objednavka);
    expect(t.amount).toBe(-19);
    expect(t.message).toContain("Vrátenie");
  });

  it("kľúč stojí na id platby, nie na referencii brány", () => {
    // Tá istá referencia patrí platbe aj jej vráteniu; podľa nej by sa
    // druhý pohyb zahodil ako duplicita a kniha by nesedela.
    const a = naPohyb(platba(), objednavka);
    const b = naPohyb(platba({ id: "iné-id", status: "refunded", amount: -19 }), objednavka);
    expect(a.external_id).not.toBe(b.external_id);
    expect(a.external_id).toContain("4c46d31a");
  });

  it("platba bez objednávky nezhodí prevod", () => {
    const t = naPohyb(platba(), null);
    expect(t.variable_symbol).toBeNull();
    expect(t.counterparty_name).toBeNull();
  });
});
