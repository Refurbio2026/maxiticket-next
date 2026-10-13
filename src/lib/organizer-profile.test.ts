import { describe, expect, it } from "vitest";
import { chybaNaZiadost, chybaPredPredajom, formatujIban, platnyIban } from "./organizer-profile";

describe("platnyIban", () => {
  it("prijme platné slovenské číslo aj s medzerami", () => {
    expect(platnyIban("SK3112000000198742637541")).toBe(true);
    expect(platnyIban("SK31 1200 0000 1987 4263 7541")).toBe(true);
  });

  it("odmietne preklep v kontrolnej číslici", () => {
    expect(platnyIban("SK3212000000198742637541")).toBe(false);
  });

  it("odmietne nezmysel", () => {
    expect(platnyIban("")).toBe(false);
    expect(platnyIban("SK12")).toBe(false);
    expect(platnyIban("1234567890")).toBe(false);
  });

  it("naformátuje po štvorčekoch", () => {
    expect(formatujIban("sk3112000000198742637541")).toBe("SK31 1200 0000 1987 4263 7541");
  });
});

describe("kontrola pripravenosti", () => {
  const plny = {
    display_name: "Amfiteáter Zvolen",
    subdomain: "amfiteater-zvolen",
    company_name: "Amfiteáter s. r. o.",
    ico: "12345678",
    billing_address: "Námestie 1, Zvolen",
    phone: "+421900000000",
    terms_accepted_at: "2026-10-02T10:00:00Z",
  };

  it("plný profil nemá čo doplniť na žiadosť", () => {
    expect(chybaNaZiadost(plny)).toEqual([]);
  });

  it("vymenuje chýbajúce polia", () => {
    const chyby = chybaNaZiadost({ ...plny, ico: "  ", terms_accepted_at: null });
    expect(chyby.map((c) => c.pole)).toEqual(["ico", "terms"]);
  });

  it("IBAN a storno podmienky nebrzdia žiadosť, ale pýta si ich predaj", () => {
    expect(chybaNaZiadost(plny)).toEqual([]);
    expect(chybaPredPredajom(plny).map((c) => c.pole)).toEqual([
      "payout_iban",
      "cancellation_policy",
      "complaint_contact",
      "logo_url",
    ]);
  });
});
