import { describe, it, expect } from "vitest";
import {
  FARBA_PREDVOLENA,
  NASTAVENIA_PREDVOLENE,
  POCET_PODUJATI,
  adresaDat,
  adresaNakupu,
  coChyba,
  orezPocet,
  platnaFarba,
  platnaSubdomena,
  platneUuid,
  precitajNastavenia,
  uryvokKodu,
} from "./widget";

const ZAKLAD = "https://eticketo.eu";
const UUID = "7374175b-f3ef-4a68-95ee-d04eec96c149";

describe("platnaSubdomena", () => {
  it("berie to, čo vyrába slugify", () => {
    expect(platnaSubdomena("mskspezinok")).toBe(true);
    expect(platnaSubdomena("mestske-kulturne-stredisko")).toBe(true);
    expect(platnaSubdomena("abc123")).toBe(true);
  });

  it("odmietne všetko, čo by sa dalo zneužiť", () => {
    expect(platnaSubdomena("")).toBe(false);
    expect(platnaSubdomena("Veľké")).toBe(false);
    expect(platnaSubdomena("-zacina-pomlckou")).toBe(false);
    expect(platnaSubdomena("konci-")).toBe(false);
    expect(platnaSubdomena("dve--pomlcky")).toBe(false);
    expect(platnaSubdomena("a/b")).toBe(false);
    expect(platnaSubdomena("a b")).toBe(false);
    expect(platnaSubdomena("x".repeat(64))).toBe(false);
    expect(platnaSubdomena(42)).toBe(false);
    expect(platnaSubdomena(null)).toBe(false);
  });
});

describe("platneUuid", () => {
  it("prijme uuid a odmietne zvyšok", () => {
    expect(platneUuid(UUID)).toBe(true);
    expect(platneUuid(UUID.toUpperCase())).toBe(true);
    expect(platneUuid("7374175b")).toBe(false);
    expect(platneUuid(`${UUID} or 1=1`)).toBe(false);
    expect(platneUuid(undefined)).toBe(false);
  });
});

describe("platnaFarba", () => {
  it("len čistý hex — farba ide do CSS", () => {
    expect(platnaFarba("#fe6a00")).toBe(true);
    expect(platnaFarba("#FE6A00")).toBe(true);
    expect(platnaFarba("red")).toBe(false);
    expect(platnaFarba("#fff")).toBe(false);
    expect(platnaFarba("#fe6a00; background:url(x)")).toBe(false);
    expect(platnaFarba("")).toBe(false);
  });
});

describe("orezPocet", () => {
  it("drží sa v hraniciach", () => {
    expect(orezPocet(5)).toBe(5);
    expect(orezPocet(0)).toBe(POCET_PODUJATI.najmenej);
    expect(orezPocet(999)).toBe(POCET_PODUJATI.najviac);
    expect(orezPocet(-3)).toBe(POCET_PODUJATI.najmenej);
    expect(orezPocet("8")).toBe(8);
    expect(orezPocet(3.7)).toBe(3);
  });

  it("nezmysel nahradí predvoleným", () => {
    expect(orezPocet("veľa")).toBe(POCET_PODUJATI.predvolene);
    expect(orezPocet(undefined)).toBe(POCET_PODUJATI.predvolene);
    expect(orezPocet(Number.NaN)).toBe(POCET_PODUJATI.predvolene);
  });
});

describe("precitajNastavenia", () => {
  it("prečíta plnú sadu", () => {
    const n = precitajNastavenia({
      rezim: "podujatie",
      podujatie: UUID,
      vzhlad: "tmavy",
      farba: "#112233",
      pocet: "3",
    });
    expect(n.rezim).toBe("podujatie");
    expect(n.podujatie).toBe(UUID);
    expect(n.vzhlad).toBe("tmavy");
    expect(n.farba).toBe("#112233");
    expect(n.pocet).toBe(3);
  });

  it("preklep v atribúte nezhodí widget, len sa použije predvolené", () => {
    const n = precitajNastavenia({ rezim: "zoznm", vzhlad: "neon", farba: "modra" });
    expect(n.rezim).toBe(NASTAVENIA_PREDVOLENE.rezim);
    expect(n.vzhlad).toBe(NASTAVENIA_PREDVOLENE.vzhlad);
    expect(n.farba).toBe(FARBA_PREDVOLENA);
  });

  it("neplatnú subdoménu ani id nepustí ďalej", () => {
    const n = precitajNastavenia({ organizator: "ZLE/../x", podujatie: "nie-uuid" });
    expect(n.organizator).toBe("");
    expect(n.podujatie).toBeNull();
  });

  it("prázdny vstup dá predvolené nastavenia", () => {
    expect(precitajNastavenia({})).toEqual(NASTAVENIA_PREDVOLENE);
  });
});

