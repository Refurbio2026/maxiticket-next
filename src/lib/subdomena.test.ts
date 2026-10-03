import { describe, it, expect } from "vitest";
import {
  chybaSubdomeny,
  navrhSubdomeny,
  subdomenaZHosta,
  zakladnaDomena,
  REZERVOVANE_SUBDOMENY,
} from "./subdomena";

describe("tvar subdomény", () => {
  it("pustí bežný názov", () => {
    expect(chybaSubdomeny("bbd")).toBeNull();
    expect(chybaSubdomeny("mesto-trencin")).toBeNull();
    expect(chybaSubdomeny("divadlo2026")).toBeNull();
  });

  it("odmietne priveľmi krátke aj dlhé", () => {
    expect(chybaSubdomeny("ab")).toMatch(/aspoň 3/);
    expect(chybaSubdomeny("a".repeat(33))).toMatch(/najviac 32/);
  });

  it("odmietne spojovník na kraji a nedovolené znaky", () => {
    expect(chybaSubdomeny("-bbd")).toMatch(/spojovník/);
    expect(chybaSubdomeny("bbd-")).toMatch(/spojovník/);
    expect(chybaSubdomeny("bábkové")).not.toBeNull();
    expect(chybaSubdomeny("BBD")).toBeNull(); // veľké písmená sa znížia
    expect(chybaSubdomeny("bbd.eu")).not.toBeNull();
    expect(chybaSubdomeny("bbd_eu")).not.toBeNull();
  });

  it("odmietne rezervované názvy", () => {
    for (const r of ["www", "admin", "api", "scanner", "checkout", "eticketo"]) {
      expect(chybaSubdomeny(r)).toMatch(/rezervovaná/);
    }
  });

  it("prázdny vstup je chyba, nie ticho", () => {
    expect(chybaSubdomeny("")).not.toBeNull();
    expect(chybaSubdomeny("   ")).not.toBeNull();
  });
});

describe("návrh subdomény z názvu", () => {
  it("zhodí diakritiku a medzery", () => {
    expect(navrhSubdomeny("Bratislavské bábkové divadlo")).toBe("bratislavske-babkove-divadlo");
    expect(navrhSubdomeny("Mesto Trenčín")).toBe("mesto-trencin");
  });

  it("nenavrhne nepoužiteľný tvar", () => {
    expect(navrhSubdomeny("A")).toBe("");
    expect(navrhSubdomeny("!!!")).toBe("");
    // Návrh nesmie skončiť spojovníkom ani byť rezervovaný.
    expect(navrhSubdomeny("Shop")).not.toBe("shop");
    const dlhy = navrhSubdomeny("Mestské kultúrne stredisko Šamorín a okolie navyše");
    expect(dlhy.length).toBeLessThanOrEqual(32);
    expect(dlhy.endsWith("-")).toBe(false);
    expect(chybaSubdomeny(dlhy)).toBeNull();
  });

  it("každý návrh prejde vlastnou validáciou", () => {
    for (const nazov of ["Divadlo Wonderland", "y4", "MDTN", "Mesto Trenčín", "Herogame"]) {
      const n = navrhSubdomeny(nazov);
      if (n) expect(chybaSubdomeny(n)).toBeNull();
    }
  });
});

describe("základná doména", () => {
  it("odstrihne protokol, port aj www", () => {
    expect(zakladnaDomena("https://eticketo.eu")).toBe("eticketo.eu");
    expect(zakladnaDomena("https://www.eticketo.eu/")).toBe("eticketo.eu");
    expect(zakladnaDomena("http://localhost:3000")).toBe("localhost");
  });
});

describe("subdoména z hlavičky Host", () => {
  const adresa = "https://eticketo.eu";

  it("hlavná adresa nie je subdoména", () => {
    expect(subdomenaZHosta("eticketo.eu", adresa)).toBeNull();
    expect(subdomenaZHosta("www.eticketo.eu", adresa)).toBeNull();
    expect(subdomenaZHosta("eticketo.eu:443", adresa)).toBeNull();
  });

  it("prečíta subdoménu organizátora", () => {
    expect(subdomenaZHosta("bbd.eticketo.eu", adresa)).toBe("bbd");
    expect(subdomenaZHosta("BBD.ETICKETO.EU", adresa)).toBe("bbd");
    expect(subdomenaZHosta("mesto-trencin.eticketo.eu:443", adresa)).toBe("mesto-trencin");
  });

  it("cudziu domému ani viacúrovňové meno nepreberie", () => {
    // Cudzí Host nesmie prepnúť obchod na organizátora.
    expect(subdomenaZHosta("bbd.utocnik.sk", adresa)).toBeNull();
    expect(subdomenaZHosta("bbd.eticketo.eu.utocnik.sk", adresa)).toBeNull();
    // Wildcard certifikát viacúrovňové meno nepokrýva, takže ho neuznávame.
    expect(subdomenaZHosta("a.b.eticketo.eu", adresa)).toBeNull();
  });

  it("rezervované názvy sa neberú ako organizátor", () => {
    for (const r of REZERVOVANE_SUBDOMENY.slice(0, 10)) {
      expect(subdomenaZHosta(`${r}.eticketo.eu`, adresa)).toBeNull();
    }
  });

  it("chýbajúci Host nepadne", () => {
    expect(subdomenaZHosta(null, adresa)).toBeNull();
    expect(subdomenaZHosta(undefined, adresa)).toBeNull();
    expect(subdomenaZHosta("", adresa)).toBeNull();
  });
});
