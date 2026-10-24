import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { adresa, hash, popisChyby, precitajDetail, precitajNavrhy } from "./finstat";

// Ukážkové hodnoty z dokumentácie FinStatu. Privátny kľúč v nej uvedený nie je
// priamo, ale `YourPrivateKey` dáva **presne tie hashe**, ktoré sú v ich
// príkladoch — čím je overené, že náš výpočet sedí s ich vlastným.
const PRISTUPY = { apiKey: "YourAPIKey", privateKey: "YourPrivateKey" };

describe("hash — overený proti príkladom z dokumentácie FinStatu", () => {
  it("autocomplete pre query 'test'", () => {
    expect(hash(PRISTUPY.apiKey, PRISTUPY.privateKey, "test")).toBe(
      "63678854b4b02034b4127cd9188b3a514b67e054465e3b8d4dd5284c46f7c099",
    );
  });

  it("detail pre ico 47165367", () => {
    expect(hash(PRISTUPY.apiKey, PRISTUPY.privateKey, "47165367")).toBe(
      "a85aff26f1d2aae0059ec051866daa6246374d65da4a2c289d9ce8cbcd73a7b5",
    );
  });

  it("dve plus za privátnym kľúčom sú podstatné", () => {
    // Keby tam bolo jedno, hash by bol iný a FinStat by vrátil 403.
    const spravny = hash("a", "b", "c");
    const zlyZaklad = crypto
      .createHash("sha256")
      .update("SomeSalt+a+b+c+ended", "utf8")
      .digest("hex");
    expect(spravny).not.toBe(zlyZaklad);
  });

  it("je to malými písmenami, ako ich PHP vzor", () => {
    const h = hash("a", "b", "c");
    expect(h).toBe(h.toLowerCase());
    expect(h).toHaveLength(64);
  });
});

describe("adresa", () => {
  it("detail posiela ico, kľúč a hash", () => {
    const u = new URL(adresa("detail", "47165367", PRISTUPY));
    expect(u.origin + u.pathname).toBe("https://www.finstat.sk/api/detail.json");
    expect(u.searchParams.get("ico")).toBe("47165367");
    expect(u.searchParams.get("apiKey")).toBe("YourAPIKey");
    expect(u.searchParams.get("hash")).toBe(
      "a85aff26f1d2aae0059ec051866daa6246374d65da4a2c289d9ce8cbcd73a7b5",
    );
  });

  it("autocomplete posiela query a hash z query", () => {
    const u = new URL(adresa("autocomplete", "test", PRISTUPY));
    expect(u.pathname).toBe("/api/autocomplete.json");
    expect(u.searchParams.get("query")).toBe("test");
    expect(u.searchParams.get("hash")).toBe(
      "63678854b4b02034b4127cd9188b3a514b67e054465e3b8d4dd5284c46f7c099",
    );
  });

  it("privátny kľúč sa do adresy NIKDY nedostane", () => {
    const u = adresa("detail", "47165367", PRISTUPY);
    expect(u).not.toContain("YourPrivateKey");
    expect(u).not.toContain("privateKey");
  });

  it("označenie stanice pošle len keď je vyplnené", () => {
    expect(adresa("detail", "1", PRISTUPY)).not.toContain("StationId");
    const s = adresa("detail", "1", { ...PRISTUPY, stationId: "eticketo", stationName: "web" });
    expect(s).toContain("StationId=eticketo");
    expect(s).toContain("StationName=web");
  });

  it("diakritiku v názve zakóduje", () => {
    const u = new URL(adresa("autocomplete", "Žilinská teplárenská", PRISTUPY));
    expect(u.searchParams.get("query")).toBe("Žilinská teplárenská");
    expect(u.toString()).not.toContain(" ");
  });
});

describe("precitajDetail", () => {
  // Tvar podľa `common/responses/basic-en.md`.
  const ODPOVED = {
    Ico: "47165367",
    Dic: "2023749964",
    IcDPH: "SK2023749964",
    Name: "Skúšobná firma s.r.o.",
    Street: "Drevárska",
    StreetNumber: "23",
    ZipCode: "902 01",
    City: "Pezinok",
    Country: "",
    Url: "https://www.finstat.sk/47165367",
  };

  it("prečíta to, čo RPO nedá — DIČ a IČ DPH", () => {
    const f = precitajDetail(ODPOVED);
    expect(f?.dic).toBe("2023749964");
    expect(f?.ic_dph).toBe("SK2023749964");
    expect(f?.zdroj).toBe("finstat");
  });

  it("zloží ulicu s číslom", () => {
    expect(precitajDetail(ODPOVED)?.ulica).toBe("Drevárska 23");
  });

  it("prázdna krajina znamená Slovensko — tak to má dokumentácia", () => {
    expect(precitajDetail(ODPOVED)?.stat).toBe("SK");
    expect(precitajDetail({ ...ODPOVED, Country: "Česká republika" })?.stat).toBe(
      "Česká republika",
    );
  });

  it("chýbajúce polia nevyrobia prázdne reťazce", () => {
    const f = precitajDetail({ Ico: "47165367", Name: "Len názov" });
    expect(f?.dic).toBeNull();
    expect(f?.ic_dph).toBeNull();
    expect(f?.ulica).toBeNull();
    expect(f?.mesto).toBeNull();
  });

  it("prázdnu odpoveď zahodí", () => {
    expect(precitajDetail({})).toBeNull();
    expect(precitajDetail(null)).toBeNull();
  });
});

describe("precitajNavrhy", () => {
  const ODPOVED = {
    Results: [
      { Ico: "47165367", Name: "Prvá firma s.r.o.", City: "Pezinok", Cancelled: false },
      { Ico: "12345678", Name: "Zrušená firma s.r.o.", City: "Bratislava", Cancelled: true },
    ],
    Suggestions: ["Prvá firma", "Zrušená firma"],
  };

  it("vráti návrhy s mestom", () => {
    const n = precitajNavrhy(ODPOVED);
    expect(n).toHaveLength(2);
    expect(n[0]).toMatchObject({ ico: "47165367", nazov: "Prvá firma s.r.o.", mesto: "Pezinok" });
  });

  it("zrušenú firmu nezahodí, len označí", () => {
    // Kupovať na firmu, ktorá sa ruší, sa dá — nech to nezmizne bez vysvetlenia.
    expect(precitajNavrhy(ODPOVED)[1].zrusena).toBe(true);
    expect(
      precitajNavrhy({ Results: [{ Ico: "1", Name: "X", Cancelled: "true" }] })[0].zrusena,
    ).toBe(true);
  });

  it("prázdna odpoveď dá prázdny zoznam", () => {
    expect(precitajNavrhy({ Results: [] })).toEqual([]);
    expect(precitajNavrhy({})).toEqual([]);
    expect(precitajNavrhy(null)).toEqual([]);
  });

  it("nečitateľné položky preskočí", () => {
    expect(precitajNavrhy({ Results: [{}, null, ODPOVED.Results[0]] })).toHaveLength(1);
  });
});

describe("popisChyby", () => {
  it("rozlíši vyčerpaný limit od zlého kľúča", () => {
    expect(popisChyby(402)).toMatch(/limit/);
    expect(popisChyby(403)).toMatch(/kľúč|hash/);
    expect(popisChyby(429)).toMatch(/za sekundu/);
    expect(popisChyby(500)).toContain("500");
  });
});
