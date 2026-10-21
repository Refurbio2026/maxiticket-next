// ComGate ako platobná brána — karta, Google/Apple Pay a prevody z českých
// aj slovenských bánk, v CZK aj EUR.
//
// Postavené na **v2.0 REST** (apidoc.comgate.cz/en/api/rest): telo je JSON
// a prihlásenie je v hlavičke `Authorization: Basic base64(merchant:secret)`.
// Staršie form API v1.0 by znamenalo posielať `merchant`, `secret`
// aj `prepareOnly` v každom tele.
//
// POZOR, TESTOVACIA PREVÁDZKA SA NEPOZNÁ Z ADRESY: `payments.comgate.cz` je tá
// istá pre test aj ostro a rozhoduje príznak `test` v tele. Preto má brána
// `rezim()` — inak by admin ukazoval „neznáma" a nikto by si nevšimol, že sa
// predáva do piesku.
//
// Prístup k API je u ComGate navyše chránený **zoznamom povolených IP**, ktorý
// sa nastavuje v ich portáli (Integrace → Nastavení obchodu → Napojení
// obchodu). Bez zapísanej IP servera vráti brána chybu bez ohľadu na heslo.
import type { Json } from "@/integrations/supabase/types";
import { hodnota, polozka } from "../pristupy.server";
import {
  chybaSumy,
  mena as normalizujMenu,
  najmensiaJednotka,
  nasStav,
  popisKodu,
  popisPreVypis,
  postavCreate,
  postavRefund,
  precitajOdpoved,
  type Telo,
} from "./comgate-telo";
import type {
  GatewayStatus,
  PaymentGateway,
  PolozkaKonfiguracie,
  StartPaymentInput,
  StartPaymentResult,
  TestBrany,
} from "./types";

const API = "https://payments.comgate.cz/v2.0";

/** Koľko má platba žiť. Držíme sa držania sedadiel, ktoré je 10 minút. */
const EXPIRACIA = "30m";

function obchod(): string | undefined {
  return hodnota("comgate", "COMGATE_MERCHANT");
}

export function tajomstvo(): string | undefined {
  return hodnota("comgate", "COMGATE_SECRET");
}

function jeNakonfigurovany(): boolean {
  return Boolean(obchod() && tajomstvo());
}

/** Testovacia prevádzka je vec príznaku, nie adresy. */
function jeTest(): boolean {
  const v = (hodnota("comgate", "COMGATE_TEST") || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "ano" || v === "áno";
}

export type ComgateOdpoved = { status: number; data: Record<string, unknown>; text: string };

/**
 * Jedno volanie ComGate API.
 *
 * Chyba môže prísť dvoma cestami: HTTP kódom alebo nenulovým `code` v tele pri
 * HTTP 200. Preto sa kontrolujú obe — na to je `overKod`.
 */
export async function volajComgate(
  cesta: string,
  moznosti?: { telo?: Telo; metoda?: "GET" | "POST" | "DELETE" | "PUT" },
): Promise<ComgateOdpoved> {
  const id = obchod();
  const heslo = tajomstvo();
  if (!id || !heslo) {
    throw new Error("ComGate nie je nastavený — chýba identifikátor obchodu alebo heslo.");
  }

  const metoda = moznosti?.metoda ?? (moznosti?.telo ? "POST" : "GET");
  const hlavicky: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${id}:${heslo}`, "utf8").toString("base64")}`,
    Accept: "application/json",
  };
  if (moznosti?.telo) hlavicky["Content-Type"] = "application/json";

  const r = await fetch(`${API}${cesta}`, {
    method: metoda,
    headers: hlavicky,
    body: moznosti?.telo ? JSON.stringify(moznosti.telo) : undefined,
  });
  const text = await r.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* keby brána vrátila HTML chybovú stránku, nech zostane text na hlášku */
  }
  return { status: r.status, data, text };
}

/** Vyhodí chybu, keď volanie nedopadlo dobre — či už HTTP kódom, alebo kódom v tele. */
export function overKod(o: ComgateOdpoved): void {
  const { kod, sprava } = precitajOdpoved(o.data);
  if (o.status >= 300 && kod === -1) {
    throw new Error(`ComGate HTTP ${o.status}: ${o.text.slice(0, 160)}`);
  }
  if (kod !== 0) throw new Error(popisKodu(kod, sprava));
}

