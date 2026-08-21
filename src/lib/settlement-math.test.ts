// Vyúčtovanie organizátora — chyba tu znamená zle vyplatené peniaze.
import { describe, it, expect } from "vitest";
import { round2, computeSettlementTotals } from "./settlement-math";

describe("round2", () => {
  it("zaokrúhľuje na centy", () => {
    expect(round2(12.344)).toBe(12.34);
    expect(round2(12.345)).toBe(12.35);
    expect(round2(12.346)).toBe(12.35);
  });

  it("nepodlieha chybe dvojkovej sústavy", () => {
    // 0.1 + 0.2 === 0.30000000000000004
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(8.475)).toBe(8.48);
  });

  it("zvláda nulu a záporné sumy", () => {
    expect(round2(0)).toBe(0);
    expect(round2(-12.345)).toBe(-12.34); // Math.round: -12.345 → -12.34
    expect(round2(-0.004)).toBe(-0);
  });
});

describe("computeSettlementTotals", () => {
  it("odpočíta províziu z tržby a náklady až po nej", () => {
    const t = computeSettlementTotals({ gross: 1000, refunded: 0, costsAmount: 50, rate: 10 });
    expect(t.commission_amount).toBe(100); // 10 % z 1000
    expect(t.net_amount).toBe(850); // 1000 − 100 − 50
  });

  it("províziu počíta až po vrátených peniazoch", () => {
    // Kľúčové: z vrátenej vstupenky si platforma podiel neberie.
    const t = computeSettlementTotals({ gross: 1000, refunded: 200, costsAmount: 0, rate: 10 });
    expect(t.commission_amount).toBe(80); // 10 % z 800, nie z 1000
    expect(t.net_amount).toBe(720);
  });

  it("náklady províziu neznižujú", () => {
    const bez = computeSettlementTotals({ gross: 500, refunded: 0, costsAmount: 0, rate: 20 });
    const s = computeSettlementTotals({ gross: 500, refunded: 0, costsAmount: 300, rate: 20 });
    expect(s.commission_amount).toBe(bez.commission_amount);
    expect(s.net_amount).toBe(100); // 500 − 100 − 300
  });

  it("pri nulovej sadzbe si platforma neberie nič", () => {
    const t = computeSettlementTotals({ gross: 777.77, refunded: 0, costsAmount: 0, rate: 0 });
    expect(t.commission_amount).toBe(0);
    expect(t.net_amount).toBe(777.77);
  });

  it("obdobie bez predaja, ale s nákladmi, končí v mínuse", () => {
    // Dlh za tlač vstupeniek nezmizne tým, že sa nepredalo.
    const t = computeSettlementTotals({ gross: 0, refunded: 0, costsAmount: 42.5, rate: 10 });
    expect(t.net_amount).toBe(-42.5);
    expect(t.commission_amount).toBe(0);
  });

  it("úplné vrátenie celej tržby nevyrobí kladnú províziu", () => {
    const t = computeSettlementTotals({ gross: 300, refunded: 300, costsAmount: 0, rate: 15 });
    expect(t.commission_amount).toBe(0);
    expect(t.net_amount).toBe(0);
  });

  it("vrátené viac než predané dá zápornú províziu aj čistú sumu", () => {
    // Nastane, keď sa vracia vstupenka predaná v skoršom období.
    const t = computeSettlementTotals({ gross: 100, refunded: 250, costsAmount: 0, rate: 10 });
    expect(t.commission_amount).toBe(-15);
    expect(t.net_amount).toBe(-135); // −150 − (−15)
  });

  it("nevracia halierové chvosty", () => {
    const t = computeSettlementTotals({
      gross: 33.33 * 3,
      refunded: 0.1 + 0.2,
      costsAmount: 1.005,
      rate: 12.5,
    });
    for (const v of Object.values(t)) {
      expect(round2(v)).toBe(v);
    }
  });

  it("hrubú a vrátenú sumu vracia zaokrúhlené", () => {
    const t = computeSettlementTotals({
      gross: 10.005,
      refunded: 2.004,
      costsAmount: 0,
      rate: 10,
    });
    expect(t.gross_amount).toBe(10.01);
    expect(t.refunded_amount).toBe(2);
  });
});
