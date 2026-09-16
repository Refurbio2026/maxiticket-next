import { describe, it, expect } from "vitest";
import {
  normalizujSumu,
  zCentov,
  normalizujSymbol,
  rozlozReferenciu,
  vsZPopisu,
  maskujKartu,
  maskujIban,
  normalizujIban,
} from "./normalize";

describe("normalizácia sumy", () => {
  it("prečíta bežné tvary z výpisov", () => {
    expect(normalizujSumu("27,70")).toBe(27.7);
    expect(normalizujSumu("27.70")).toBe(27.7);
    expect(normalizujSumu("1 234,56")).toBe(1234.56);
    expect(normalizujSumu("1.234,56")).toBe(1234.56);
    expect(normalizujSumu("1,234.56")).toBe(1234.56);
    expect(normalizujSumu("27,70 EUR")).toBe(27.7);
    expect(normalizujSumu(27.7)).toBe(27.7);
  });

  it("rozumie zápornej sume pred aj za číslom", () => {
    expect(normalizujSumu("-25,00")).toBe(-25);
    expect(normalizujSumu("25,00-")).toBe(-25);
  });

  // Jediná bodka s tromi číslicami za ňou je oddeľovač tisícov. Bez tejto
  // konvencie by sa „1.234" prečítalo ako 1,23 € namiesto 1 234 €.
  it("rozlíši tisícovú bodku od desatinnej", () => {
    expect(normalizujSumu("1.234")).toBe(1234);
    expect(normalizujSumu("27.70")).toBe(27.7);
    expect(normalizujSumu("27.7")).toBe(27.7);
  });

  it("nevyrobí nulu z nečitateľnej hodnoty", () => {
    // Nula by sa tvárila ako platná transakcia a spárovala objednávku zadarmo.
    expect(normalizujSumu("n/a")).toBeNull();
    expect(normalizujSumu("")).toBeNull();
    expect(normalizujSumu(null)).toBeNull();
  });

  it("prevedie centy z GoPay REST", () => {
    expect(zCentov(2500)).toBe(25);
    expect(zCentov("2770")).toBe(27.7);
  });
});

describe("normalizácia symbolov", () => {
  it("doplní nuly zľava na desať znakov", () => {
    expect(normalizujSymbol("15501234")).toBe("0015501234");
    expect(normalizujSymbol(15501234)).toBe("0015501234");
    expect(normalizujSymbol("0015501234")).toBe("0015501234");
  });

  it("konštantný symbol má štyri znaky", () => {
    expect(normalizujSymbol("308", 4)).toBe("0308");
  });

  // Orezaný symbol by sa mohol zhodovať s cudzou objednávkou.
  it("dlhší symbol neoreže", () => {
    expect(normalizujSymbol("123456789012")).toBe("123456789012");
  });

  it("samé nuly a prázdno sú nevyplnené", () => {
    expect(normalizujSymbol("0000000000")).toBeNull();
    expect(normalizujSymbol("")).toBeNull();
    expect(normalizujSymbol(null)).toBeNull();
  });
});

describe("referencia platiteľa", () => {
  it("rozloží /VS/SS/KS", () => {
    expect(rozlozReferenciu("/VS0015501234/SS0145000029/KS0308")).toEqual({
      vs: "0015501234",
      ss: "0145000029",
      ks: "0308",
    });
  });

  it("znesie vynechané časti", () => {
    expect(rozlozReferenciu("/VS15501234/SS/KS0308")).toEqual({
      vs: "0015501234",
      ss: null,
      ks: "0308",
    });
  });

  it("z prázdneho vstupu nič nevymyslí", () => {
    expect(rozlozReferenciu(null)).toEqual({ vs: null, ss: null, ks: null });
  });
});

describe("variabilný symbol z popisu", () => {
  it("nájde osem- až desaťmiestne číslo", () => {
    expect(vsZPopisu("vstupenky 15501234")).toBe("0015501234");
    expect(vsZPopisu("Platba za objednavku c. 0015501234, dakujeme")).toBe("0015501234");
  });

  // Hádať medzi dvoma číslami je horšie než poslať platbu človeku.
  it("pri dvoch rôznych číslach radšej nič", () => {
    expect(vsZPopisu("objednavka 15501234 faktura 98765432")).toBeNull();
  });

  it("krátke čísla ignoruje", () => {
    expect(vsZPopisu("platba 3.3.2026 suma 2770")).toBeNull();
  });
});

describe("maskovanie citlivých údajov", () => {
  it("nechá z karty poslednú štvoricu", () => {
    expect(maskujKartu("platba kartou 4111111111111111 dakujeme")).toBe(
      "platba kartou ••••1111 dakujeme",
    );
  });

  it("variabilný symbol nie je karta", () => {
    expect(maskujKartu("VS 0015501234")).toBe("VS 0015501234");
  });

  it("IBAN do logu skracuje", () => {
    expect(maskujIban("SK00 0900 0000 0000 8765 4321")).toBe("SK00…4321");
    expect(maskujIban(null)).toBe("—");
  });

  it("IBAN zjednotí na tvar bez medzier", () => {
    expect(normalizujIban("sk00 0900 0000 0000 8765 4321")).toBe("SK0009000000000087654321");
  });
});
