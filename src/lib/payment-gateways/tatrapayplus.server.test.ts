import { describe, it, expect } from "vitest";
import { ocisti, postavTeloPlatby, stavPlatby } from "./tatrapayplus.server";
import type { StartPaymentInput } from "./types";

const VSTUP: StartPaymentInput = {
  orderId: "3f1c2b7a-0000-4000-8000-000000000001",
  reference: "1000001",
  amount: 24.5,
  currency: "EUR",
  description: "Vstupenky 1000001",
  customer: {
    firstName: "Ľuboš",
    lastName: "Ščasný",
    email: "lubos@example.sk",
    phone: "+421900123456",
  },
  items: [{ name: "Státie", unitPrice: 12.25, quantity: 2 }],
  returnUrl: "https://eticketo.eu/api/public/payments/tatrapayplus/return",
  notifyUrl: "https://eticketo.eu/api/public/payments/tatrapayplus/webhook",
  clientIp: "1.2.3.4",
  lang: "sk",
};

describe("stavPlatby — prevod z účtu", () => {
  it("zúčtovaný prevod je zaplatené", () => {
    expect(stavPlatby({ selectedPaymentMethod: "BANK_TRANSFER", status: "ACSC" })).toBe("paid");
    expect(stavPlatby({ selectedPaymentMethod: "BANK_TRANSFER", status: "ACCC" })).toBe("paid");
  });

  it("prijatý, ale ešte nezúčtovaný prevod NIE je zaplatené", () => {
    // Toto je celý dôvod, prečo sa stavy prekladajú prísne: za ACCP ani PDNG
    // sa vstupenky vydať nesmú, peniaze na účte ešte nie sú.
    for (const stav of ["RCVD", "PDNG", "ACTC", "ACCP", "ACSP", "ACWC", "PATC"]) {
      expect(stavPlatby({ selectedPaymentMethod: "BANK_TRANSFER", status: stav })).toBe("pending");
    }
  });

  it("zamietnutý prevod je neúspech, zrušený je zrušenie", () => {
    expect(stavPlatby({ selectedPaymentMethod: "BANK_TRANSFER", status: "RJCT" })).toBe("failed");
    expect(stavPlatby({ selectedPaymentMethod: "BANK_TRANSFER", status: "CANC" })).toBe(
      "cancelled",
    );
  });
});

describe("stavPlatby — karta", () => {
  it("OK je zaplatené a CB je vrátené", () => {
    expect(stavPlatby({ selectedPaymentMethod: "CARD_PAY", status: { status: "OK" } })).toBe(
      "paid",
    );
    expect(stavPlatby({ selectedPaymentMethod: "CARD_PAY", status: { status: "CB" } })).toBe(
      "refunded",
    );
  });

  it("samotná predautorizácia ešte nie je zaplatenie", () => {
    expect(stavPlatby({ selectedPaymentMethod: "CARD_PAY", status: { status: "PA" } })).toBe(
      "pending",
    );
    expect(stavPlatby({ selectedPaymentMethod: "CARD_PAY", status: { status: "CPA" } })).toBe(
      "paid",
    );
  });

  it("FAIL je neúspech", () => {
    expect(stavPlatby({ selectedPaymentMethod: "CARD_PAY", status: { status: "FAIL" } })).toBe(
      "failed",
    );
  });
});

describe("stavPlatby — stav autorizácie má prednosť", () => {
  it("zrušenie zákazníkom prebije akýkoľvek stav platby", () => {
    expect(
      stavPlatby({
        authorizationStatus: "CANCELLED_BY_USER",
        selectedPaymentMethod: "CARD_PAY",
        status: { status: "INIT" },
      }),
    ).toBe("cancelled");
  });

  it("neúspešná autorizácia je neúspech", () => {
    expect(stavPlatby({ authorizationStatus: "AUTH_FAILED" })).toBe("failed");
  });

  it("rozrobený zámer bez zvolenej metódy je stále čakanie", () => {
    expect(stavPlatby({ authorizationStatus: "NEW" })).toBe("pending");
    expect(stavPlatby({})).toBe("pending");
  });

  it("neznámu metódu radšej nechá čakať, než by vydal vstupenky", () => {
    expect(stavPlatby({ selectedPaymentMethod: "NIECO_NOVE", status: "OK" })).toBe("pending");
  });
});

describe("ocisti", () => {
  it("zhodí diakritiku", () => {
    expect(ocisti("Ľuboš Ščasný", /[a-zA-Z0-9 ]/, 30)).toBe("Lubos Scasny");
  });

  it("znak mimo povolenej množiny nahradí medzerou a medzery zlúči", () => {
    expect(ocisti("a@#$%b", /[a-zA-Z0-9 ]/, 30)).toBe("a b");
  });

  it("skráti na maximálnu dĺžku", () => {
    expect(ocisti("x".repeat(60), /[a-zA-Z0-9 ]/, 30)).toHaveLength(30);
  });
});

describe("postavTeloPlatby", () => {
  it("pošle sumu v eurách a variabilný symbol", () => {
    const telo = postavTeloPlatby(VSTUP);
    expect(telo.basePayment.instructedAmount).toEqual({ amountValue: 24.5, currency: "EUR" });
    expect(telo.basePayment.endToEnd).toEqual({ variableSymbol: "1000001" });
  });

  it("mená očistí do tvaru, ktorý banka prijme", () => {
    const telo = postavTeloPlatby(VSTUP);
    expect(telo.userData.firstName).toBe("Lubos");
    expect(telo.userData.lastName).toBe("Scasny");
    expect(telo.cardDetail.cardHolder).toBe("Lubos Scasny");
  });

  it("telefón v medzinárodnom tvare pošle, iný vynechá", () => {
    expect(postavTeloPlatby(VSTUP).userData).toHaveProperty("phone", "+421900123456");
    const domaci = {
      ...VSTUP,
      customer: { ...VSTUP.customer, phone: "0900 123 456" },
    };
    expect(postavTeloPlatby(domaci).userData).not.toHaveProperty("phone");
  });

  it("prázdne meno nahradí zástupným, aby telo prešlo validáciou", () => {
    const bezMena = {
      ...VSTUP,
      customer: { ...VSTUP.customer, firstName: "", lastName: "" },
    };
    const telo = postavTeloPlatby(bezMena);
    expect(telo.userData.firstName).toBe("Zakaznik");
    expect(telo.userData.lastName).toBe("Vstupenky");
  });

  it("odmietne nečíselný variabilný symbol skôr, než ho pošle banke", () => {
    expect(() => postavTeloPlatby({ ...VSTUP, reference: "3F1C2B7A" })).toThrow(/variabiln/i);
    expect(() => postavTeloPlatby({ ...VSTUP, reference: "12345678901" })).toThrow(/variabiln/i);
  });
});
