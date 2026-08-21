// Prístupový token k objednávke — to, čím sa od dnešnej opravy chránia QR kódy.
import { describe, it, expect, beforeAll } from "vitest";
import { signOrderAccess, verifyOrderAccess } from "./order-access.server";

const OBJ = "45f290a0-346b-4210-a2c7-25be25a7c0f3";
const INA = "11111111-2222-3333-4444-555555555555";

beforeAll(() => {
  process.env.TICKET_QR_SECRET = "testovacie-tajomstvo-pre-testy";
});

describe("signOrderAccess", () => {
  it("dá pre tú istú objednávku vždy rovnaký token", () => {
    expect(signOrderAccess(OBJ)).toBe(signOrderAccess(OBJ));
  });

  it("dá pre inú objednávku iný token", () => {
    expect(signOrderAccess(OBJ)).not.toBe(signOrderAccess(INA));
  });

  it("nevracia nič, z čoho by sa dalo prečítať číslo objednávky", () => {
    const token = signOrderAccess(OBJ);
    expect(token).not.toContain(OBJ);
    expect(token).not.toContain(OBJ.replace(/-/g, ""));
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, žiadne '=' ani '+'
  });
});

describe("verifyOrderAccess", () => {
  it("prijme vlastný token", () => {
    expect(verifyOrderAccess(OBJ, signOrderAccess(OBJ))).toBe(true);
  });

  it("odmietne token vydaný pre inú objednávku", () => {
    expect(verifyOrderAccess(OBJ, signOrderAccess(INA))).toBe(false);
  });

  it("odmietne prázdny token", () => {
    // Toto je presne cesta útočníka: `?t=` v odkaze.
    expect(verifyOrderAccess(OBJ, "")).toBe(false);
    expect(verifyOrderAccess(OBJ, null)).toBe(false);
    expect(verifyOrderAccess(OBJ, undefined)).toBe(false);
  });

  it("odmietne skrátený token bez pádu", () => {
    // `timingSafeEqual` na rôznych dĺžkach vyhadzuje — kontrola dĺžky to musí
    // zachytiť skôr, inak by sa dal server zhodiť jedným dotazom.
    const token = signOrderAccess(OBJ);
    expect(() => verifyOrderAccess(OBJ, token.slice(0, 5))).not.toThrow();
    expect(verifyOrderAccess(OBJ, token.slice(0, 5))).toBe(false);
    expect(verifyOrderAccess(OBJ, token + "AAAA")).toBe(false);
  });

  it("odmietne token s prehodeným znakom", () => {
    const token = signOrderAccess(OBJ);
    const zly = (token[0] === "A" ? "B" : "A") + token.slice(1);
    expect(verifyOrderAccess(OBJ, zly)).toBe(false);
  });

  it("po zmene tajomstva prestanú staré tokeny platiť", () => {
    const stary = signOrderAccess(OBJ);
    process.env.TICKET_QR_SECRET = "ine-tajomstvo";
    expect(verifyOrderAccess(OBJ, stary)).toBe(false);
    process.env.TICKET_QR_SECRET = "testovacie-tajomstvo-pre-testy";
    expect(verifyOrderAccess(OBJ, stary)).toBe(true);
  });
});
