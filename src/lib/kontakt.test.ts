import { describe, it, expect } from "vitest";
import { vyplnenaPast } from "./kontakt.functions";
import { PREVADZKOVATEL, identifikaciaJedenRiadok, mapaUrl } from "./kontakt";

describe("vyplnenaPast", () => {
  it("prázdne pole je človek", () => {
    expect(vyplnenaPast(undefined)).toBe(false);
    expect(vyplnenaPast(null)).toBe(false);
    expect(vyplnenaPast("")).toBe(false);
    expect(vyplnenaPast("   ")).toBe(false);
  });

  it("vyplnené pole je robot", () => {
    expect(vyplnenaPast("http://spam.example")).toBe(true);
    expect(vyplnenaPast("x")).toBe(true);
  });
});

describe("identifikácia prevádzkovateľa", () => {
  it("drží údaje z registra", () => {
    expect(PREVADZKOVATEL.nazov).toBe("MaxiTicket s.r.o.");
    expect(PREVADZKOVATEL.ico).toBe("53 251 580");
    expect(PREVADZKOVATEL.registracia).toContain("Mestského súdu Bratislava III");
    expect(PREVADZKOVATEL.registracia).toContain("170046/B");
  });

  it("jeden riadok obsahuje názov, adresu aj IČO", () => {
    const r = identifikaciaJedenRiadok();
    expect(r).toContain("MaxiTicket s.r.o.");
    expect(r).toContain("Drevárska 23");
    expect(r).toContain("902 01 Pezinok");
    expect(r).toContain("53 251 580");
  });

  it("telefón je v oboch tvaroch konzistentný", () => {
    expect(PREVADZKOVATEL.telefonLink).toBe(PREVADZKOVATEL.telefon.replace(/\s/g, ""));
  });

  it("mapa ukazuje na sídlo a nie na cudzí skript", () => {
    const u = mapaUrl();
    expect(u.startsWith("https://www.openstreetmap.org/export/embed.html?")).toBe(true);
    expect(u).toContain(`marker=${PREVADZKOVATEL.poloha.lat}`);
  });
});
