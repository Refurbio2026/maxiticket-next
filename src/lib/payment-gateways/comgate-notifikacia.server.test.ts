import { describe, it, expect } from "vitest";
import { precitajTelo, rozhodniONotifikacii, rovnakeTajomstvo } from "./comgate-notifikacia.server";

const TAJOMSTVO = "gx4q8OV3TJt6noJnfhjqJKyX3Z6Ych0y";

describe("rovnakeTajomstvo", () => {
  it("rovnaké heslo prejde", () => {
    expect(rovnakeTajomstvo(TAJOMSTVO, TAJOMSTVO)).toBe(true);
  });

  it("cudzie heslo neprejde", () => {
    expect(rovnakeTajomstvo(TAJOMSTVO, "ine-heslo")).toBe(false);
    // Rovnaká dĺžka, jeden znak inak — nech sa nespolieha na dĺžku.
    expect(rovnakeTajomstvo("a".repeat(32), "a".repeat(31) + "b")).toBe(false);
  });

  it("prázdne nikdy neprejde, ani proti prázdnemu", () => {
    expect(rovnakeTajomstvo("", "")).toBe(false);
    expect(rovnakeTajomstvo(TAJOMSTVO, "")).toBe(false);
    expect(rovnakeTajomstvo("", TAJOMSTVO)).toBe(false);
  });
});

describe("precitajTelo — JSON (platby založené cez v2.0)", () => {
  it("prečíta polia", () => {
    const telo = JSON.stringify({
      transId: "AB12-EF34-IJ56",
      refId: "2026001",
      status: "PAID",
      price: 10000,
      curr: "CZK",
      test: false,
      secret: TAJOMSTVO,
    });
    const { polia, notifikacia } = precitajTelo(telo, "application/json");
    expect(notifikacia).toMatchObject({
      transId: "AB12-EF34-IJ56",
      refId: "2026001",
      status: "PAID",
      price: 10000,
      curr: "CZK",
      test: false,
    });
    expect(polia.secret).toBe(TAJOMSTVO);
  });

  it("pozná JSON aj bez správnej hlavičky", () => {
    const telo = JSON.stringify({ transId: "A", status: "PAID", secret: TAJOMSTVO });
    expect(precitajTelo(telo, "text/plain").notifikacia?.transId).toBe("A");
  });

  it("test ako text aj ako boolean", () => {
    expect(
      precitajTelo('{"transId":"A","status":"PAID","test":"true"}', "application/json").notifikacia
        ?.test,
    ).toBe(true);
    expect(
      precitajTelo('{"transId":"A","status":"PAID","test":true}', "application/json").notifikacia
        ?.test,
    ).toBe(true);
    expect(
      precitajTelo('{"transId":"A","status":"PAID","test":false}', "application/json").notifikacia
        ?.test,
    ).toBe(false);
  });
});

describe("precitajTelo — form (platby založené cez v1.0)", () => {
  it("prečíta presne to telo, aké je v dokumentácii ComGate", () => {
    const telo =
      "merchant=123456&test=false&price=10000&curr=CZK&label=Beatles%20-%20Help" +
      "&refId=2010102600&method=CARD&email=info%40customer.com&phone=%2B420123456789" +
      `&transId=AB12-EF34-IJ56&secret=${TAJOMSTVO}&status=PAID`;
    const { polia, notifikacia } = precitajTelo(telo, "application/x-www-form-urlencoded");
    expect(notifikacia).toMatchObject({
      transId: "AB12-EF34-IJ56",
      refId: "2010102600",
      status: "PAID",
      price: 10000,
      curr: "CZK",
      test: false,
    });
    expect(polia.secret).toBe(TAJOMSTVO);
    expect(polia.email).toBe("info@customer.com");
  });

  it("status normalizuje na veľké písmená", () => {
    expect(
      precitajTelo("transId=A&status=paid", "application/x-www-form-urlencoded").notifikacia
        ?.status,
    ).toBe("PAID");
  });
});

