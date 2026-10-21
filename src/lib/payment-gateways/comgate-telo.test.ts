import { describe, it, expect } from "vitest";
import {
  LIMITY,
  chybaSumy,
  jazykPreComgate,
  jeMena,
  mena,
  najmensiaJednotka,
  nasStav,
  popisKodu,
  popisPreVypis,
  postavCreate,
  postavRefund,
  precitajOdpoved,
  statPreMenu,
  type CreateVstup,
} from "./comgate-telo";

describe("mena", () => {
  it("prijme to, v čom predávame", () => {
    expect(mena("EUR")).toBe("EUR");
    expect(mena("czk")).toBe("CZK");
    expect(jeMena("CZK")).toBe(true);
  });

  it("odmietne menu, ktorú brána u nás nemá", () => {
    expect(() => mena("USD")).toThrow(/nepodporuje menu/);
    expect(() => mena("")).toThrow();
    expect(() => mena(null)).toThrow();
    expect(jeMena("USD")).toBe(false);
  });
});

describe("najmensiaJednotka", () => {
  it("prevedie na haliere a centy bez chyby zaokrúhlenia", () => {
    expect(najmensiaJednotka(10)).toBe(1000);
    expect(najmensiaJednotka(12.34)).toBe(1234);
    expect(najmensiaJednotka(19.99)).toBe(1999);
    expect(najmensiaJednotka(0.1)).toBe(10);
    expect(najmensiaJednotka(249.9)).toBe(24990);
  });

  it("odmietne nezmysel", () => {
    expect(() => najmensiaJednotka(Number.NaN)).toThrow();
    expect(() => najmensiaJednotka(-1)).toThrow();
  });
});

describe("chybaSumy", () => {
  it("drží limity ComGate pre EUR", () => {
    expect(chybaSumy(LIMITY.EUR.min, "EUR")).toBeNull();
    expect(chybaSumy(LIMITY.EUR.max, "EUR")).toBeNull();
    expect(chybaSumy(9, "EUR")).toMatch(/Najmenšia/);
    expect(chybaSumy(LIMITY.EUR.max + 1, "EUR")).toMatch(/Najväčšia/);
  });

  it("drží limity ComGate pre CZK", () => {
    // 1 Kč je minimum, 0,99 Kč už nie.
    expect(chybaSumy(100, "CZK")).toBeNull();
    expect(chybaSumy(99, "CZK")).toMatch(/Najmenšia/);
    expect(chybaSumy(100_000_000, "CZK")).toBeNull();
    expect(chybaSumy(100_000_001, "CZK")).toMatch(/Najväčšia/);
  });

  it("limity sú pre každú menu iné — 0,50 je v EUR málo, v CZK dosť", () => {
    expect(chybaSumy(50, "EUR")).toBeNull();
    expect(chybaSumy(50, "CZK")).toMatch(/Najmenšia/);
  });
});

describe("statPreMenu", () => {
  it("páruje menu so štátom, podľa ktorého brána ponúka metódy", () => {
    expect(statPreMenu("EUR")).toBe("SK");
    expect(statPreMenu("CZK")).toBe("CZ");
  });
});

describe("jazykPreComgate", () => {
  it("pozná naše jazyky", () => {
    expect(jazykPreComgate("sk")).toBe("sk");
    expect(jazykPreComgate("CS")).toBe("cs");
    expect(jazykPreComgate("hu-HU")).toBe("hu");
    expect(jazykPreComgate("de")).toBe("de");
  });

  it("na neznámy jazyk dá češtinu, teda default brány", () => {
    expect(jazykPreComgate("xx")).toBe("cs");
    expect(jazykPreComgate(null)).toBe("cs");
  });
});

describe("popisPreVypis", () => {
  it("skrátí názov na 16 znakov, ktoré brána dovolí", () => {
    expect(popisPreVypis("Vianočný koncert v kultúrnom dome", "Vstupenky")).toHaveLength(16);
    expect(popisPreVypis("Vianočný koncert v kultúrnom dome", "Vstupenky")).toBe(
      "Vianočný koncert",
    );
  });

  it("krátky názov nechá a zlúči biele znaky", () => {
    expect(popisPreVypis("  Silvester   2026 ", "x")).toBe("Silvester 2026");
  });

  it("bez názvu použije záložný text", () => {
    expect(popisPreVypis("", "Objednávka 12")).toBe("Objednávka 12");
    expect(popisPreVypis("   ", "Objednávka 12")).toBe("Objednávka 12");
  });
});

const VSTUP: CreateVstup = {
  jednotky: 3200,
  mena: "EUR",
  label: "Vianočný koncert",
  refId: "2026001",
  email: "kupujuci@example.test",
  telefon: "+421900123456",
  menoKupujuceho: "Jan Novák",
  jazyk: "sk",
  navratUrl: "https://eticketo.eu/checkout/abc",
  test: false,
};

