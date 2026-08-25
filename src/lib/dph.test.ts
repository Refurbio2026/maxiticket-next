import { describe, it, expect } from "vitest";
import { ZAKLADNA_SADZBA, POVOLENE_SADZBY, POPIS_SADZIEB, jePovolenaSadzba } from "./dph";

describe("sadzby DPH", () => {
  it("základná sadzba je 23 %", () => {
    // Od 1. 1. 2025; predtým to bolo 20 % a v kóde to bolo natvrdo.
    expect(ZAKLADNA_SADZBA).toBe(23);
  });

  it("zoznam obsahuje sadzby, ktoré zákon pozná", () => {
    expect([...POVOLENE_SADZBY]).toEqual([0, 5, 19, 23]);
  });

  it("prijme len sadzbu zo zoznamu", () => {
    expect(jePovolenaSadzba(23)).toBe(true);
    expect(jePovolenaSadzba(5)).toBe(true);
    // Stará základná sadzba sa už nesmie dať nastaviť omylom.
    expect(jePovolenaSadzba(20)).toBe(false);
    expect(jePovolenaSadzba(21)).toBe(false);
    expect(jePovolenaSadzba(-5)).toBe(false);
  });

  it("každá sadzba má vysvetlenie pre obsluhu", () => {
    for (const s of POVOLENE_SADZBY) {
      expect(POPIS_SADZIEB[s]).toBeTruthy();
    }
  });

  it("popis znížených sadzieb hovorí, čo do nich patrí", () => {
    // Toto je jediné miesto, kde obsluha uvidí, že koncert do 5 % nepatrí.
    expect(POPIS_SADZIEB[5]).toMatch(/divadlo/i);
    expect(POPIS_SADZIEB[5]).toMatch(/športov/i);
    expect(POPIS_SADZIEB[23]).toMatch(/koncert/i);
  });
});
