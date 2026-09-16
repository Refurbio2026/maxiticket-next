// Akceptačné scenáre zo špecifikácie (T1, T2, T3, T5, T7) plus hranice,
// ktoré starý systém prehliadal.
//
// Spoločné testovacie dáta podľa špecifikácie: objednávka `15501234`,
// 2× vstupenka 12,00 € + poplatok 0,50 €/ks, doručenie e-mailom,
// očakávaná suma 25,00 €.
import { describe, it, expect } from "vitest";
import {
  paruj,
  ocakavanaSuma,
  type Kontext,
  type KandidatObjednavka,
  type Pravidlo,
  type TransakciaNaParovanie,
} from "./matching";

/** Pravidlá tak, ako ich zakladá migrácia. */
const PRAVIDLA: Pravidlo[] = [
  { rule_code: "duplicate_source", priority: 10, enabled: true, params: {}, tolerance: 0 },
  { rule_code: "refund_confirmed", priority: 20, enabled: true, params: {}, tolerance: 0.01 },
  { rule_code: "chargeback", priority: 30, enabled: true, params: {}, tolerance: 0.01 },
  {
    rule_code: "expense_text",
    priority: 40,
    enabled: true,
    params: { texts: ["poplatok za vedenie", "zmluva o pozicke"] },
    tolerance: 0,
  },
  { rule_code: "settlement_payout", priority: 50, enabled: true, params: {}, tolerance: 0.01 },
  { rule_code: "vs_exact", priority: 60, enabled: true, params: {}, tolerance: 0 },
  {
    rule_code: "vs_overpaid",
    priority: 70,
    enabled: true,
    params: { keep_limit: 1.0 },
    tolerance: 0,
  },
  { rule_code: "vs_underpaid", priority: 80, enabled: true, params: {}, tolerance: 0 },
  { rule_code: "vs_already_paid", priority: 90, enabled: true, params: {}, tolerance: 0 },
  { rule_code: "vs_seats_unavailable", priority: 100, enabled: true, params: {}, tolerance: 0 },
  { rule_code: "vs_cancelled", priority: 110, enabled: true, params: {}, tolerance: 0 },
  {
    rule_code: "vs_from_description",
    priority: 120,
    enabled: true,
    params: { confidence: 0.6 },
    tolerance: 0,
  },
  { rule_code: "no_match", priority: 999, enabled: true, params: {}, tolerance: 0 },
];

const OBJEDNAVKA: KandidatObjednavka = {
  id: "11111111-1111-1111-1111-111111111111",
  vs: "0015501234",
  status: "awaiting_payment",
  total_amount: 25,
  refunded_amount: 0,
  currency: "EUR",
  seats_held: true,
};

function tx(upravy: Partial<TransakciaNaParovanie> = {}): TransakciaNaParovanie {
  return {
    id: "tx-1",
    account_id: "ucet-1",
    amount: 25,
    currency: "EUR",
    vs_normalized: "0015501234",
    booked_at: "2026-03-03T10:15:00+01:00",
    counterparty_iban: "SK0009000000000087654321",
    message: "Platba za vstupenky",
    provider_tx_id: null,
    ...upravy,
  };
}

function kontext(upravy: Partial<Kontext> = {}): Kontext {
  return {
    objednavky: [OBJEDNAVKA],
    ulohyNaVratenie: [],
    protokoly: [],
    duplikat: null,
    povodnaPlatba: null,
    ...upravy,
  };
}

describe("T1 — presná suma", () => {
  it("spáruje a dá pokyn dokončiť objednávku", () => {
    const r = paruj(tx(), kontext(), PRAVIDLA);
    expect(r.rule_code).toBe("vs_exact");
    expect(r.status).toBe("matched");
    expect(r.decision).toBe("matched");
    expect(r.order_id).toBe(OBJEDNAVKA.id);
    expect(r.akcia).toBe("dokonci_objednavku");
    expect(r.difference).toBe(0);
    expect(r.vratenie).toBeNull();
  });

  it("zostatok po čiastočnom refunde je očakávaná suma", () => {
    expect(ocakavanaSuma({ ...OBJEDNAVKA, refunded_amount: 5 })).toBe(20);
  });
});