describe("precitajTelo — čo odmietne", () => {
  it("bez transId alebo bez stavu nič nevráti", () => {
    expect(precitajTelo("status=PAID", "application/x-www-form-urlencoded").notifikacia).toBeNull();
    expect(precitajTelo("transId=A", "application/x-www-form-urlencoded").notifikacia).toBeNull();
    expect(precitajTelo('{"transId":"A"}', "application/json").notifikacia).toBeNull();
  });

  it("rozbitý JSON nič nevráti a nespadne", () => {
    expect(precitajTelo("{nie json", "application/json").notifikacia).toBeNull();
    expect(precitajTelo("", "application/json").notifikacia).toBeNull();
  });

  it("vnorené objekty ignoruje, nespadne na nich", () => {
    const telo = '{"transId":"A","status":"PAID","nieco":{"vnorene":1}}';
    const { polia, notifikacia } = precitajTelo(telo, "application/json");
    expect(notifikacia?.transId).toBe("A");
    expect(polia.nieco).toBeUndefined();
  });

  it("nečíselnú cenu nepodstrčí ako nulu", () => {
    const n = precitajTelo(
      '{"transId":"A","status":"PAID","price":"nieco"}',
      "application/json",
    ).notifikacia;
    expect(n?.price).toBeNull();
  });
});

describe("rozhodniONotifikacii", () => {
  const telo = (navyse: Record<string, unknown> = {}) =>
    JSON.stringify({ transId: "AB12-CD34-EF56", status: "PAID", secret: TAJOMSTVO, ...navyse });

  it("bez nastaveného hesla brány nespracuje nič", () => {
    expect(rozhodniONotifikacii(telo(), "application/json", null).co).toBe("nenastavene");
    expect(rozhodniONotifikacii(telo(), "application/json", "").co).toBe("nenastavene");
  });

  it("podvrhnuté PAID s cudzím heslom neprejde", () => {
    const utok = JSON.stringify({ transId: "AB12", status: "PAID", secret: "vymyslene" });
    expect(rozhodniONotifikacii(utok, "application/json", TAJOMSTVO).co).toBe("cudzie-heslo");
  });

  it("notifikácia bez hesla neprejde", () => {
    const bezHesla = JSON.stringify({ transId: "AB12", status: "PAID" });
    expect(rozhodniONotifikacii(bezHesla, "application/json", TAJOMSTVO).co).toBe("cudzie-heslo");
  });

  it("heslo sa overuje skôr než čitateľnosť tela", () => {
    // Nečitateľné telo s cudzím heslom má skončiť na hesle, nie na formáte —
    // o formáte sa cudzí volajúci nemá čo dozvedieť.
    expect(rozhodniONotifikacii("{nie json", "application/json", TAJOMSTVO).co).toBe(
      "cudzie-heslo",
    );
  });

  it("správne heslo, ale telo bez transId, je nečitateľné", () => {
    const bezId = JSON.stringify({ status: "PAID", secret: TAJOMSTVO });
    expect(rozhodniONotifikacii(bezId, "application/json", TAJOMSTVO).co).toBe("necitatelne");
  });

  it("platná notifikácia prejde a vráti prečítané polia", () => {
    const r = rozhodniONotifikacii(
      telo({ price: 3200, curr: "EUR", refId: "2026001" }),
      "application/json",
      TAJOMSTVO,
    );
    expect(r.co).toBe("spracuj");
    if (r.co === "spracuj") {
      expect(r.notifikacia).toMatchObject({
        transId: "AB12-CD34-EF56",
        status: "PAID",
        price: 3200,
        curr: "EUR",
        refId: "2026001",
      });
    }
  });

  it("prejde aj form telo, aké posiela brána pri platbách z v1.0", () => {
    const form = `transId=AB12&status=CANCELLED&secret=${TAJOMSTVO}&price=100&curr=CZK`;
    const r = rozhodniONotifikacii(form, "application/x-www-form-urlencoded", TAJOMSTVO);
    expect(r.co).toBe("spracuj");
    if (r.co === "spracuj") expect(r.notifikacia.status).toBe("CANCELLED");
  });
});
