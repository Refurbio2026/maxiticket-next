// Podpis QR vstupenky. Falošný token = vstup na podujatie zadarmo, takže
// overenie musí byť neúprosné.
import { describe, it, expect, beforeAll } from "vitest";
import { signTicket, verifyTicket, newSignedTicket } from "./qr-token.server";

const VSTUPENKA = "18695e6c-c4e0-43f4-939e-7942790024ba";

beforeAll(() => {
  process.env.TICKET_QR_SECRET = "testovacie-tajomstvo-pre-testy";
});

describe("signTicket", () => {
  it("má tvar MT2.<32 hex>.<podpis>", () => {
    expect(signTicket(VSTUPENKA)).toMatch(/^MT2\.[0-9a-f]{32}\.[A-Za-z0-9_-]+$/);
  });

  it("nesie id vstupenky bez pomlčiek", () => {
    expect(signTicket(VSTUPENKA).split(".")[1]).toBe(VSTUPENKA.replace(/-/g, ""));
  });
});

describe("verifyTicket", () => {
  it("vráti pôvodné UUID aj s pomlčkami", () => {
    expect(verifyTicket(signTicket(VSTUPENKA))).toBe(VSTUPENKA);
  });

  it("prijme token s veľkými písmenami v id", () => {
    // Čítačka môže QR prečítať v inej veľkosti písmen.
    const token = signTicket(VSTUPENKA);
    const [p, id, sig] = token.split(".");
    expect(verifyTicket(`${p}.${id.toUpperCase()}.${sig}`)).toBe(VSTUPENKA);
  });

  it("obchádza medzery okolo tokenu", () => {
    expect(verifyTicket(`  ${signTicket(VSTUPENKA)}  `)).toBe(VSTUPENKA);
  });

  it("odmietne podvrhnutý podpis", () => {
    const [p, id, sig] = signTicket(VSTUPENKA).split(".");
    const zly = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyTicket(`${p}.${id}.${zly}`)).toBeNull();
  });

  it("odmietne podstrčené id k cudziemu podpisu", () => {
    // Útočník pozná platný token a chce ním prejsť za inú vstupenku.
    const sig = signTicket(VSTUPENKA).split(".")[2];
    const ine = "aaaaaaaabbbbccccddddeeeeeeeeeeee";
    expect(verifyTicket(`MT2.${ine}.${sig}`)).toBeNull();
  });

  it("odmietne nezmysly a nesprávny formát", () => {
    for (const zly of [
      "",
      "MT2",
      "MT2.abc.def",
      "MT1." + VSTUPENKA.replace(/-/g, "") + ".AAAAAAAAAAA",
      VSTUPENKA,
      "MT2..",
      "MT2.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.AAAAAAAAAAA",
    ]) {
      expect(verifyTicket(zly)).toBeNull();
    }
  });

  it("odmietne skrátený podpis bez pádu", () => {
    const [p, id, sig] = signTicket(VSTUPENKA).split(".");
    expect(() => verifyTicket(`${p}.${id}.${sig.slice(0, 3)}`)).not.toThrow();
    expect(verifyTicket(`${p}.${id}.${sig.slice(0, 3)}`)).toBeNull();
  });

  it("token podpísaný iným tajomstvom neprejde", () => {
    const token = signTicket(VSTUPENKA);
    process.env.TICKET_QR_SECRET = "tajomstvo-utocnika";
    expect(verifyTicket(token)).toBeNull();
    process.env.TICKET_QR_SECRET = "testovacie-tajomstvo-pre-testy";
  });
});

describe("newSignedTicket", () => {
  it("vydá id, ktorého token sám overí", () => {
    const { id, token } = newSignedTicket();
    expect(verifyTicket(token)).toBe(id);
  });

  it("nikdy nevydá dvakrát to isté id", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSignedTicket().id));
    expect(ids.size).toBe(200);
  });
});
