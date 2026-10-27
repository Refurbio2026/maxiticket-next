import { describe, it, expect } from "vitest";
import { sZonou, utcZnacka, utcZnackaZDatumu } from "./datum-zona";

describe("sZonou", () => {
  it("v zime pripojí +01:00", () => {
    expect(sZonou("2026-11-05", "19:30")).toBe("2026-11-05T19:30:00+01:00");
  });

  it("v lete pripojí +02:00", () => {
    expect(sZonou("2026-07-15", "20:00")).toBe("2026-07-15T20:00:00+02:00");
  });

  it("sekundy z času zahodí", () => {
    expect(sZonou("2026-07-15", "20:00:00")).toBe("2026-07-15T20:00:00+02:00");
  });

  it("chýbajúci čas berie ako polnoc", () => {
    expect(sZonou("2026-07-15", null)).toBe("2026-07-15T00:00:00+02:00");
  });

  it("nečitateľný dátum vráti bez posunu, nie prázdno", () => {
    expect(sZonou("nedatum", "20:00")).toBe("nedatumT20:00:00");
  });
});

describe("utcZnacka", () => {
  it("letný čas prepočíta o dve hodiny dozadu", () => {
    expect(utcZnacka("2026-07-15", "20:00")).toBe("20260715T180000Z");
  });

  it("zimný čas o jednu", () => {
    expect(utcZnacka("2026-11-05", "19:30")).toBe("20261105T183000Z");
  });

  it("prelom dňa prenesie aj dátum", () => {
    // 00:30 v Bratislave v lete je 22:30 UTC predošlého dňa.
    expect(utcZnacka("2026-07-15", "00:30")).toBe("20260714T223000Z");
  });

  it("nečitateľný vstup vráti null", () => {
    expect(utcZnacka("nedatum", "20:00")).toBeNull();
  });
});

describe("utcZnackaZDatumu", () => {
  it("má tvar bez oddeľovačov a bez milisekúnd", () => {
    expect(utcZnackaZDatumu(new Date("2026-10-27T09:05:06.789Z"))).toBe("20261027T090506Z");
  });
});
