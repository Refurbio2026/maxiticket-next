import { describe, it, expect } from "vitest";
import {
  cenaDorucenia,
  doruceniePostouMozne,
  jeSposobDorucenia,
  naCenty,
  normalizujPsc,
  prvaChyba,
  skontrolujDorucenie,
} from "./postovne";

describe("cena doručenia", () => {
  it("e-mailom je zadarmo aj keď je poštovné nastavené", () => {
    expect(cenaDorucenia("email", 4.5)).toBe(0);
  });

  it("poštou je pevná suma z nastavenia", () => {
    expect(cenaDorucenia("posta", 4.5)).toBe(4.5);
  });

  it("nenastavené alebo nulové poštovné nič nepripočíta", () => {
    expect(cenaDorucenia("posta", null)).toBe(0);
    expect(cenaDorucenia("posta", 0)).toBe(0);
    expect(cenaDorucenia("posta", -3)).toBe(0);
  });

  it("zaokrúhľuje na centy", () => {
    expect(cenaDorucenia("posta", 4.499)).toBe(4.5);
    expect(naCenty(3.005)).toBe(3.01);
  });
});

describe("kedy sa smie vybrať pošta", () => {
  it("len zapnuté a s cenou", () => {
    expect(doruceniePostouMozne(true, 4.5)).toBe(true);
    expect(doruceniePostouMozne(false, 4.5)).toBe(false);
    // Zapnuté bez ceny by znamenalo, že poštovné platíme my.
    expect(doruceniePostouMozne(true, 0)).toBe(false);
    expect(doruceniePostouMozne(true, null)).toBe(false);
  });
});

describe("spôsob doručenia od klienta", () => {
  it("prijme len to, čo poznáme", () => {
    expect(jeSposobDorucenia("posta")).toBe(true);
    expect(jeSposobDorucenia("email")).toBe(true);
    expect(jeSposobDorucenia("kurier")).toBe(false);
    expect(jeSposobDorucenia(null)).toBe(false);
  });
});

describe("PSČ", () => {
  it("normalizuje na tvar s medzerou", () => {
    expect(normalizujPsc("82109")).toBe("821 09");
    expect(normalizujPsc("821 09")).toBe("821 09");
    expect(normalizujPsc("821-09")).toBe("821 09");
  });

  it("neznámy tvar nechá, ako prišiel — kontrola ho zachytí", () => {
    expect(normalizujPsc("8210")).toBe("8210");
  });
});

const platna = {
  meno: "Jana Kováčová",
  ulica: "Holubyho 42",
  mesto: "Bratislava",
  psc: "821 09",
  krajina: "SK",
};

describe("kontrola doručenia", () => {
  it("pri e-maile nekontroluje nič", () => {
    expect(skontrolujDorucenie("email", null)).toEqual([]);
  });

  it("platná slovenská adresa prejde", () => {
    expect(skontrolujDorucenie("posta", platna)).toEqual([]);
  });

  it("chýbajúca adresa sa ohlási po poliach", () => {
    const ch = skontrolujDorucenie("posta", {});
    expect(ch.map((c) => c.pole)).toContain("street");
    expect(ch.map((c) => c.pole)).toContain("city");
    expect(ch.map((c) => c.pole)).toContain("zip");
    expect(ch.map((c) => c.pole)).toContain("name");
  });

  it("zlý tvar PSČ sa ohlási zrozumiteľne", () => {
    const ch = skontrolujDorucenie("posta", { ...platna, psc: "8210" });
    expect(prvaChyba(ch)).toMatch(/päť číslic/);
  });

  it("do zahraničia poštou nie", () => {
    const ch = skontrolujDorucenie("posta", { ...platna, krajina: "CZ" });
    expect(ch.some((c) => c.pole === "krajina")).toBe(true);
  });

  it("prvaChyba vráti null, keď je čisto", () => {
    expect(prvaChyba([])).toBeNull();
  });
});
