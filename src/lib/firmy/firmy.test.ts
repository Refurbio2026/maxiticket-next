import { describe, it, expect } from "vitest";
import {
  adresaJedenRiadok,
  druhDotazu,
  naFormular,
  normalizujDic,
  normalizujIcDph,
  normalizujIco,
  platneIco,
  zlucFirmy,
  type Firma,
} from "./firmy";

describe("normalizujIco", () => {
  it("nechá len číslice — ľudia IČO píšu s medzerami", () => {
    expect(normalizujIco("00 305 022")).toBe("00305022");
    expect(normalizujIco("53251580")).toBe("53251580");
    expect(normalizujIco("IČO: 53 251 580")).toBe("53251580");
    expect(normalizujIco(null)).toBe("");
  });
});

describe("platneIco", () => {
  it("prijme skutočné IČO", () => {
    // MaxiTicket s.r.o. a MsKS Pezinok — overené v registri.
    expect(platneIco("53251580")).toBe(true);
    expect(platneIco("00305022")).toBe(true);
    expect(platneIco("00 305 022")).toBe(true);
  });

  it("odhalí preklep v poslednej číslici", () => {
    expect(platneIco("53251581")).toBe(false);
    expect(platneIco("53251589")).toBe(false);
  });

  it("odhalí prehodené číslice", () => {
    // Najčastejší preklep pri prepisovaní z výpisu.
    expect(platneIco("53215580")).toBe(false);
    expect(platneIco("00350022")).toBe(false);
  });

  it("odmietne nesprávnu dĺžku a nezmysly", () => {
    expect(platneIco("1234567")).toBe(false);
    expect(platneIco("123456789")).toBe(false);
    expect(platneIco("")).toBe(false);
    expect(platneIco("abcdefgh")).toBe(false);
    expect(platneIco(undefined)).toBe(false);
    expect(platneIco(53251580)).toBe(false);
  });

  it("zvládne aj IČO so zostatkom 0 a 1 vo výpočte", () => {
    // Tieto dve vetvy algoritmu sa ľahko pokazia, preto zvlášť.
    // 00000019: súčet 0*8..1*2 = 2 → zostatok 2 → číslica 9.
    expect(platneIco("00000019")).toBe(true);
    // 00000027: súčet 2*2 = 4 → zostatok 4 → číslica 7.
    expect(platneIco("00000027")).toBe(true);
  });
});

describe("normalizujIcDph", () => {
  it("rozloží na štát a číslo", () => {
    expect(normalizujIcDph("SK2020662889")).toEqual({ stat: "SK", cislo: "2020662889" });
    expect(normalizujIcDph("sk 2020 662 889")).toEqual({ stat: "SK", cislo: "2020662889" });
    expect(normalizujIcDph("CZ12345678")).toEqual({ stat: "CZ", cislo: "12345678" });
  });

  it("odmietne, čo nie je IČ DPH", () => {
    expect(normalizujIcDph("2020662889")).toBeNull(); // bez štátu je to DIČ
    expect(normalizujIcDph("")).toBeNull();
    expect(normalizujIcDph(null)).toBeNull();
  });
});

describe("normalizujDic", () => {
  it("DIČ je desať číslic", () => {
    expect(normalizujDic("2020662889")).toBe("2020662889");
    expect(normalizujDic("2020 662 889")).toBe("2020662889");
  });

  it("predponu štátu odstrihne — ľudia tam vložia IČ DPH", () => {
    // Pri slovenskej firme je to to isté číslo, takže odmietnuť by bolo
    // formálne správne a prakticky otravné.
    expect(normalizujDic("SK2020662889")).toBe("2020662889");
  });

  it("odmietne, čo DIČ nie je", () => {
    expect(normalizujDic("12345")).toBeNull();
    expect(normalizujDic("")).toBeNull();
    expect(normalizujDic(null)).toBeNull();
  });
});

describe("druhDotazu", () => {
  it("osem číslic je IČO", () => {
    expect(druhDotazu("53251580")).toBe("ico");
    expect(druhDotazu("00 305 022")).toBe("ico");
  });

  it("s predponou štátu je to IČ DPH", () => {
    expect(druhDotazu("SK2020662889")).toBe("ic_dph");
  });

  it("zvyšok je názov", () => {
    expect(druhDotazu("MsKS Pezinok")).toBe("nazov");
    expect(druhDotazu("Maxi")).toBe("nazov");
    // Päť číslic nie je IČO, takže sa hľadá ako text.
    expect(druhDotazu("12345")).toBe("nazov");
  });

  it("krátky vstup sa nehľadá vôbec", () => {
    expect(druhDotazu("M")).toBe("prazdne");
    expect(druhDotazu(" ")).toBe("prazdne");
    expect(druhDotazu(null)).toBe("prazdne");
  });
});

const FIRMA: Firma = {
  nazov: "MaxiTicket s.r.o.",
  ico: "53251580",
  dic: null,
  ic_dph: null,
  ulica: "Drevárska 23",
  mesto: "Pezinok",
  psc: "902 01",
  stat: "SK",
  zdroj: "rpo",
  registracia: "Mestský súd Bratislava III, Sro 170046/B",
};

describe("adresaJedenRiadok", () => {
  it("zloží adresu na zobrazenie", () => {
    expect(adresaJedenRiadok(FIRMA)).toBe("Drevárska 23, 902 01 Pezinok");
  });

  it("zvládne chýbajúce časti", () => {
    expect(adresaJedenRiadok({ ulica: null, psc: null, mesto: "Pezinok" })).toBe("Pezinok");
    expect(adresaJedenRiadok({ ulica: null, psc: null, mesto: null })).toBe("");
  });
});

describe("zlucFirmy", () => {
  it("doplní, čo prvý zdroj nevie", () => {
    const v = zlucFirmy(FIRMA, { dic: "2121334455", ic_dph: "SK2121334455" });
    expect(v.dic).toBe("2121334455");
    expect(v.ic_dph).toBe("SK2121334455");
    // Pôvodné údaje zostanú.
    expect(v.nazov).toBe("MaxiTicket s.r.o.");
    expect(v.ulica).toBe("Drevárska 23");
  });

  it("nikdy neprepíše vyplnené prázdnym", () => {
    const v = zlucFirmy(FIRMA, { ulica: "", mesto: null, nazov: undefined });
    expect(v.ulica).toBe("Drevárska 23");
    expect(v.mesto).toBe("Pezinok");
    expect(v.nazov).toBe("MaxiTicket s.r.o.");
  });

  it("bez doplnku vráti základ nedotknutý", () => {
    expect(zlucFirmy(FIRMA, null)).toEqual(FIRMA);
  });
});

describe("naFormular", () => {
  it("prázdne hodnoty dá ako prázdny text, nie ako null", () => {
    const f = naFormular(FIRMA);
    expect(f).toEqual({
      name: "MaxiTicket s.r.o.",
      ico: "53251580",
      dic: "",
      ic_dph: "",
      street: "Drevárska 23",
      city: "Pezinok",
      zip: "902 01",
    });
  });
});
