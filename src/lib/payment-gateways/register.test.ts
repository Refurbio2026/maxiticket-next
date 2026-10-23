// Register brán musí byť konzistentný sám so sebou.
//
// Vznikol po chybe, ktorá stála hodinu hľadania: ComGate pribudol do typu
// `GatewayId` aj do registra, ale do konstanty `GATEWAY_IDS` nie — prettier
// si pole preformátoval do jedného riadku a náhrada ho minula. Typ to
// nezachytil (`readonly GatewayId[]` nevyžaduje úplnosť) a prejavilo sa to až
// tým, že sa prístupy k bráne nedali uložiť a platba by sa nikdy nedoúčtovala.
import { describe, it, expect } from "vitest";
import { GATEWAY_IDS, jeBrana, type GatewayId } from "./types";
import { goPayGateway } from "./gopay.gateway.server";
import { gpWebpayGateway } from "./gpwebpay.server";
import { tatraPayPlusGateway } from "./tatrapayplus.server";
import { stripeGateway } from "./stripe.gateway.server";
import { comgateGateway } from "./comgate.gateway.server";

const BRANY = [goPayGateway, gpWebpayGateway, tatraPayPlusGateway, stripeGateway, comgateGateway];

describe("GATEWAY_IDS", () => {
  it("obsahuje každú bránu, ktorá existuje", () => {
    for (const brana of BRANY) {
      expect(GATEWAY_IDS, `brána ${brana.id} chýba v GATEWAY_IDS`).toContain(brana.id);
    }
  });

  it("neobsahuje nič, čo nie je brána", () => {
    const skutocne = new Set<string>(BRANY.map((b) => b.id));
    for (const id of GATEWAY_IDS) {
      expect(skutocne, `${id} je v GATEWAY_IDS, ale žiadna taká brána nie je`).toContain(id);
    }
  });

  it("`jeBrana` pozná každú bránu", () => {
    // Bez toho by doúčtovanie platbu pokladalo za prevod a nikdy by si
    // nedopýtalo jej stav.
    for (const brana of BRANY) {
      expect(jeBrana(brana.id), `jeBrana('${brana.id}') vracia false`).toBe(true);
    }
  });

  it("`jeBrana` odmietne prevod a nezmysly", () => {
    expect(jeBrana("prevod")).toBe(false);
    expect(jeBrana("")).toBe(false);
    expect(jeBrana(null)).toBe(false);
    expect(jeBrana(undefined)).toBe(false);
  });

  it("žiadne dve brány nemajú to isté id", () => {
    const ids = BRANY.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("každá brána je úplná", () => {
  it("má označenie, popis aj aspoň jednu povinnú položku konfigurácie", () => {
    for (const brana of BRANY) {
      expect(brana.label.length, `${brana.id} bez label`).toBeGreaterThan(2);
      expect(brana.hint.length, `${brana.id} bez hint`).toBeGreaterThan(2);
      const povinne = brana.konfiguracia().filter((k) => k.povinna);
      expect(povinne.length, `${brana.id} nemá povinné prístupy`).toBeGreaterThan(0);
    }
  });

  it("názvy premenných sú unikátne v rámci brány", () => {
    for (const brana of BRANY) {
      const nazvy = brana.konfiguracia().map((k) => k.premenna);
      expect(new Set(nazvy).size, `${brana.id} má duplicitnú premennú`).toBe(nazvy.length);
    }
  });

  it("brána, ktorá nemá prístupy, sa nehlási ako nakonfigurovaná", () => {
    // V testovacom prostredí nie sú vyplnené žiadne prístupy, takže všetky
    // brány musia povedať „nie som nastavená" — inak by sa v checkoute
    // ponúkla brána, ktorou sa nedá zaplatiť.
    for (const brana of BRANY) {
      expect(brana.isConfigured(), `${brana.id} tvrdí, že je nastavená`).toBe(false);
    }
  });

  it("brány bez poznateľného režimu z adresy ho hlásia samy", () => {
    // Stripe aj ComGate majú pre test a ostro tú istú adresu, takže musia
    // implementovať `rezim()`. Bez toho by admin ukazoval „neznáma".
    expect(typeof stripeGateway.rezim).toBe("function");
    expect(typeof comgateGateway.rezim).toBe("function");
  });
});

describe("typ a konstanta sa nerozídu", () => {
  it("každé id z GATEWAY_IDS je priraditeľné do GatewayId", () => {
    // Keby v konstante bolo id, ktoré typ nepozná, tento súbor sa nepreloží.
    const ids: GatewayId[] = [...GATEWAY_IDS];
    expect(ids.length).toBe(GATEWAY_IDS.length);
  });
});