export const comgateGateway: PaymentGateway = {
  id: "comgate",
  label: "Karta a bankový prevod (ComGate)",
  hint: "Platba kartou, Google Pay, Apple Pay alebo prevodom z českej aj slovenskej banky. V eurách aj v korunách.",
  isConfigured: jeNakonfigurovany,

  async start(input: StartPaymentInput): Promise<StartPaymentResult> {
    const m = normalizujMenu(input.currency);
    const jednotky = najmensiaJednotka(input.amount);
    const chyba = chybaSumy(jednotky, m);
    if (chyba) throw new Error(chyba);

    const telo = postavCreate({
      jednotky,
      mena: m,
      label: popisPreVypis(input.description, `Objednavka ${input.reference}`),
      refId: input.reference,
      email: input.customer.email ?? null,
      telefon: input.customer.phone ?? null,
      // ComGate chce jedno pole `fullName`; my držíme meno po častiach.
      menoKupujuceho:
        `${input.customer.firstName ?? ""} ${input.customer.lastName ?? ""}`.trim() || null,
      jazyk: input.lang,
      navratUrl: input.returnUrl,
      test: jeTest(),
      expirace: EXPIRACIA,
    });

    const o = await volajComgate("/payment.json", { telo });
    overKod(o);

    const transId = typeof o.data.transId === "string" ? o.data.transId : "";
    const redirect = typeof o.data.redirect === "string" ? o.data.redirect : "";
    if (!transId || !redirect) throw new Error("ComGate nevrátil adresu platby.");

    return { providerRef: transId, redirectUrl: redirect, raw: o.data as Json };
  },

  async getStatus(providerRef: string): Promise<GatewayStatus | null> {
    const o = await volajComgate(`/payment/transId/${encodeURIComponent(providerRef)}.json`);
    overKod(o);
    return { state: nasStav(o.data.status), raw: o.data as Json };
  },

  supportsRefund: true,

  async refund(providerRef: string, amount: number): Promise<{ raw: Json }> {
    // Refundovať sa dá len zaplatená platba; nezaplatenú treba zrušiť
    // (`zrus` nižšie). Čiastočný refund brána dovoľuje.
    const o = await volajComgate("/refund.json", {
      telo: postavRefund({
        transId: providerRef,
        jednotky: najmensiaJednotka(amount),
        test: jeTest(),
      }),
    });
    overKod(o);
    return { raw: o.data as Json };
  },

  async zrus(providerRef: string): Promise<boolean> {
    try {
      const o = await volajComgate(`/payment/transId/${encodeURIComponent(providerRef)}.json`, {
        metoda: "DELETE",
      });
      overKod(o);
      return true;
    } catch {
      // Zrušiť sa dá len platba v stave PENDING. Že to nešlo, nie je chyba —
      // znamená to, že je už zaplatená alebo zrušená.
      return false;
    }
  },

  konfiguracia(): PolozkaKonfiguracie[] {
    return [
      polozka("comgate", {
        premenna: "COMGATE_MERCHANT",
        nazov: "Identifikátor obchodu",
        popis: "Šesťmiestne číslo napojenia obchodu z portálu ComGate",
        povinna: true,
      }),
      polozka("comgate", {
        premenna: "COMGATE_SECRET",
        nazov: "Heslo pre komunikáciu na pozadí",
        popis: "Z portálu ComGate: Integrace → Nastavení obchodu → Napojení obchodu",
        povinna: true,
        tajna: true,
      }),
      polozka("comgate", {
        premenna: "COMGATE_TEST",
        nazov: "Testovacia prevádzka",
        popis:
          "Vyplň 1 pre simulované platby. Prázdne = ostrá prevádzka. Adresa API je pre oboje rovnaká, rozhoduje len toto.",
        povinna: false,
      }),
    ];
  },

  endpoint(): string {
    return API;
  },

  rezim(): "test" | "ostrá" | "neznáma" {
    if (!jeNakonfigurovany()) return "neznáma";
    return jeTest() ? "test" : "ostrá";
  },

  async test(): Promise<TestBrany> {
    // Metódy sa dajú vypýtať bez zakladania platby a overia prístupy aj to,
    // ktoré meny má obchod povolené — presne to, čo chceme vedieť.
    try {
      const o = await volajComgate("/method.json");
      overKod(o);
      const metody = Array.isArray(o.data.methods) ? (o.data.methods as unknown[]) : [];
      return {
        ok: true,
        detail: `Prístupy platia, prevádzka je ${jeTest() ? "test" : "ostrá"}, brána ponúka ${metody.length} platobných metód.`,
      };
    } catch (e) {
      const sprava = e instanceof Error ? e.message : "Spojenie zlyhalo";
      return {
        ok: false,
        // Najčastejšia príčina nie je heslo, ale nezapísaná IP servera.
        detail: `${sprava} — skontroluj aj zoznam povolených IP v portáli ComGate.`,
      };
    }
  },
};
