import { describe, expect, it } from "vitest";
import { zaradMimo, type Kontext, type PohybNaPosudenie } from "./mimo-vstupenky";

const K: Kontext = {
  vlastneIbany: ["SK2902000000007307806959", "SK7709000000005174850550"],
  vlastneNazvy: ["MaxiTicket s.r.o.", "MAXITICKET S.R.O"],
  stareVs: new Set(["16126992", "14196819"]),
};

const pohyb = (x: Partial<PohybNaPosudenie>): PohybNaPosudenie => ({
  amount: 25,
  vs_normalized: null,
  counterparty_name: null,
  counterparty_iban: null,
  message: null,
  ...x,
});

describe("čo patrí mimo predaja vstupeniek", () => {
  it("platbu zo starého systému pozná podľa variabilného symbolu", () => {
    const v = zaradMimo(pohyb({ vs_normalized: "0016126992", amount: 31.06 }), K);
    expect(v?.dovod).toBe("stary_system");
  });

  it("presun medzi vlastnými účtami podľa IBAN", () => {
    const v = zaradMimo(
      pohyb({ amount: 35000, counterparty_iban: "SK77 0900 0000 0051 7485 0550" }),
      K,
    );
    expect(v?.dovod).toBe("vlastny_prevod");
  });

  it("presun podľa vlastného názvu, keď nie je variabilný symbol", () => {
    const v = zaradMimo(pohyb({ amount: 0.1, counterparty_name: "MAXITICKET S.R.O" }), K);
    expect(v?.dovod).toBe("vlastny_prevod");
  });

  it("bankový poplatok", () => {
    expect(
      zaradMimo(pohyb({ amount: -0.47, message: "Transakčná daň 16.10.2026" }), K)?.dovod,
    ).toBe("bankovy_poplatok");
    expect(
      zaradMimo(pohyb({ amount: -0.33, counterparty_name: "Tatra Banka, a.s." }), K)?.dovod,
    ).toBe("bankovy_poplatok");
  });

  it("výplatu z platobnej brány — je to súhrn za veľa objednávok", () => {
    // Platbu kartou označí za prijatú notifikácia z brány; bankový pohyb je
    // až súhrnná výplata, ktorá sa k jednej objednávke spárovať nedá.
    expect(zaradMimo(pohyb({ amount: 2035.59, counterparty_name: "Comgate a.s." }), K)?.dovod).toBe(
      "vyuctovanie_brany",
    );
    expect(zaradMimo(pohyb({ amount: -0.1, counterparty_name: "Comgate a.s." }), K)?.dovod).toBe(
      "vyuctovanie_brany",
    );
    expect(
      zaradMimo(
        pohyb({ amount: 540.2, counterparty_name: "GoPay s.r.o.", message: "vyuctovanie" }),
        K,
      )?.dovod,
    ).toBe("vyuctovanie_brany");
  });

  it("odchádzajúcu platbu bez symbolu", () => {
    expect(zaradMimo(pohyb({ amount: -15000 }), K)?.dovod).toBe("odchadzajuca");
  });
});

describe("čo sa NESMIE označiť", () => {
  // Toto je dôležitejšia polovica testu. Prehliadnutá platba za vstupenku je
  // sťažnosť zákazníka; nespárovaný pohyb navyše je len otrava.
  it("príchodzia platba od človeka s variabilným symbolom", () => {
    expect(
      zaradMimo(
        pohyb({ amount: 19, vs_normalized: "0001000033", counterparty_name: "Nagyová Jacqueline" }),
        K,
      ),
    ).toBeNull();
  });

  it("príchodzia platba bez symbolu — môže to byť zabudnutý VS", () => {
    expect(zaradMimo(pohyb({ amount: 19, counterparty_name: "Peter Novák" }), K)).toBeNull();
  });

  it("odchádzajúca platba S variabilným symbolom — môže byť vrátenie vstupného", () => {
    expect(zaradMimo(pohyb({ amount: -19, vs_normalized: "0001000033" }), K)).toBeNull();
  });

  it("platba od banky, ale s variabilným symbolom", () => {
    expect(
      zaradMimo(
        pohyb({ amount: 50, counterparty_name: "Tatra Banka, a.s.", vs_normalized: "0001000033" }),
        K,
      ),
    ).toBeNull();
  });

  it("neznámy variabilný symbol, ktorý nie je zo starého systému", () => {
    expect(zaradMimo(pohyb({ amount: 31.06, vs_normalized: "0099999999" }), K)).toBeNull();
  });

  it("vlastný názov, ale s variabilným symbolom — radšej nechať na posúdenie", () => {
    expect(
      zaradMimo(
        pohyb({
          amount: 35000,
          counterparty_name: "MAXITICKET S.R.O",
          vs_normalized: "0000009999",
        }),
        K,
      ),
    ).toBeNull();
  });
});
