import { describe, it, expect } from "vitest";
import {
  den,
  hodina,
  pocetTerminov,
  popisTerminov,
  rozsah,
  terminyVPredaji,
  vRozsahu,
  type TerminLite,
} from "./terminy-popis";

const DNES = "2026-11-01";
const t = (datum: string, cas = "18:00:00", status = "on_sale"): TerminLite => ({
  event_date: datum,
  event_time: cas,
  status,
});

describe("výber termínov", () => {
  it("berie len tie v predaji", () => {
    const v = terminyVPredaji([t("2026-11-17"), t("2026-11-18", "18:00:00", "draft")], DNES);
    expect(v.map((x) => x.event_date)).toEqual(["2026-11-17"]);
  });

  it("odohraný termín vynechá, dnešný ponechá", () => {
    const v = terminyVPredaji([t("2026-10-30"), t(DNES), t("2026-11-17")], DNES);
    expect(v.map((x) => x.event_date)).toEqual([DNES, "2026-11-17"]);
  });

  it("zoradí od najbližšieho, aj dve predstavenia v ten istý deň", () => {
    const v = terminyVPredaji([t("2026-11-17", "20:00:00"), t("2026-11-17", "14:00:00")], DNES);
    expect(v.map((x) => x.event_time)).toEqual(["14:00:00", "20:00:00"]);
  });

  it("prázdny alebo chýbajúci vstup nespadne", () => {
    expect(terminyVPredaji(undefined, DNES)).toEqual([]);
    expect(terminyVPredaji([], DNES)).toEqual([]);
  });

  it("nemení pôvodné pole", () => {
    const vstup = [t("2026-11-19"), t("2026-11-17")];
    terminyVPredaji(vstup, DNES);
    expect(vstup[0].event_date).toBe("2026-11-19");
  });
});

describe("formát dátumu a času", () => {
  it("dátum po slovensky", () => {
    expect(den("2026-11-17")).toBe("17. 11. 2026");
  });

  it("nečitateľný dátum vráti, ako prišiel", () => {
    expect(den("nedatum")).toBe("nedatum");
  });

  it("čas bez sekúnd", () => {
    expect(hodina("18:00:00")).toBe("18:00");
    expect(hodina("18:00")).toBe("18:00");
  });

  it("chýbajúci alebo nezmyselný čas je prázdny", () => {
    expect(hodina(null)).toBe("");
    expect(hodina("")).toBe("");
    expect(hodina("xx")).toBe("");
  });
});

describe("rozsah", () => {
  it("v tom istom mesiaci zopakuje len deň", () => {
    expect(rozsah("2026-11-17", "2026-11-19")).toBe("17. – 19. 11. 2026");
  });

  it("v tom istom roku doplní mesiac", () => {
    expect(rozsah("2026-11-05", "2026-12-17")).toBe("5. 11. – 17. 12. 2026");
  });

  it("cez prelom roka napíše oba roky", () => {
    expect(rozsah("2026-12-28", "2027-01-05")).toBe("28. 12. 2026 – 5. 1. 2027");
  });

  it("rovnaký dátum nie je rozsah", () => {
    expect(rozsah("2026-11-17", "2026-11-17")).toBe("17. 11. 2026");
  });
});

describe("skloňovanie", () => {
  it("1 termín, 3 termíny, 7 termínov", () => {
    expect(pocetTerminov(1)).toBe("1 termín");
    expect(pocetTerminov(3)).toBe("3 termíny");
    expect(pocetTerminov(7)).toBe("7 termínov");
  });
});

describe("popis do karty", () => {
  it("jeden termín: dátum a čas", () => {
    const p = popisTerminov([t("2026-11-17")], undefined, DNES);
    expect(p).toEqual({ text: "17. 11. 2026 · 18:00", pocet: 1, viac: null });
  });

  it("viac termínov: rozsah a počet, nie jednotlivé dátumy", () => {
    const p = popisTerminov([t("2026-11-17"), t("2026-11-18"), t("2026-11-19")], undefined, DNES);
    expect(p.text).toBe("17. – 19. 11. 2026");
    expect(p.pocet).toBe(3);
    expect(p.viac).toBe("3 termíny");
  });

  it("bez termínu v predaji použije dátum podujatia a nehlási počet", () => {
    const p = popisTerminov([], { event_date: "2026-11-17", event_time: "18:00:00" }, DNES);
    expect(p).toEqual({ text: "17. 11. 2026 · 18:00", pocet: 0, viac: null });
  });

  it("bez termínu aj bez záložného dátumu to povie, nenechá prázdno", () => {
    expect(popisTerminov([], undefined, DNES).text).toBe("Termín zverejníme");
  });

  it("nikdy nevracia surový ISO dátum so sekundami", () => {
    const p = popisTerminov([t("2026-11-17")], undefined, DNES);
    expect(p.text).not.toContain("2026-11-17");
    expect(p.text).not.toContain(":00:00");
  });
});

describe("filtrovanie podľa rozsahu", () => {
  const terminy = [t("2026-11-17"), t("2026-11-18"), t("2026-11-19")];

  it("bez filtra prejde všetko", () => {
    expect(vRozsahu(terminy, undefined, null, null, DNES)).toBe(true);
  });

  it("stačí jeden termín v rozsahu", () => {
    expect(vRozsahu(terminy, undefined, "2026-11-19", "2026-11-30", DNES)).toBe(true);
  });

  it("mimo rozsahu neprejde", () => {
    expect(vRozsahu(terminy, undefined, "2026-12-01", "2026-12-31", DNES)).toBe(false);
  });

  it("rozhoduje termín, nie dátum podujatia", () => {
    // Dátum podujatia je v novembri, hľadá sa december — a podujatie
    // v decembri naozaj hrá. Podľa stĺpca podujatia by vypadlo.
    const v = [t("2026-11-17"), t("2026-12-20")];
    expect(vRozsahu(v, { event_date: "2026-11-17" }, "2026-12-01", "2026-12-31", DNES)).toBe(true);
  });

  it("len dolná alebo len horná hranica", () => {
    expect(vRozsahu(terminy, undefined, "2026-11-18", null, DNES)).toBe(true);
    expect(vRozsahu(terminy, undefined, null, "2026-11-16", DNES)).toBe(false);
  });

  it("bez termínov v predaji rozhodne dátum podujatia", () => {
    expect(vRozsahu([], { event_date: "2026-12-05" }, "2026-12-01", "2026-12-31", DNES)).toBe(true);
    expect(vRozsahu([], { event_date: "2026-11-05" }, "2026-12-01", "2026-12-31", DNES)).toBe(
      false,
    );
  });

  it("bez termínov aj bez dátumu pri zapnutom filtri neprejde", () => {
    expect(vRozsahu([], undefined, "2026-12-01", null, DNES)).toBe(false);
  });
});
