import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";
import {
  PORADIE_ODPOVEDE,
  PORADIE_POZIADAVKY,
  ocistiAscii,
  overit,
  podpisat,
  podpisovanyRetazec,
  stavZKodu,
} from "./gpwebpay.server";

let par: crypto.KeyPairKeyObjectResult;
beforeAll(() => {
  par = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
});

describe("podpisovanyRetazec", () => {
  it("spojí polia zvislou čiarou v predpísanom poradí", () => {
    const retazec = podpisovanyRetazec(PORADIE_POZIADAVKY, {
      MERCHANTNUMBER: "1234567890",
      OPERATION: "CREATE_ORDER",
      ORDERNUMBER: "1000001",
      AMOUNT: "1250",
      CURRENCY: "978",
      DEPOSITFLAG: "1",
      URL: "https://eticketo.eu/api/public/payments/gpwebpay/return",
    });
    expect(retazec).toBe(
      "1234567890|CREATE_ORDER|1000001|1250|978|1|https://eticketo.eu/api/public/payments/gpwebpay/return",
    );
  });

  it("vynechá pole, ktoré sa neposiela", () => {
    expect(podpisovanyRetazec(["A", "B", "C"], { A: "1", C: "3" })).toBe("1|3");
  });

  it("prázdne odoslané pole nechá v reťazci ako dva oddeľovače vedľa seba", () => {
    // Presne ten rozdiel, ktorý dokumentácia zdôrazňuje: nevyplnené pole sa
    // vynechá, ale prázdne odoslané pole v podpise zostáva.
    expect(podpisovanyRetazec(["A", "B", "C"], { A: "1", B: "", C: "3" })).toBe("1||3");
  });

  it("nezáleží na poradí kľúčov v objekte, len na predpísanom poradí polí", () => {
    const a = podpisovanyRetazec(["A", "B"], { B: "2", A: "1" });
    const b = podpisovanyRetazec(["A", "B"], { A: "1", B: "2" });
    expect(a).toBe(b);
    expect(a).toBe("1|2");
  });
});

describe("podpis a overenie", () => {
  const retazec = "1234567890|CREATE_ORDER|1000001|1250|978|1|https://eticketo.eu/x";

  it("vlastný podpis prejde overením", () => {
    expect(overit(retazec, podpisat(retazec, par.privateKey), par.publicKey)).toBe(true);
  });

  it("zmena jediného znaku v správe podpis zneplatní", () => {
    const podpis = podpisat(retazec, par.privateKey);
    expect(overit(retazec.replace("1250", "1251"), podpis, par.publicKey)).toBe(false);
  });

  it("podpis cudzím kľúčom neprejde", () => {
    const cudzi = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(overit(retazec, podpisat(retazec, cudzi.privateKey), par.publicKey)).toBe(false);
  });

  it("pokazený base64 nezhodí overenie, len ho neprejde", () => {
    expect(overit("a|b", "toto nie je base64 %%%", par.publicKey)).toBe(false);
  });

  it("podpisuje sa SHA-1 s RSA", () => {
    const rucne = crypto
      .sign("sha1", Buffer.from(retazec, "utf8"), par.privateKey)
      .toString("base64");
    expect(podpisat(retazec, par.privateKey)).toBe(rucne);
  });
});

describe("odpoveď brány", () => {
  it("DIGEST1 je reťazec pre DIGEST plus obchodné číslo", () => {
    const zaklad = podpisovanyRetazec(PORADIE_ODPOVEDE, {
      OPERATION: "CREATE_ORDER",
      ORDERNUMBER: "1000001",
      MD: "3f1c2b7a-0000-4000-8000-000000000001",
      PRCODE: "0",
      SRCODE: "0",
      RESULTTEXT: "OK",
    });
    expect(zaklad).toBe("CREATE_ORDER|1000001|3f1c2b7a-0000-4000-8000-000000000001|0|0|OK");

    const digest1 = podpisat(zaklad + "|1234567890", par.privateKey);
    expect(overit(zaklad + "|1234567890", digest1, par.publicKey)).toBe(true);
    // Cudzie obchodné číslo tú istú odpoveď neprejde — to je zmysel DIGEST1.
    expect(overit(zaklad + "|9999999999", digest1, par.publicKey)).toBe(false);
  });
});

describe("stavZKodu", () => {
  it("0/0 je zaplatené", () => expect(stavZKodu("0", "0")).toBe("paid"));
  it("50 je zrušené zákazníkom", () => expect(stavZKodu("50", "0")).toBe("cancelled"));
  it("30 je neúspech", () => expect(stavZKodu("30", "1001")).toBe("failed"));
  it("nulový PRCODE s nenulovým SRCODE nie je zaplatené", () =>
    expect(stavZKodu("0", "1")).toBe("failed"));
});

describe("ocistiAscii", () => {
  it("zhodí diakritiku a nechá text čitateľný", () => {
    expect(ocistiAscii("Vstupenky vipky.sk — Ľuboš Ščasný", 255)).toBe(
      "Vstupenky vipky.sk Lubos Scasny",
    );
  });

  it("skráti na povolenú dĺžku", () => {
    expect(ocistiAscii("a".repeat(300), 255)).toHaveLength(255);
  });

  it("nenechá znak mimo povoleného rozsahu ASCII", () => {
    const out = ocistiAscii("Ťažké znaky a šípka", 255);
    expect([...out].every((z) => z.charCodeAt(0) >= 0x20 && z.charCodeAt(0) <= 0x7e)).toBe(true);
  });
});
