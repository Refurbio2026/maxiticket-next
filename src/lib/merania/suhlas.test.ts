import { describe, it, expect } from "vitest";
import {
  googleConsent,
  precitajSuhlas,
  smieSa,
  VERZIA_SUHLASU,
  VSETKO_ANO,
  VSETKO_NIE,
  zapisSuhlas,
  type Suhlas,
} from "./suhlas";

const plny: Suhlas = {
  verzia: VERZIA_SUHLASU,
  analytika: true,
  marketing: true,
  kedy: "2026-10-29T10:00:00.000Z",
};

describe("čítanie súhlasu", () => {
  it("prečíta, čo sa zapísalo", () => {
    const raw = zapisSuhlas(VSETKO_ANO, "2026-10-29T10:00:00.000Z");
    expect(precitajSuhlas(raw)).toEqual(plny);
  });

  it("nič uložené = nerozhodnuté, nie nesúhlas", () => {
    expect(precitajSuhlas(null)).toBeNull();
    expect(precitajSuhlas("")).toBeNull();
    expect(precitajSuhlas(undefined)).toBeNull();
  });

  it("poškodený zápis je nerozhodnuté", () => {
    expect(precitajSuhlas("{nie json")).toBeNull();
    expect(precitajSuhlas("null")).toBeNull();
    expect(precitajSuhlas('"text"')).toBeNull();
  });

  it("starší súhlas sa neuzná — pri novom merači sa treba spýtať znova", () => {
    const stary = JSON.stringify({ verzia: VERZIA_SUHLASU - 1, analytika: true, marketing: true });
    expect(precitajSuhlas(stary)).toBeNull();
  });

  it("chýbajúce alebo nesprávne typy sú nerozhodnuté", () => {
    expect(precitajSuhlas(JSON.stringify({ verzia: VERZIA_SUHLASU, analytika: "ano" }))).toBeNull();
    expect(precitajSuhlas(JSON.stringify({ verzia: VERZIA_SUHLASU, marketing: true }))).toBeNull();
  });

  it("chýbajúci čas sa doplní, zvyšok zostane", () => {
    const s = precitajSuhlas(
      JSON.stringify({ verzia: VERZIA_SUHLASU, analytika: true, marketing: false }),
    );
    expect(s?.analytika).toBe(true);
    expect(s?.marketing).toBe(false);
    expect(typeof s?.kedy).toBe("string");
  });
});

describe("čo sa smie spustiť", () => {
  it("nutné platia vždy, aj bez rozhodnutia", () => {
    expect(smieSa(null, "nutne")).toBe(true);
  });

  it("bez rozhodnutia sa nespustí nič navyše", () => {
    expect(smieSa(null, "analytika")).toBe(false);
    expect(smieSa(null, "marketing")).toBe(false);
  });

  it("odmietnutie znamená nie", () => {
    const s = precitajSuhlas(zapisSuhlas(VSETKO_NIE))!;
    expect(smieSa(s, "analytika")).toBe(false);
    expect(smieSa(s, "marketing")).toBe(false);
    expect(smieSa(s, "nutne")).toBe(true);
  });

  it("kategórie sa nepomiešajú", () => {
    const s = precitajSuhlas(zapisSuhlas({ analytika: true, marketing: false }))!;
    expect(smieSa(s, "analytika")).toBe(true);
    expect(smieSa(s, "marketing")).toBe(false);
  });
});

describe("Google Consent Mode v2", () => {
  it("pri súhlase so všetkým je všetko granted", () => {
    const g = googleConsent(plny);
    expect(g.ad_storage).toBe("granted");
    expect(g.analytics_storage).toBe("granted");
    expect(g.ad_user_data).toBe("granted");
    expect(g.ad_personalization).toBe("granted");
  });

  it("bez rozhodnutia je reklama aj analytika denied, nie chýbajúca", () => {
    const g = googleConsent(null);
    expect(g.ad_storage).toBe("denied");
    expect(g.analytics_storage).toBe("denied");
    // Keby sa nepošlo nič, Google si predvolí granted — preto musia byť vždy.
    expect(Object.keys(g).sort()).toEqual([
      "ad_personalization",
      "ad_storage",
      "ad_user_data",
      "analytics_storage",
      "functionality_storage",
      "security_storage",
    ]);
  });

  it("samotná analytika nepovolí reklamu", () => {
    const g = googleConsent(precitajSuhlas(zapisSuhlas({ analytika: true, marketing: false })));
    expect(g.analytics_storage).toBe("granted");
    expect(g.ad_storage).toBe("denied");
    expect(g.ad_personalization).toBe("denied");
  });

  it("chod stránky a bezpečnosť sú povolené vždy", () => {
    for (const s of [null, precitajSuhlas(zapisSuhlas(VSETKO_NIE))]) {
      const g = googleConsent(s);
      expect(g.functionality_storage).toBe("granted");
      expect(g.security_storage).toBe("granted");
    }
  });
});