describe("T2 — preplatok", () => {
  it("nad limitom dokončí objednávku a založí vrátenie rozdielu", () => {
    const r = paruj(tx({ amount: 30 }), kontext(), PRAVIDLA);
    expect(r.rule_code).toBe("vs_overpaid");
    expect(r.status).toBe("matched");
    expect(r.akcia).toBe("dokonci_objednavku");
    expect(r.difference).toBe(5);
    expect(r.vratenie).toEqual({ amount: 5, reason: "overpaid" });
  });

  // Rozhodnutie prevádzkovateľa: drobný rozdiel sa nevracia, prevod by stál viac.
  it("do limitu sa preplatok ponechá", () => {
    const r = paruj(tx({ amount: 25.5 }), kontext(), PRAVIDLA);
    expect(r.rule_code).toBe("vs_overpaid");
    expect(r.status).toBe("matched");
    expect(r.difference).toBe(0.5);
    expect(r.vratenie).toBeNull();
  });

  it("limit je hranica, nie odhad", () => {
    expect(paruj(tx({ amount: 26 }), kontext(), PRAVIDLA).vratenie).toBeNull();
    expect(paruj(tx({ amount: 26.01 }), kontext(), PRAVIDLA).vratenie).toEqual({
      amount: 1.01,
      reason: "overpaid",
    });
  });
});

describe("T3 — nedoplatok", () => {
  it("objednávku NEDOKONČÍ a pošle ju na kontrolu", () => {
    const r = paruj(tx({ amount: 20 }), kontext(), PRAVIDLA);
    expect(r.rule_code).toBe("vs_underpaid");
    expect(r.status).toBe("needs_review");
    expect(r.review_reason).toBe("underpaid");
    expect(r.difference).toBe(-5);
    // Toto je celý zmysel pravidla: žiadne vstupenky za sumu, ktorá neprišla.
    expect(r.akcia).toBeNull();
  });

  it("aj nedoplatok o cent je nedoplatok", () => {
    const r = paruj(tx({ amount: 24.99 }), kontext(), PRAVIDLA);
    expect(r.rule_code).toBe("vs_underpaid");
    expect(r.akcia).toBeNull();
  });
});

describe("T5 — platba na zrušenú rezerváciu", () => {
  it("nevydá vstupenky a navrhne vrátenie", () => {
    const r = paruj(
      tx(),
      kontext({ objednavky: [{ ...OBJEDNAVKA, status: "expired" }] }),
      PRAVIDLA,
    );
    expect(r.rule_code).toBe("vs_cancelled");
    expect(r.status).toBe("needs_review");
    expect(r.review_reason).toBe("reservation_cancelled");
    expect(r.akcia).toBeNull();
    expect(r.vratenie).toEqual({ amount: 25, reason: "reservation_cancelled" });
  });
});

describe("T7 — platba bez VS", () => {
  it("navrhne objednávku podľa sumy, ale nechá potvrdiť človeka", () => {
    const r = paruj(
      tx({ vs_normalized: null, message: "vstupenky 15501234" }),
      kontext(),
      PRAVIDLA,
    );
    expect(r.rule_code).toBe("vs_from_description");
    expect(r.decision).toBe("suggested");
    expect(r.status).toBe("needs_review");
    expect(r.order_id).toBe(OBJEDNAVKA.id);
    expect(r.confidence).toBeLessThan(1);
    // Nikdy nie automatické dokončenie — stačilo by napísať cudzie číslo
    // do správy pre príjemcu.
    expect(r.akcia).toBeNull();
  });

  it("bez VS aj bez sedacej sumy končí ako nespárovaná", () => {
    const r = paruj(tx({ vs_normalized: null, amount: 99, message: "nic" }), kontext(), PRAVIDLA);
    expect(r.rule_code).toBe("no_match");
    expect(r.review_reason).toBe("no_vs");
  });
});

describe("dvojitá platba a duplicity", () => {
  it("platba na už zaplatenú objednávku sa vracia", () => {
    const r = paruj(tx(), kontext({ objednavky: [{ ...OBJEDNAVKA, status: "paid" }] }), PRAVIDLA);
    expect(r.rule_code).toBe("vs_already_paid");
    expect(r.status).toBe("needs_review");
    expect(r.review_reason).toBe("already_paid");
    expect(r.vratenie).toEqual({ amount: 25, reason: "already_paid" });
    expect(r.akcia).toBeNull();
  });

  it("tá istá platba z druhého zdroja je duplicita", () => {
    const r = paruj(tx(), kontext({ duplikat: { id: "tx-0" } }), PRAVIDLA);
    expect(r.rule_code).toBe("duplicate_source");
    expect(r.status).toBe("duplicate");
    expect(r.duplicate_of).toBe("tx-0");
    expect(r.akcia).toBeNull();
  });
});

