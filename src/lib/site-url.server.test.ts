import { describe, it, expect, afterEach } from "vitest";
import { siteUrl } from "./site-url.server";

const povodne = { p: process.env.PUBLIC_SITE_URL, s: process.env.SITE_URL };
afterEach(() => {
  process.env.PUBLIC_SITE_URL = povodne.p;
  process.env.SITE_URL = povodne.s;
});
const nastav = (p?: string, s?: string) => {
  if (p === undefined) delete process.env.PUBLIC_SITE_URL;
  else process.env.PUBLIC_SITE_URL = p;
  if (s === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = s;
};

describe("siteUrl", () => {
  it("vráti nastavenú adresu", () => {
    nastav("https://eticketo.eu");
    expect(siteUrl()).toBe("https://eticketo.eu");
  });

  it("odreže lomky na konci", () => {
    nastav("https://eticketo.eu///");
    expect(siteUrl()).toBe("https://eticketo.eu");
  });

  it("obchádza medzery", () => {
    nastav("  https://eticketo.eu  ");
    expect(siteUrl()).toBe("https://eticketo.eu");
  });

  it("PUBLIC_SITE_URL má prednosť pred SITE_URL", () => {
    nastav("https://prva.sk", "https://druha.sk");
    expect(siteUrl()).toBe("https://prva.sk");
  });

  it("SITE_URL zaskočí, keď PUBLIC_SITE_URL nie je", () => {
    nastav(undefined, "https://druha.sk");
    expect(siteUrl()).toBe("https://druha.sk");
  });

  it("bez konfigurácie spadne — nikdy nevymyslí adresu", () => {
    // Toto je jadro veci: tichá záloha znamenala platbu bez vstupenky.
    nastav(undefined, undefined);
    expect(() => siteUrl()).toThrow(/PUBLIC_SITE_URL/);
    nastav("", "   ");
    expect(() => siteUrl()).toThrow(/PUBLIC_SITE_URL/);
  });
});