describe("coChyba", () => {
  it("zoznam potrebuje organizátora", () => {
    expect(coChyba({ ...NASTAVENIA_PREDVOLENE, rezim: "zoznam" })).toHaveLength(1);
    expect(
      coChyba({ ...NASTAVENIA_PREDVOLENE, rezim: "zoznam", organizator: "mskspezinok" }),
    ).toEqual([]);
  });

  it("jedno podujatie aj tlačidlo potrebujú id", () => {
    expect(coChyba({ ...NASTAVENIA_PREDVOLENE, rezim: "podujatie" })).toHaveLength(1);
    expect(coChyba({ ...NASTAVENIA_PREDVOLENE, rezim: "tlacidlo" })).toHaveLength(1);
    expect(coChyba({ ...NASTAVENIA_PREDVOLENE, rezim: "tlacidlo", podujatie: UUID })).toEqual([]);
  });
});

describe("adresaDat", () => {
  it("pre zoznam pošle organizátora a počet", () => {
    const u = new URL(
      adresaDat(ZAKLAD, { ...NASTAVENIA_PREDVOLENE, organizator: "mskspezinok", pocet: 7 }),
    );
    expect(u.pathname).toBe("/api/widget/events");
    expect(u.searchParams.get("organizator")).toBe("mskspezinok");
    expect(u.searchParams.get("pocet")).toBe("7");
    expect(u.searchParams.get("podujatie")).toBeNull();
  });

  it("pre jedno podujatie pošle len id", () => {
    const u = new URL(
      adresaDat(ZAKLAD, { ...NASTAVENIA_PREDVOLENE, rezim: "podujatie", podujatie: UUID }),
    );
    expect(u.searchParams.get("podujatie")).toBe(UUID);
    expect(u.searchParams.get("organizator")).toBeNull();
  });
});

describe("adresaNakupu", () => {
  it("mieri na podujatie na eticketo a značí zdroj", () => {
    const u = new URL(adresaNakupu(ZAKLAD, UUID));
    expect(u.origin).toBe(ZAKLAD);
    expect(u.pathname).toBe(`/events/${UUID}`);
    expect(u.searchParams.get("utm_source")).toBe("widget");
  });
});

describe("uryvokKodu", () => {
  it("najkratší možný tvar pre zoznam", () => {
    const k = uryvokKodu(ZAKLAD, { ...NASTAVENIA_PREDVOLENE, organizator: "mskspezinok" });
    expect(k).toContain('<div id="eticketo"></div>');
    expect(k).toContain(`src="${ZAKLAD}/widget.js"`);
    expect(k).toContain('data-organizator="mskspezinok"');
    expect(k).toContain("defer");
    // Čo je predvolené, do úryvku nepatrí — nech je čo najkrajší.
    expect(k).not.toContain("data-pocet");
    expect(k).not.toContain("data-vzhlad");
    expect(k).not.toContain("data-farba");
    expect(k).not.toContain("data-rezim");
  });

  it("nepredvolené hodnoty doplní", () => {
    const k = uryvokKodu(ZAKLAD, {
      rezim: "tlacidlo",
      organizator: "mskspezinok",
      podujatie: UUID,
      pocet: 9,
      vzhlad: "tmavy",
      farba: "#112233",
    });
    expect(k).toContain('data-rezim="tlacidlo"');
    expect(k).toContain(`data-podujatie="${UUID}"`);
    expect(k).toContain('data-vzhlad="tmavy"');
    expect(k).toContain('data-farba="#112233"');
    // Pri jednom podujatí je počet bezpredmetný.
    expect(k).not.toContain("data-pocet");
  });

  it("neobsahuje nič, čo by sa dalo vložiť do cudzej stránky ako kód", () => {
    const k = uryvokKodu(ZAKLAD, {
      ...NASTAVENIA_PREDVOLENE,
      organizator: "mskspezinok",
      farba: "#fe6a00",
    });
    expect(k).not.toContain("</script><script>");
    expect(k.match(/<script/g)).toHaveLength(1);
  });
});
