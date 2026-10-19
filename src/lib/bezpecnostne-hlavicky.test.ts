import { describe, it, expect } from "vitest";
import { HLAVICKY, HSTS, jeHttps, pridajBezpecnostneHlavicky } from "./bezpecnostne-hlavicky";

const poziadavka = (url = "https://eticketo.eu/", hlavicky: Record<string, string> = {}) =>
  new Request(url, { headers: hlavicky });

describe("jeHttps", () => {
  it("verí X-Forwarded-Proto od nginxu", () => {
    expect(jeHttps(poziadavka("http://127.0.0.1:3000/", { "x-forwarded-proto": "https" }))).toBe(
      true,
    );
    expect(jeHttps(poziadavka("https://eticketo.eu/", { "x-forwarded-proto": "http" }))).toBe(
      false,
    );
  });

  it("z reťazca proxy berie prvú hodnotu", () => {
    expect(jeHttps(poziadavka("http://x/", { "x-forwarded-proto": "https, http" }))).toBe(true);
  });

  it("bez hlavičky sa pozrie na schému adresy", () => {
    expect(jeHttps(poziadavka("https://eticketo.eu/"))).toBe(true);
    expect(jeHttps(poziadavka("http://eticketo.eu/"))).toBe(false);
  });
});

describe("pridajBezpecnostneHlavicky", () => {
  it("doplní celú sadu vrátane HSTS po HTTPS", () => {
    const out = pridajBezpecnostneHlavicky(new Response("ahoj"), poziadavka());
    for (const [nazov, hodnota] of Object.entries(HLAVICKY)) {
      expect(out.headers.get(nazov)).toBe(hodnota);
    }
    expect(out.headers.get("Strict-Transport-Security")).toBe(HSTS);
  });

  it("HSTS po HTTP neposiela", () => {
    const out = pridajBezpecnostneHlavicky(new Response("ahoj"), poziadavka("http://eticketo.eu/"));
    expect(out.headers.get("Strict-Transport-Security")).toBeNull();
    expect(out.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("neprepíše, čo si cesta nastavila sama", () => {
    const out = pridajBezpecnostneHlavicky(
      new Response("ahoj", { headers: { "X-Frame-Options": "DENY" } }),
      poziadavka(),
    );
    expect(out.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("zachová stav, text aj pôvodné hlavičky", async () => {
    const out = pridajBezpecnostneHlavicky(
      // `statusText` musí byť Latin-1 — mäkčeň by `Response` odmietla.
      new Response("telo", { status: 418, statusText: "Teapot", headers: { "x-moje": "1" } }),
      poziadavka(),
    );
    expect(out.status).toBe(418);
    expect(out.statusText).toBe("Teapot");
    expect(out.headers.get("x-moje")).toBe("1");
    expect(await out.text()).toBe("telo");
  });

  it("odpovede bez tela nerozbije", () => {
    for (const status of [204, 304]) {
      const out = pridajBezpecnostneHlavicky(new Response(null, { status }), poziadavka());
      expect(out.status).toBe(status);
      expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });
});
