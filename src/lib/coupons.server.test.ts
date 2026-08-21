// Hlášky pri neúspešnom kupóne. Zákazník musí vedieť, čo sa stalo.
import { describe, it, expect } from "vitest";
import { couponErrorMessage } from "./coupons.server";

describe("couponErrorMessage", () => {
  it("preloží každý známy dôvod do slovenčiny", () => {
    const kody = [
      "not_found",
      "inactive",
      "not_yet",
      "expired",
      "wrong_event",
      "min_amount",
      "exhausted",
      "email_limit",
    ];
    for (const kod of kody) {
      const hlaska = couponErrorMessage(kod);
      expect(hlaska).not.toBe("");
      expect(hlaska).not.toBe(kod); // nesmie presiaknuť technický kód
      expect(hlaska).not.toMatch(/_/); // ani jeho tvar
    }
  });

  it("každý dôvod má vlastnú hlášku", () => {
    const kody = ["not_found", "inactive", "not_yet", "expired", "wrong_event", "exhausted"];
    expect(new Set(kody.map(couponErrorMessage)).size).toBe(kody.length);
  });

  it("neznámy kód dostane náhradnú hlášku, nie prázdno", () => {
    expect(couponErrorMessage("nieco_ine")).toBe("Kupón sa nepodarilo uplatniť.");
    expect(couponErrorMessage("")).toBe("Kupón sa nepodarilo uplatniť.");
  });
});
