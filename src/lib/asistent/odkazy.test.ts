import { describe, expect, it } from "vitest";
import { rozdelOdkazy } from "./odkazy";

describe("odkazy v odpovedi asistenta", () => {
  it("holú cestu spraví odkazom", () => {
    const casti = rozdelOdkazy("Vstupenky nájdeš v sekcii /account po prihlásení.");
    expect(casti.find((c) => c.cesta)?.cesta).toBe("/account");
    expect(casti.map((c) => c.text).join("")).toContain("po prihlásení");
  });

  it("rozumie zápisu [názov](/cesta)", () => {
    const casti = rozdelOdkazy("Pozri [Moje vstupenky](/account).");
    const odkaz = casti.find((c) => c.cesta);
    expect(odkaz?.cesta).toBe("/account");
    expect(odkaz?.text).toBe("Moje vstupenky");
  });

  it("cestu s identifikátorom podujatia zvládne tiež", () => {
    const casti = rozdelOdkazy("Detail: /events/8f14e45f-ceea-467a-9e6b-1f2d3c4b5a60");
    expect(casti.find((c) => c.cesta)?.cesta).toBe("/events/8f14e45f-ceea-467a-9e6b-1f2d3c4b5a60");
  });

  it("neznámu cestu nechá textom — odkaz do prázdna je horší než text", () => {
    const casti = rozdelOdkazy("Pozri /vymyslena-stranka a /admin/tajne.");
    expect(casti.every((c) => !c.cesta)).toBe(true);
  });

  it("cudziu adresu nespraví odkazom", () => {
    const casti = rozdelOdkazy("Viac na https://example.com/events a to je všetko.");
    expect(casti.every((c) => !c.cesta)).toBe(true);
  });

  it("text bez odkazu vráti celý a nerozsekaný", () => {
    const text = "Vstupenka ti príde e-mailom hneď po zaplatení.";
    expect(rozdelOdkazy(text)).toEqual([{ text }]);
  });
});
