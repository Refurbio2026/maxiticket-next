import { describe, expect, it } from "vitest";
import { porovnaj, precitajRozpad, precitajVyplaty } from "./comgate-vyplaty";

describe("čítanie zoznamu výplat", () => {
  it("prečíta pole záznamov", () => {
    const v = precitajVyplaty([
      {
        transferId: 1234567,
        transferDate: "2026-10-20",
        accountOutgoing: "2035.59",
        currency: "EUR",
      },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0].id).toBe("1234567");
    expect(v[0].datum).toBe("2026-10-20");
    expect(v[0].suma).toBe(2035.59);
  });

  it("nájde pole aj keď je zabalené v objekte", () => {
    expect(precitajVyplaty({ data: [{ transferId: "9", amount: 10 }] })).toHaveLength(1);
  });

  it("prázdny zoznam je prázdny, nie chyba", () => {
    expect(precitajVyplaty([])).toEqual([]);
    expect(precitajVyplaty(null)).toEqual([]);
    expect(precitajVyplaty({ code: 0 })).toEqual([]);
  });

  it("záznam bez identifikátora zahodí — s takým sa nedá pracovať", () => {
    expect(precitajVyplaty([{ amount: 10 }])).toEqual([]);
  });
});

describe("čítanie rozpadu výplaty", () => {
  it("prečíta platby aj s poplatkom", () => {
    const r = precitajRozpad([
      { transId: "GZTX-ITBB-YBVW", price: "19.00", fee: "0.38", refId: "1000033" },
    ]);
    expect(r[0].transId).toBe("GZTX-ITBB-YBVW");
    expect(r[0].suma).toBe(19);
    expect(r[0].poplatok).toBe(0.38);
  });

  it("desatinná čiarka aj medzery v sume", () => {
    expect(precitajRozpad([{ transId: "A", price: "1 234,50" }])[0].suma).toBe(1234.5);
  });
});

describe("porovnanie s našou knihou", () => {
  const rozpad = [
    { transId: "A", suma: 19, poplatok: 0.4, vs: null },
    { transId: "B", suma: 31.06, poplatok: 0.6, vs: null },
  ];

  it("keď sedí, rozdiel je nula", () => {
    const v = porovnaj(
      rozpad,
      new Map([
        ["A", 19],
        ["B", 31.06],
      ]),
    );
    expect(v.rozdiel).toBe(0);
    expect(v.chybajuNam).toEqual([]);
  });

  it("platbu, ktorú nemáme, vymenuje", () => {
    const v = porovnaj(rozpad, new Map([["A", 19]]));
    expect(v.chybajuNam).toEqual(["B"]);
    expect(v.rozdiel).toBeCloseTo(31.06, 2);
  });

  it("inú sumu u tej istej platby ukáže ako rozdiel", () => {
    const v = porovnaj(
      rozpad,
      new Map([
        ["A", 19],
        ["B", 30],
      ]),
    );
    expect(v.rozdiel).toBeCloseTo(1.06, 2);
  });
});
