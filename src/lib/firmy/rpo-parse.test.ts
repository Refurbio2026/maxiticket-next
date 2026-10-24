// Testy na skutočnej odpovedi RPO.
//
// Dáta nižšie sú **naozajstná odpoveď** api.statistics.sk na IČO 53251580,
// skrátená len o polia, ktoré nepoužívame. Podstatné je, že MaxiTicket má
// v registri tri adresy — dve už neplatné (Trnava, Kučišdorfská dolina) —
// takže keby sa bral prvý prvok, firma by dostala starú adresu.
import { describe, it, expect } from "vitest";
import { aktualny, precitajOdpoved, precitajVysledok, zapisVRegistri } from "./rpo-parse";

const ODPOVED_RPO = {
  results: [
    {
      id: 14953967,
      identifiers: [{ value: "53251580", validFrom: "2020-10-27" }],
      fullNames: [{ value: "MaxiTicket s.r.o.", validFrom: "2020-10-27" }],
      addresses: [
        {
          validFrom: "2023-05-23",
          street: "Drevárska",
          buildingNumber: "23",
          postalCodes: ["902 01"],
          municipality: { value: "Pezinok" },
          country: { value: "Slovenská republika" },
        },
        {
          validFrom: "2022-06-02",
          validTo: "2023-05-22",
          street: "Dolné bašty",
          buildingNumber: "7434/3A",
          postalCodes: ["917 01"],
          municipality: { value: "Trnava" },
          country: { value: "Slovenská republika" },
        },
        {
          validFrom: "2020-10-27",
          validTo: "2022-06-01",
          street: "Kučišdorfská dolina",
          buildingNumber: "4",
          postalCodes: ["90201"],
          municipality: { value: "Pezinok" },
          country: { value: "Slovenská republika" },
        },
      ],
      sourceRegister: {
        registrationOffices: [{ value: "Mestský súd Bratislava III", validFrom: "2020-10-27" }],
        registrationNumbers: [{ value: "Sro/170046/B", validFrom: "2020-10-27" }],
      },
    },
  ],
};

describe("aktualny", () => {
  it("vyberie záznam bez konca platnosti", () => {
    const v = aktualny<{ value: string; validFrom?: string; validTo?: string }>([
      { value: "stará", validFrom: "2020-01-01", validTo: "2022-01-01" },
      { value: "nová", validFrom: "2022-01-02" },
    ]);
    expect(v?.value).toBe("nová");
  });

  it("z viacerých otvorených vezme najnovšiu", () => {
    const v = aktualny<{ value: string; validFrom?: string }>([
      { value: "staršia", validFrom: "2020-01-01" },
      { value: "najnovšia", validFrom: "2024-06-01" },
    ]);
    expect(v?.value).toBe("najnovšia");
  });

  it("keď sú všetky ukončené, vezme najnovšiu — lepšie než nič", () => {
    const v = aktualny<{ value: string; validFrom?: string; validTo?: string }>([
      { value: "A", validFrom: "2019-01-01", validTo: "2020-01-01" },
      { value: "B", validFrom: "2021-01-01", validTo: "2022-01-01" },
    ]);
    expect(v?.value).toBe("B");
  });

  it("prázdny alebo nezmyselný vstup nespadne", () => {
    expect(aktualny([])).toBeNull();
    expect(aktualny(null)).toBeNull();
    expect(aktualny("nie pole")).toBeNull();
  });
});

describe("zapisVRegistri", () => {
  it("rozloží oddiel a vložku na čitateľnú vetu", () => {
    expect(zapisVRegistri("Mestský súd Bratislava III", "Sro/170046/B")).toBe(
      "Obchodný register Mestský súd Bratislava III, oddiel Sro, vložka č. 170046/B",
    );
  });

  it("zvládne neznámy tvar čísla aj chýbajúce časti", () => {
    expect(zapisVRegistri("Mestský súd Bratislava III", null)).toBe(
      "Obchodný register Mestský súd Bratislava III",
    );
    expect(zapisVRegistri(null, "12345/B")).toBe("12345/B");
    expect(zapisVRegistri(null, null)).toBeNull();
  });
});

describe("precitajVysledok na skutočnej odpovedi", () => {
  const f = precitajVysledok(ODPOVED_RPO.results[0]);

  it("prečíta názov a IČO", () => {
    expect(f?.nazov).toBe("MaxiTicket s.r.o.");
    expect(f?.ico).toBe("53251580");
  });

  it("vezme PLATNÚ adresu, nie prvú v poli", () => {
    // Toto je celý dôvod, prečo tento modul existuje.
    expect(f?.ulica).toBe("Drevárska 23");
    expect(f?.mesto).toBe("Pezinok");
    expect(f?.psc).toBe("902 01");
    // Trnava je stará adresa a nesmie sa objaviť.
    expect(JSON.stringify(f)).not.toContain("Trnava");
    expect(JSON.stringify(f)).not.toContain("Kučišdorfská");
  });

  it("prečíta zápis v obchodnom registri", () => {
    expect(f?.registracia).toContain("Mestský súd Bratislava III");
    expect(f?.registracia).toContain("170046/B");
  });

  it("DIČ ani IČ DPH nepredstiera — register ich nedáva", () => {
    expect(f?.dic).toBeNull();
    expect(f?.ic_dph).toBeNull();
    expect(f?.zdroj).toBe("rpo");
  });
});

describe("precitajVysledok na neúplných dátach", () => {
  it("firma bez adresy prejde, len bez adresy", () => {
    const f = precitajVysledok({
      identifiers: [{ value: "00305022" }],
      fullNames: [{ value: "MsKS Pezinok" }],
    });
    expect(f?.ico).toBe("00305022");
    expect(f?.ulica).toBeNull();
    expect(f?.mesto).toBeNull();
  });

  it("záznam bez IČO aj bez názvu sa zahodí", () => {
    expect(precitajVysledok({})).toBeNull();
    expect(precitajVysledok(null)).toBeNull();
  });
});

describe("precitajOdpoved", () => {
  it("vráti zoznam firiem", () => {
    const z = precitajOdpoved(ODPOVED_RPO);
    expect(z).toHaveLength(1);
    expect(z[0].nazov).toBe("MaxiTicket s.r.o.");
  });

  it("prázdna odpoveď dá prázdny zoznam, nie chybu", () => {
    expect(precitajOdpoved({ results: [] })).toEqual([]);
    expect(precitajOdpoved({})).toEqual([]);
    expect(precitajOdpoved(null)).toEqual([]);
  });

  it("nečitateľné záznamy preskočí a ostatné vráti", () => {
    const z = precitajOdpoved({
      results: [{}, ODPOVED_RPO.results[0], null],
    });
    expect(z).toHaveLength(1);
  });
});
