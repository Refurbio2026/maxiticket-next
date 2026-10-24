import { describe, expect, it } from "vitest";
import { cistyIban, najdiPodlaIbanu, prevedOdpoved, prevedPohyb } from "./faktero";

// Tvar odpovede je odpísaný zo skutočného volania (24. 10. 2026), nie z hlavy.
const POHYB = {
  id: "15c0b1fb-4454-4233-b335-d9669485e4c6",
  bank_account_id: "fc85d785-c976-4771-95ca-116b7c303baf",
  booking_date: "2026-10-24",
  amount: 31.06,
  currency: "EUR",
  variable_symbol: "0016127135",
  counterparty: "MaxiTicket s.r.o.",
  description: "Platba 1100/000000-2911585571",
  transaction_reference: "2024950659872",
  matched_invoice_id: null,
};

describe("preklad pohybu z Faktera", () => {
  it("prenesie sumu, dátum, menu aj variabilný symbol", () => {
    const t = prevedPohyb(POHYB);
    if ("chyba" in t) throw new Error(t.chyba);
    expect(t.amount).toBe(31.06);
    expect(t.value_date).toBe("2026-10-24");
    expect(t.booked_at).toBe("2026-10-24T00:00:00.000Z");
    expect(t.currency).toBe("EUR");
    // Symboly sa držia na pevnej dĺžke s nulami zľava; párovanie si ich
    // prevedie na číslo, takže „0016127135" a „16127135" sedia na tú istú
    // objednávku. Orezávať by sa nesmeli — trafili by cudziu.
    expect(t.variable_symbol).toBe("0016127135");
    expect(t.vs_normalized).toBe("0016127135");
    expect(t.counterparty_name).toBe("MaxiTicket s.r.o.");
  });

  it("odvodí jednoznačné id, podľa ktorého sa pohyb nenaimportuje dvakrát", () => {
    const t = prevedPohyb(POHYB);
    if ("chyba" in t) throw new Error(t.chyba);
    expect(t.external_id).toBe("faktero:15c0b1fb-4454-4233-b335-d9669485e4c6");
    expect(t.provider_tx_id).toBe("2024950659872");
  });

  it("pohyb bez sumy alebo dátumu ohlási ako chybu, nezahodí ticho", () => {
    expect(prevedPohyb({ ...POHYB, amount: undefined })).toHaveProperty("chyba");
    expect(prevedPohyb({ ...POHYB, booking_date: undefined })).toHaveProperty("chyba");
  });

  it("symbol zo samých núl berie ako nevyplnený", () => {
    const t = prevedPohyb({ ...POHYB, variable_symbol: "0000000000" });
    if ("chyba" in t) throw new Error(t.chyba);
    expect(t.variable_symbol).toBeNull();
  });

  it("zamaskuje číslo karty v popise", () => {
    const t = prevedPohyb({ ...POHYB, description: "Platba kartou 4921 7300 1234 5678" });
    if ("chyba" in t) throw new Error(t.chyba);
    expect(t.message).not.toContain("12345678");
  });

  it("odchádzajúcu platbu nechá zápornú", () => {
    const t = prevedPohyb({ ...POHYB, amount: -12.5 });
    if ("chyba" in t) throw new Error(t.chyba);
    expect(t.amount).toBe(-12.5);
  });
});

describe("preklad celej odpovede", () => {
  it("spracuje zoznam a dopočíta súhrn", () => {
    const v = prevedOdpoved({ data: [POHYB, { ...POHYB, id: "iny", amount: -5 }] });
    expect(v.transakcie).toHaveLength(2);
    expect(v.chyby).toHaveLength(0);
    expect(v.suhrn?.credit_sum).toBe(31.06);
    expect(v.suhrn?.debit_sum).toBe(5);
    expect(v.suhrn?.currency).toBe("EUR");
  });

  it("chybný pohyb nezhodí zvyšok dávky", () => {
    const v = prevedOdpoved({ data: [POHYB, { id: "zly" }] });
    expect(v.transakcie).toHaveLength(1);
    expect(v.chyby).toHaveLength(1);
  });

  it("cudzí tvar odpovede ohlási zrozumiteľne", () => {
    const v = prevedOdpoved({ nieco: "ine" });
    expect(v.transakcie).toHaveLength(0);
    expect(v.chyby[0].chyba).toContain("data");
  });

  it("prázdny zoznam je v poriadku, nie chyba", () => {
    const v = prevedOdpoved({ data: [] });
    expect(v.transakcie).toHaveLength(0);
    expect(v.chyby).toHaveLength(0);
  });
});

// Tvar zoznamu účtov je odpísaný zo skutočnej odpovede (24. 10. 2026).
const UCTY = {
  data: [
    {
      id: "7c9a8242-5b05-4ab6-bc25-f543cf62079b",
      iban: "SK7709000000005174850550",
      bank_name: "Slovenská sporiteľňa, a.s.",
      currency: "EUR",
      active: true,
      balance: 1903.83,
    },
    {
      id: "f3d167db-6367-42dd-81bc-756359362437",
      iban: "SK2902000000007307806959",
      bank_name: "Všeobecná úverová banka, a.s.",
      currency: "EUR",
      active: true,
      balance: 45870.99,
    },
  ],
};

describe("hľadanie účtu podľa IBAN", () => {
  it("nájde ten správny", () => {
    // Práve toto rozlíšenie sme predtým netrafili: dva slovenské eurové účty
    // tej istej firmy, líšia sa len IBAN-om.
    expect(najdiPodlaIbanu(UCTY, "SK2902000000007307806959")?.id).toBe(
      "f3d167db-6367-42dd-81bc-756359362437",
    );
    expect(najdiPodlaIbanu(UCTY, "SK7709000000005174850550")?.id).toBe(
      "7c9a8242-5b05-4ab6-bc25-f543cf62079b",
    );
  });

  it("nevadia medzery ani malé písmená", () => {
    expect(najdiPodlaIbanu(UCTY, "sk29 0200 0000 0073 0780 6959")?.id).toBe(
      "f3d167db-6367-42dd-81bc-756359362437",
    );
  });

  it("neznámy IBAN vráti null, nie prvý v poradí", () => {
    expect(najdiPodlaIbanu(UCTY, "SK1111000000000000000000")).toBeNull();
  });

  it("cudzí tvar odpovede nezhodí hľadanie", () => {
    expect(najdiPodlaIbanu({ nieco: "ine" }, "SK2902000000007307806959")).toBeNull();
    expect(najdiPodlaIbanu(null, "SK2902000000007307806959")).toBeNull();
  });

  it("normalizácia IBAN-u", () => {
    expect(cistyIban(" sk29 0200-0000 ")).toBe("SK2902000000");
    expect(cistyIban(null)).toBe("");
  });
});