describe("postavCreate", () => {
  it("pošle sumu v najmenšej jednotke a menu", () => {
    const t = postavCreate(VSTUP);
    expect(t.price).toBe(3200);
    expect(t.curr).toBe("EUR");
    expect(t.country).toBe("SK");
    expect(t.method).toBe("ALL");
    expect(t.lang).toBe("sk");
  });

  it("v korunách pošle CZ a CZK", () => {
    const t = postavCreate({ ...VSTUP, mena: "CZK", jednotky: 80000 });
    expect(t.curr).toBe("CZK");
    expect(t.country).toBe("CZ");
    expect(t.price).toBe(80000);
  });

  it("všetky tri návratové adresy sú naša stránka objednávky", () => {
    const t = postavCreate(VSTUP);
    expect(t.url_paid).toBe(VSTUP.navratUrl);
    expect(t.url_cancelled).toBe(VSTUP.navratUrl);
    expect(t.url_pending).toBe(VSTUP.navratUrl);
  });

  it("neposiela merchant, secret ani prepareOnly — v2 ich má v hlavičke", () => {
    const t = postavCreate(VSTUP);
    expect(t.merchant).toBeUndefined();
    expect(t.secret).toBeUndefined();
    expect(t.prepareOnly).toBeUndefined();
  });

  it("telefón v inom než medzinárodnom tvare neposiela", () => {
    expect(postavCreate({ ...VSTUP, telefon: "0900 123 456" }).phone).toBeUndefined();
    expect(postavCreate({ ...VSTUP, telefon: "+421900123456" }).phone).toBe("+421900123456");
  });

  it("bez e-mailu aj telefónu platbu nezaloží", () => {
    expect(() => postavCreate({ ...VSTUP, email: null, telefon: null })).toThrow(
      /e-mail alebo telefón/,
    );
    // S telefónom bez e-mailu je to v poriadku — brána chce aspoň jedno.
    expect(() => postavCreate({ ...VSTUP, email: null })).not.toThrow();
  });

  it("sumu mimo limitov odmietne tu, nie až v bráne", () => {
    expect(() => postavCreate({ ...VSTUP, jednotky: 5 })).toThrow(/Najmenšia/);
    expect(() => postavCreate({ ...VSTUP, jednotky: 5_000_000 })).toThrow(/Najväčšia/);
  });

  it("test je boolean, nie jednička", () => {
    expect(postavCreate({ ...VSTUP, test: true }).test).toBe(true);
    expect(postavCreate(VSTUP).test).toBe(false);
  });

  it("výsledok je serializovateľný JSON bez prázdnych polí", () => {
    const t = postavCreate({ ...VSTUP, menoKupujuceho: null, telefon: null });
    const json = JSON.parse(JSON.stringify(t));
    expect("fullName" in json).toBe(false);
    expect("phone" in json).toBe(false);
    expect(json.email).toBe(VSTUP.email);
  });
});

describe("postavRefund", () => {
  it("pošle sumu v najmenšej jednotke a príznak testu", () => {
    const t = postavRefund({ transId: "AB12-CD34-EF56", jednotky: 3200, test: false });
    expect(t).toMatchObject({ transId: "AB12-CD34-EF56", amount: 3200, test: false });
  });

  it("nulový ani negatívny refund neprejde", () => {
    expect(() => postavRefund({ transId: "x", jednotky: 0, test: false })).toThrow();
    expect(() => postavRefund({ transId: "x", jednotky: -100, test: false })).toThrow();
  });
});

describe("nasStav", () => {
  it("zaplatené je len PAID", () => {
    expect(nasStav("PAID")).toBe("paid");
    expect(nasStav("paid")).toBe("paid");
  });

  it("AUTHORIZED nie je zaplatené — peniaze ešte neprišli", () => {
    expect(nasStav("AUTHORIZED")).toBe("pending");
  });

  it("zrušené a čakajúce", () => {
    expect(nasStav("CANCELLED")).toBe("cancelled");
    expect(nasStav("PENDING")).toBe("pending");
  });

  it("neznámy stav nikdy nevyhodnotí ako zaplatený", () => {
    expect(nasStav("NIECO_NOVE")).toBe("pending");
    expect(nasStav(null)).toBe("pending");
    expect(nasStav(undefined)).toBe("pending");
    expect(nasStav(42)).toBe("pending");
  });
});

describe("precitajOdpoved a popisKodu", () => {
  it("nulový kód je v poriadku", () => {
    expect(precitajOdpoved({ code: 0, message: "OK" })).toEqual({ kod: 0, sprava: "OK" });
  });

  it("chýbajúci kód je chyba, nie úspech", () => {
    expect(precitajOdpoved({}).kod).toBe(-1);
    expect(precitajOdpoved(null).kod).toBe(-1);
  });

  it("známe kódy preloží do zrozumiteľnej vety", () => {
    expect(popisKodu(1301, "")).toMatch(/neznámy e-shop/);
    expect(popisKodu(1310, "")).toMatch(/neznáma mena/);
    expect(popisKodu(1402, "")).toMatch(/vyššia než povolená/);
  });

  it("neznámy kód ponechá hlášku brány", () => {
    expect(popisKodu(9999, "Nieco sa pokazilo")).toBe("ComGate 9999: Nieco sa pokazilo");
  });
});