describe("sedadlá a mena", () => {
  it("bez sedadiel sa vstupenky nevydajú", () => {
    const r = paruj(
      tx(),
      kontext({ objednavky: [{ ...OBJEDNAVKA, seats_held: false }] }),
      PRAVIDLA,
    );
    expect(r.rule_code).toBe("vs_seats_unavailable");
    expect(r.akcia).toBeNull();
    expect(r.vratenie?.reason).toBe("seats_unavailable");
  });

  // Starý systém menu vôbec neukladal — určoval ju účet, na ktorý platba prišla.
  it("iná mena objednávku nedokončí", () => {
    const r = paruj(tx({ currency: "CZK" }), kontext(), PRAVIDLA);
    expect(r.status).toBe("needs_review");
    expect(r.review_reason).toBe("currency_mismatch");
    expect(r.akcia).toBeNull();
  });
});

describe("odchádzajúce platby", () => {
  it("potvrdí vyexportované vrátenie", () => {
    const r = paruj(
      tx({ amount: -24, message: "vratenie" }),
      kontext({
        ulohyNaVratenie: [
          {
            id: "uloha-1",
            order_id: OBJEDNAVKA.id,
            amount: 24,
            status: "exported",
            vs: "0015501234",
          },
        ],
      }),
      PRAVIDLA,
    );
    expect(r.rule_code).toBe("refund_confirmed");
    expect(r.status).toBe("matched");
    expect(r.refund_task_id).toBe("uloha-1");
    expect(r.akcia).toBe("potvrd_vratenie");
  });

  it("chargeback podľa ID transakcie u brány", () => {
    const r = paruj(
      tx({ amount: -25, provider_tx_id: "TID-9" }),
      kontext({ povodnaPlatba: { transaction_id: "tx-0", order_id: OBJEDNAVKA.id } }),
      PRAVIDLA,
    );
    expect(r.rule_code).toBe("chargeback");
    expect(r.akcia).toBe("zapis_chargeback");
    expect(r.order_id).toBe(OBJEDNAVKA.id);
  });

  it("výplata organizátorovi podľa VS protokolu", () => {
    const r = paruj(
      tx({ amount: -500, vs_normalized: "0000123456" }),
      kontext({ protokoly: [{ id: "protokol-1", vs: "0000123456", amount: 500 }] }),
      PRAVIDLA,
    );
    expect(r.rule_code).toBe("settlement_payout");
    expect(r.settlement_id).toBe("protokol-1");
    expect(r.akcia).toBe("oznac_protokol_zaplateny");
  });
});

describe("náklady a konfigurácia pravidiel", () => {
  it("bankový poplatok sa neparuje na objednávku", () => {
    const r = paruj(
      tx({ amount: -9.9, message: "Poplatok za vedenie uctu 03/2026", vs_normalized: null }),
      kontext(),
      PRAVIDLA,
    );
    expect(r.rule_code).toBe("expense_text");
    expect(r.status).toBe("ignored");
  });

  // Pravidlá sa dajú vypnúť bez zásahu do kódu — to je zmysel tabuľky.
  it("vypnuté pravidlo prepadne na ďalšie", () => {
    const bezPresnej = PRAVIDLA.map((p) =>
      p.rule_code === "vs_exact" ? { ...p, enabled: false } : p,
    );
    const r = paruj(tx(), kontext(), bezPresnej);
    expect(r.rule_code).toBe("no_match");
    expect(r.akcia).toBeNull();
  });

  it("pravidlo mimo platnosti sa nepoužije", () => {
    const uzNeplatne = PRAVIDLA.map((p) =>
      p.rule_code === "vs_exact" ? { ...p, valid_to: "2026-01-01" } : p,
    );
    const r = paruj(tx(), kontext(), uzNeplatne);
    expect(r.rule_code).toBe("no_match");
  });

  it("zmena limitu preplatku sa prejaví bez zásahu do kódu", () => {
    const stedry = PRAVIDLA.map((p) =>
      p.rule_code === "vs_overpaid" ? { ...p, params: { keep_limit: 10 } } : p,
    );
    const r = paruj(tx({ amount: 30 }), kontext(), stedry);
    expect(r.status).toBe("matched");
    expect(r.vratenie).toBeNull();
  });
});
