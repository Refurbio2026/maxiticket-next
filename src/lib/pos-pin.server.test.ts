import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPin, pinMatches } from "./pos-pin.server";

const POKLADNIK = "11111111-1111-1111-1111-111111111111";
const INY = "22222222-2222-2222-2222-222222222222";

describe("PIN pokladníka", () => {
  const povodne = process.env.TICKET_QR_SECRET;

  beforeEach(() => {
    process.env.TICKET_QR_SECRET = "testovacie-tajomstvo";
  });

  afterEach(() => {
    if (povodne === undefined) delete process.env.TICKET_QR_SECRET;
    else process.env.TICKET_QR_SECRET = povodne;
  });

  it("neukladá PIN v čitateľnej podobe", () => {
    const h = hashPin(POKLADNIK, "1234");
    expect(h).not.toContain("1234");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ten istý PIN dá u dvoch pokladníkov iný odtlačok", () => {
    // Bez id v hashe by sa z rovnakých odtlačkov dalo vyčítať, kto má rovnaký PIN.
    expect(hashPin(POKLADNIK, "1234")).not.toBe(hashPin(INY, "1234"));
  });

  it("je ustálený — rovnaký vstup dá rovnaký odtlačok", () => {
    expect(hashPin(POKLADNIK, "1234")).toBe(hashPin(POKLADNIK, "1234"));
  });

  it("prijme správny PIN", () => {
    expect(pinMatches(POKLADNIK, "1234", hashPin(POKLADNIK, "1234"))).toBe(true);
  });

  it("odmietne zlý PIN", () => {
    const h = hashPin(POKLADNIK, "1234");
    expect(pinMatches(POKLADNIK, "1235", h)).toBe(false);
    expect(pinMatches(POKLADNIK, "123", h)).toBe(false);
    expect(pinMatches(POKLADNIK, "", h)).toBe(false);
  });

  it("odmietne správny PIN pod cudzím pokladníkom", () => {
    // Inak by sa odtlačok z jedného účtu dal použiť na inom.
    expect(pinMatches(INY, "1234", hashPin(POKLADNIK, "1234"))).toBe(false);
  });

  it("neprepadne na odtlačku zlej dĺžky", () => {
    // `timingSafeEqual` pri rôznej dĺžke vyhodí výnimku, preto sa dĺžka
    // kontroluje vopred — tento test drží tú kontrolu na mieste.
    expect(pinMatches(POKLADNIK, "1234", "krátky")).toBe(false);
    expect(pinMatches(POKLADNIK, "1234", "")).toBe(false);
    expect(() => pinMatches(POKLADNIK, "1234", "x".repeat(200))).not.toThrow();
  });

  it("zmena tajomstva zneplatní staré odtlačky", () => {
    const stary = hashPin(POKLADNIK, "1234");
    process.env.TICKET_QR_SECRET = "ine-tajomstvo";
    expect(pinMatches(POKLADNIK, "1234", stary)).toBe(false);
  });

  it("bez tajomstva radšej spadne, než by ukladal slabý odtlačok", () => {
    delete process.env.TICKET_QR_SECRET;
    const povodnyServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(() => hashPin(POKLADNIK, "1234")).toThrow(/TICKET_QR_SECRET/);
    } finally {
      if (povodnyServiceRole !== undefined) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = povodnyServiceRole;
      }
    }
  });
});
