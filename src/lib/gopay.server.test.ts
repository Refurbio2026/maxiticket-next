// Preklad stavu platby z GoPay na stav objednávky.
//
// Toto rozhoduje, či sa vydajú vstupenky. Neznámy stav sa NESMIE tváriť ako
// zaplatené — preto je predvolená vetva „čaká na platbu".
import { describe, it, expect } from "vitest";
import { mapGoPayStateToOrder } from "./gopay.server";

describe("mapGoPayStateToOrder", () => {
  it("PAID znamená zaplatené", () => {
    expect(mapGoPayStateToOrder("PAID")).toBe("paid");
  });

  it("zrušenie a vypršanie sa rozlišujú", () => {
    expect(mapGoPayStateToOrder("CANCELED")).toBe("cancelled");
    expect(mapGoPayStateToOrder("TIMEOUTED")).toBe("failed");
  });

  it("obe podoby vrátenia peňazí sú refundované", () => {
    expect(mapGoPayStateToOrder("REFUNDED")).toBe("refunded");
    expect(mapGoPayStateToOrder("PARTIALLY_REFUNDED")).toBe("refunded");
  });

  it("rozpracované stavy nechávajú objednávku čakať", () => {
    for (const stav of ["CREATED", "PAYMENT_METHOD_CHOSEN", "AUTHORIZED"]) {
      expect(mapGoPayStateToOrder(stav)).toBe("awaiting_payment");
    }
  });

  it("neznámy stav nikdy nevydá vstupenky", () => {
    // Keby GoPay pridal nový stav, radšej nech objednávka čaká, než aby sa
    // omylom vydali vstupenky za nezaplatené.
    for (const stav of ["", "nieco_nove", "paid", "PAID ", "UNKNOWN"]) {
      expect(mapGoPayStateToOrder(stav)).toBe("awaiting_payment");
    }
  });
});
