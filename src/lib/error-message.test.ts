import { describe, it, expect } from "vitest";
import { errorMessage } from "./error-message";

describe("errorMessage", () => {
  it("vytiahne text z Error", () => {
    expect(errorMessage(new Error("Platba zlyhala"))).toBe("Platba zlyhala");
  });

  it("prijme aj vyhodený reťazec", () => {
    expect(errorMessage("SEATS_TAKEN")).toBe("SEATS_TAKEN");
  });

  it("prijme objekt so správou — napr. chybu zo Supabase", () => {
    expect(errorMessage({ message: "duplicate key", code: "23505" })).toBe("duplicate key");
  });

  it("nespadne na null, undefined ani čísle", () => {
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
    expect(errorMessage(42)).toBe("42");
  });

  it("objekt s nereťazcovou správou nevydá [object Object] namiesto správy", () => {
    expect(errorMessage({ message: { kod: 1 } })).toBe("[object Object]");
  });

  it("vždy vráti reťazec", () => {
    for (const v of [new Error("x"), "y", {}, [], 0, false, null]) {
      expect(typeof errorMessage(v)).toBe("string");
    }
  });
});
