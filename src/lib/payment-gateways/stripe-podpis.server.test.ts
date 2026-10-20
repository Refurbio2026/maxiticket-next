import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { TOLERANCIA_S, overPodpis, rozparsujHlavicku } from "./stripe-podpis.server";

const TAJOMSTVO = "whsec_testovacie_tajomstvo";
const TELO = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
const TERAZ = 1_792_400_000;

function podpis(telo: string, t: number, tajomstvo = TAJOMSTVO): string {
  const v1 = crypto.createHmac("sha256", tajomstvo).update(`${t}.${telo}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
}

describe("rozparsujHlavicku", () => {
  it("prečíta čas aj podpis", () => {
    const { t, v1 } = rozparsujHlavicku("t=123,v1=abc123");
    expect(t).toBe(123);
    expect(v1).toEqual(["abc123"]);
  });

  it("zvládne viac podpisov pri rotácii kľúča", () => {
    const { v1 } = rozparsujHlavicku("t=1,v1=aa,v1=BB,v0=cc");
    expect(v1).toEqual(["aa", "bb"]);
  });

  it("nezmysel zahodí namiesto toho, aby ho prijala", () => {
    expect(rozparsujHlavicku("").t).toBeNull();
    expect(rozparsujHlavicku("t=neskoro,v1=aa").t).toBeNull();
    expect(rozparsujHlavicku("t=1,v1=nie-hex!").v1).toEqual([]);
  });
});

describe("overPodpis", () => {
  it("platný podpis prejde", () => {
    const r = overPodpis(TELO, podpis(TELO, TERAZ), TAJOMSTVO, { teraz: TERAZ });
    expect(r.ok).toBe(true);
  });

  it("prejde aj keď je medzi podpismi jeden cudzí (rotácia kľúča)", () => {
    const spravny = podpis(TELO, TERAZ).split("v1=")[1];
    const hlavicka = `t=${TERAZ},v1=${"0".repeat(64)},v1=${spravny}`;
    expect(overPodpis(TELO, hlavicka, TAJOMSTVO, { teraz: TERAZ }).ok).toBe(true);
  });

  it("zmenené telo neprejde — ani o jeden znak", () => {
    const h = podpis(TELO, TERAZ);
    const r = overPodpis(`${TELO} `, h, TAJOMSTVO, { teraz: TERAZ });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.dovod).toBe("podpis nesedí");
  });

  it("podvrhnutá suma v tele neprejde", () => {
    const utok = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", amount: 1 });
    expect(overPodpis(utok, podpis(TELO, TERAZ), TAJOMSTVO, { teraz: TERAZ }).ok).toBe(false);
  });

  it("cudzí kľúč neprejde", () => {
    const h = podpis(TELO, TERAZ, "whsec_ine");
    expect(overPodpis(TELO, h, TAJOMSTVO, { teraz: TERAZ }).ok).toBe(false);
  });

  it("starý podpis neprejde — zabráni prehraniu notifikácie", () => {
    const stary = podpis(TELO, TERAZ - TOLERANCIA_S - 1);
    const r = overPodpis(TELO, stary, TAJOMSTVO, { teraz: TERAZ });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.dovod).toContain("starý");
  });

  it("na hranici tolerancie ešte prejde", () => {
    const h = podpis(TELO, TERAZ - TOLERANCIA_S);
    expect(overPodpis(TELO, h, TAJOMSTVO, { teraz: TERAZ }).ok).toBe(true);
  });

  it("rozbehnuté hodiny servera o pár sekúnd dopredu neublížia", () => {
    const h = podpis(TELO, TERAZ + 30);
    expect(overPodpis(TELO, h, TAJOMSTVO, { teraz: TERAZ }).ok).toBe(true);
  });

  it("bez tajomstva ani bez hlavičky nikdy neprejde", () => {
    expect(overPodpis(TELO, podpis(TELO, TERAZ), "", { teraz: TERAZ }).ok).toBe(false);
    expect(overPodpis(TELO, "", TAJOMSTVO, { teraz: TERAZ }).ok).toBe(false);
  });

  it("prázdna hlavička s podpisom bez v1 neprejde", () => {
    const r = overPodpis(TELO, `t=${TERAZ}`, TAJOMSTVO, { teraz: TERAZ });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.dovod).toContain("v1");
  });
});
