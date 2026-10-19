import { describe, expect, it } from "vitest";
import { jeOdpojenyKlient } from "./odpojeny-klient";

describe("jeOdpojenyKlient", () => {
  it("rozpozná AbortError tak, ako príde zo streamu", () => {
    // Presne tvar z nášho logu: DOMException s menom AbortError.
    const e = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    expect(jeOdpojenyKlient(e)).toBe(true);
  });

  it("rozpozná prerušené TCP", () => {
    expect(jeOdpojenyKlient(Object.assign(new Error("read"), { code: "ECONNRESET" }))).toBe(true);
    expect(jeOdpojenyKlient(Object.assign(new Error("write"), { code: "EPIPE" }))).toBe(true);
    expect(
      jeOdpojenyKlient(Object.assign(new Error("x"), { code: "ERR_STREAM_PREMATURE_CLOSE" })),
    ).toBe(true);
  });

  it("nájde dôvod zabalený v cause", () => {
    // Takto to v logu naozaj je — vonku obyčajná chyba, vnútri AbortError.
    const vnutri = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const vonku = Object.assign(new Error("render zlyhal"), { cause: vnutri });
    expect(jeOdpojenyKlient(vonku)).toBe(true);
  });

  it("nájde ho aj o dve úrovne nižšie", () => {
    const a = Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    const b = Object.assign(new Error("stred"), { cause: a });
    const c = Object.assign(new Error("vrch"), { cause: b });
    expect(jeOdpojenyKlient(c)).toBe(true);
  });

  it("skutočnú chybu aplikácie nezahltí", () => {
    // Toto je to dôležité: filter nesmie schovať chyby, ktoré chceme vidieť.
    expect(jeOdpojenyKlient(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(jeOdpojenyKlient(new Error("Chýba TICKET_QR_SECRET"))).toBe(false);
    expect(jeOdpojenyKlient(Object.assign(new Error("db"), { code: "23505" }))).toBe(false);
    expect(jeOdpojenyKlient({ message: "Seroval Error (step: 3)" })).toBe(false);
  });

  it("nepadne na nezmysle", () => {
    expect(jeOdpojenyKlient(null)).toBe(false);
    expect(jeOdpojenyKlient(undefined)).toBe(false);
    expect(jeOdpojenyKlient("aborted")).toBe(false);
    expect(jeOdpojenyKlient(42)).toBe(false);
  });

  it("nezacyklí sa na chybe, ktorá odkazuje na seba", () => {
    const e: Record<string, unknown> = { message: "kruh" };
    e.cause = e;
    expect(() => jeOdpojenyKlient(e)).not.toThrow();
    expect(jeOdpojenyKlient(e)).toBe(false);
  });
});
