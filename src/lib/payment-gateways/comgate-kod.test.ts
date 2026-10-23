// `overKod` rozhoduje, či volanie ComGate dopadlo dobre. Vzniklo to po tom,
// čo tlačidlo „Otestovať" hlásilo „ComGate -1" na správne nastavenú bránu:
// `/v2.0/method.json` je jediný endpoint, ktorý pri úspechu pole `code`
// nevracia, a chýbajúci `code` sa bral ako chyba.
import { describe, it, expect } from "vitest";
import { overKod, type ComgateOdpoved } from "./comgate.gateway.server";

const odpoved = (
  status: number,
  data: Record<string, unknown>,
  text = JSON.stringify(data),
): ComgateOdpoved => ({ status, data, text });

describe("overKod", () => {
  it("úspech s code 0 prejde", () => {
    expect(() => overKod(odpoved(200, { code: 0, message: "OK" }))).not.toThrow();
    expect(() => overKod(odpoved(201, { code: 0, transId: "AB12" }))).not.toThrow();
  });

  it("úspech BEZ code prejde — tak odpovedá /v2.0/method.json", () => {
    expect(() => overKod(odpoved(200, { methods: [{ id: "CARD_CZ_CSOB_2" }] }))).not.toThrow();
    expect(() => overKod(odpoved(200, {}))).not.toThrow();
  });

  it("chyba v tele sa ohlási zrozumiteľne, aj keď je HTTP stav 200", () => {
    expect(() => overKod(odpoved(200, { code: 1310, message: "Unknown currency" }))).toThrow(
      /neznáma mena/,
    );
    expect(() => overKod(odpoved(200, { code: 1301 }))).toThrow(/neznámy e-shop/);
  });

  it("chyba v tele má prednosť pred HTTP stavom — je konkrétnejšia", () => {
    // Takto odpovedá brána na chýbajúce prihlásenie: 403 a code 1400.
    expect(() =>
      overKod(odpoved(403, { code: 1400, message: "Rest authorization is missing!" })),
    ).toThrow(/ComGate 1400/);
  });

  it("HTTP chyba bez tela sa ohlási ako HTTP chyba", () => {
    expect(() => overKod(odpoved(500, {}, "<html>Internal Server Error</html>"))).toThrow(
      /ComGate HTTP 500/,
    );
    expect(() => overKod(odpoved(404, {}, "Not Found"))).toThrow(/ComGate HTTP 404/);
  });

  it("do hlášky nedá celé telo, len jeho začiatok", () => {
    const dlhe = "x".repeat(5000);
    try {
      overKod(odpoved(502, {}, dlhe));
      throw new Error("malo to spadnúť");
    } catch (e) {
      expect(e instanceof Error && e.message.length).toBeLessThan(220);
    }
  });
});
