// GP webpay — platobná brána, cez ktorú ČSOB (a ďalšie banky Global Payments)
// prijíma platby kartou. Komunikuje sa presmerovaním prehliadača; podpisuje sa
// RSA kľúčom obchodníka, overuje verejným kľúčom brány.
//
// Zdroj: GP webpay API HTTP, technická špecifikácia v1.18, a dokument
// „Private key management and Signing messages" v1.3:
//   - reťazec na podpis = hodnoty polí spojené znakom „|" (0x7C), bez medzier,
//   - nevyplnené voliteľné pole sa vynechá celé; prázdne odoslané pole
//     v reťazci zostáva a vzniknú dva oddeľovače vedľa seba,
//   - podpis = RSA (PKCS#1 v1.5) nad SHA-1 odtlačkom, výsledok v BASE64,
//   - DIGEST1 v odpovedi = reťazec pre DIGEST + „|" + MERCHANTNUMBER.
import crypto from "node:crypto";
import fs from "node:fs";
import type { Json } from "@/integrations/supabase/types";
import type {
  GatewayStatus,
  PaymentGateway,
  PaymentState,
  PolozkaKonfiguracie,
  StartPaymentInput,
  StartPaymentResult,
  TestBrany,
} from "./types";
import { nemaRefund } from "./types";
import { hodnota, polozka } from "../pristupy.server";

const SKUSOBNA_BRANA = "https://test.3dsecure.gpwebpay.com/pgw/order.do";

/**
 * Poradie polí požiadavky CREATE_ORDER. Toto poradie je súčasťou podpisu —
 * prehodenie dvoch riadkov znamená, že brána odmietne každú platbu.
 */
export const PORADIE_POZIADAVKY = [
  "MERCHANTNUMBER",
  "OPERATION",
  "ORDERNUMBER",
  "AMOUNT",
  "CURRENCY",
  "DEPOSITFLAG",
  "MERORDERNUM",
  "URL",
  "DESCRIPTION",
  "MD",
  "PAYMETHOD",
  "PAYMETHODS",
  "EMAIL",
  "REFERENCENUMBER",
  "ADDINFO",
] as const;

/** Poradie polí odpovede pre platbu kartou. LANG ani DIGEST doň nepatria. */
export const PORADIE_ODPOVEDE = [
  "OPERATION",
  "ORDERNUMBER",
  "MERORDERNUM",
  "MD",
  "PRCODE",
  "SRCODE",
  "RESULTTEXT",
  "ADDINFO",
  "TOKEN",
  "EXPIRY",
  "ACSRES",
  "ACCODE",
  "PANPATTERN",
  "DAYTOCAPTURE",
  "TOKENREGSTATUS",
  "ACRC",
  "RRN",
  "PAR",
  "TRACEID",
] as const;

/**
 * Poskladá reťazec na podpis. Pole, ktoré v správe nie je, sa preskočí;
 * prázdny reťazec je platná hodnota a v podpise zostáva.
 */
export function podpisovanyRetazec(
  poradie: readonly string[],
  hodnoty: Record<string, string | undefined>,
): string {
  return poradie
    .filter((pole) => hodnoty[pole] !== undefined && hodnoty[pole] !== null)
    .map((pole) => hodnoty[pole])
    .join("|");
}

export function podpisat(retazec: string, privatnyKluc: crypto.KeyObject): string {
  return crypto.createSign("sha1").update(retazec, "utf8").sign(privatnyKluc, "base64");
}

export function overit(retazec: string, podpis: string, verejnyKluc: crypto.KeyObject): boolean {
  try {
    return crypto
      .createVerify("sha1")
      .update(retazec, "utf8")
      .verify(verejnyKluc, Buffer.from(podpis, "base64"));
  } catch {
    // Pokazený base64 alebo nesprávny kľúč — pre nás rovnaká odpoveď ako
    // neplatný podpis.
    return false;
  }
}

/** PRCODE/SRCODE preložené na stav objednávky. 0/0 je jediné „zaplatené". */
export function stavZKodu(prcode: string, srcode: string): PaymentState {
  if (prcode === "0" && srcode === "0") return "paid";
  // 50 = držiteľ karty platbu zrušil. Všetko ostatné je zamietnutie alebo chyba.
  if (prcode === "50") return "cancelled";
  return "failed";
}

/**
 * DESCRIPTION aj MD smú obsahovať iba ASCII 0x20–0x7E. Diakritiku teda
 * zhodíme, zvyšok nahradíme medzerou — inak by brána požiadavku odmietla.
 */
export function ocistiAscii(text: string, maxDlzka: number): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxDlzka);
}

function nacitajKluc(inline?: string, subor?: string): string | undefined {
  if (subor) {
    // Nešifrovaný kľúč v súbore je bežnejší spôsob nasadenia než v .env.
    return fs.readFileSync(subor, "utf8");
  }
  if (!inline) return undefined;
  // V .env sa PEM zvykne uložiť na jeden riadok s „\n" ako dvoma znakmi.
  return inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
}

type Nastavenie = {
  url: string;
  merchantNumber: string;
  privatnyKluc: crypto.KeyObject;
  verejnyKluc: crypto.KeyObject;
};

function nastavenie(): Nastavenie {
  const url = hodnota("gpwebpay", "GPWEBPAY_URL") || SKUSOBNA_BRANA;
  const merchantNumber = hodnota("gpwebpay", "GPWEBPAY_MERCHANT_NUMBER");
  // Kľúč sa dá vložiť v administrácii, alebo nechať ako cestu k súboru
  // v prostredí. Prvé má prednosť.
  const priv = nacitajKluc(
    hodnota("gpwebpay", "GPWEBPAY_PRIVATE_KEY"),
    process.env.GPWEBPAY_PRIVATE_KEY_FILE,
  );
  const pub = nacitajKluc(
    hodnota("gpwebpay", "GPWEBPAY_PUBLIC_KEY"),
    process.env.GPWEBPAY_PUBLIC_KEY_FILE,
  );
  if (!merchantNumber || !priv || !pub) {
    throw new Error(
      "GP webpay nie je nakonfigurovaný — doplň obchodné číslo a oba kľúče " +
        "v Systém → Platobné brány.",
    );
  }
  return {
    url,
    merchantNumber,
    privatnyKluc: crypto.createPrivateKey({
      key: priv,
      passphrase: hodnota("gpwebpay", "GPWEBPAY_PRIVATE_KEY_PASSPHRASE") || undefined,
    }),
    // Verejný kľúč brány chodí ako certifikát X.509; createPublicKey ho zvládne.
    verejnyKluc: crypto.createPublicKey(pub),
  };
}

export function jeNakonfigurovany(): boolean {
  try {
    nastavenie();
    return true;
  } catch {
    return false;
  }
}

/** Číselný kód meny podľa ISO 4217 — brána písmenový kód neprijíma. */
const KODY_MEN: Record<string, string> = { EUR: "978", CZK: "203", USD: "840" };

export function postavPoziadavku(
  input: StartPaymentInput,
  cfg: Pick<Nastavenie, "merchantNumber" | "privatnyKluc" | "url">,
): { url: string; polia: Record<string, string> } {
  const mena = KODY_MEN[input.currency?.toUpperCase() || "EUR"];
  if (!mena) throw new Error(`GP webpay nepozná menu ${input.currency}`);

  const hodnoty: Record<string, string | undefined> = {
    MERCHANTNUMBER: cfg.merchantNumber,
    OPERATION: "CREATE_ORDER",
    ORDERNUMBER: input.reference,
    // Suma v najmenších jednotkách meny, teda v centoch.
    AMOUNT: String(Math.round(input.amount * 100)),
    CURRENCY: mena,
    // 1 = peniaze sa majú rovno strhnúť, nie iba zablokovať.
    DEPOSITFLAG: "1",
    URL: input.returnUrl,
    DESCRIPTION: ocistiAscii(input.description, 255),
    // MD sa vráti nezmenené. Nesie id objednávky, takže návrat vieme spárovať
    // bez toho, aby sme čokoľvek dávali do návratovej adresy — GP webpay
    // adresy s parametrami z bezpečnostných dôvodov blokuje.
    MD: input.orderId,
    EMAIL: input.customer.email || undefined,
  };

  const retazec = podpisovanyRetazec(PORADIE_POZIADAVKY, hodnoty);
  const polia: Record<string, string> = {};
  for (const [k, v] of Object.entries(hodnoty)) if (v !== undefined) polia[k] = v;
  polia.DIGEST = podpisat(retazec, cfg.privatnyKluc);
  // LANG do podpisu nepatrí a musí sa pridať až po ňom.
  polia.LANG = (input.lang || "sk").toUpperCase().slice(0, 2);

  return { url: `${cfg.url}?${new URLSearchParams(polia).toString()}`, polia };
}

export type NavratGpWebpay = {
  orderId: string | null;
  orderNumber: string | null;
  state: PaymentState;
  prcode: string;
  srcode: string;
  resultText: string;
  raw: Record<string, string>;
};

/**
 * Overí návrat z brány a preloží ho na stav objednávky. Vracia `null`, keď
 * podpis nesedí — vtedy sa s objednávkou nesmie hnúť.
 */
export function overNavrat(params: Record<string, string>): NavratGpWebpay | null {
  const cfg = nastavenie();
  const digest = params.DIGEST;
  const digest1 = params.DIGEST1;
  if (!digest || !digest1) return null;

  const retazec = podpisovanyRetazec(PORADIE_ODPOVEDE, params);
  if (!overit(retazec, digest, cfg.verejnyKluc)) return null;
  // DIGEST1 navyše dokazuje, že odpoveď patrí práve nášmu obchodnému číslu.
  if (!overit(`${retazec}|${cfg.merchantNumber}`, digest1, cfg.verejnyKluc)) return null;

  const prcode = params.PRCODE ?? "";
  const srcode = params.SRCODE ?? "";
  // Do MD si brána môže pripísať vlastné „#ID=…"; id objednávky je pred ním.
  const md = (params.MD || "").split("#")[0].trim();
  return {
    orderId: md || null,
    orderNumber: params.ORDERNUMBER || null,
    state: stavZKodu(prcode, srcode),
    prcode,
    srcode,
    resultText: params.RESULTTEXT || "",
    raw: params,
  };
}

export const gpWebpayGateway: PaymentGateway = {
  id: "gpwebpay",
  label: "Platobná karta (ČSOB / GP webpay)",
  hint: "Visa, Mastercard, Apple Pay a Google Pay cez bránu GP webpay.",
  isConfigured: jeNakonfigurovany,

  async start(input: StartPaymentInput): Promise<StartPaymentResult> {
    const cfg = nastavenie();
    const { url, polia } = postavPoziadavku(input, cfg);
    // ORDERNUMBER je u GP webpay jediný identifikátor platby — vlastné id
    // platby brána nevracia.
    return {
      providerRef: input.reference,
      redirectUrl: url,
      raw: { ...polia, DIGEST: "[skryté]" } as Json,
    };
  },

  async getStatus(): Promise<GatewayStatus | null> {
    // HTTP rozhranie GP webpay dopyt na stav nemá — výsledok chodí výlučne
    // návratom zákazníka. Dopytovať sa dá len cez samostatné WS rozhranie,
    // ktoré nemáme nasadené.
    return null;
  },

  supportsRefund: false,
  async refund() {
    return nemaRefund("gpwebpay");
  },

  konfiguracia(): PolozkaKonfiguracie[] {
    // Kľúč môže prísť aj ako cesta k súboru v prostredí — vtedy sa v admine
    // tvári ako vyplnený zo servera, aj keď v tabuľke nie je.
    const zoSuboru = (cesta?: string) => {
      if (!cesta) return false;
      try {
        return fs.statSync(cesta).isFile();
      } catch {
        // Cesta je zadaná, ale súbor tam nie je — pre admina je to
        // „nevyplnené", nech nehľadá chybu inde.
        return false;
      }
    };
    return [
      polozka("gpwebpay", {
        premenna: "GPWEBPAY_MERCHANT_NUMBER",
        nazov: "Obchodné číslo",
        popis: "Číslo obchodníka pridelené bankou",
        povinna: true,
      }),
      polozka("gpwebpay", {
        premenna: "GPWEBPAY_PRIVATE_KEY",
        nazov: "Súkromný kľúč obchodníka",
        popis: "Celý PEM z portálu GP webpay, aj s riadkami BEGIN a END",
        povinna: true,
        tajna: true,
        viacriadkova: true,
        inyZdroj: () => zoSuboru(process.env.GPWEBPAY_PRIVATE_KEY_FILE),
      }),
      polozka("gpwebpay", {
        premenna: "GPWEBPAY_PRIVATE_KEY_PASSPHRASE",
        nazov: "Heslo k súkromnému kľúču",
        popis: "Len ak je kľúč zašifrovaný",
        povinna: false,
        tajna: true,
      }),
      polozka("gpwebpay", {
        premenna: "GPWEBPAY_PUBLIC_KEY",
        nazov: "Verejný kľúč brány",
        popis: "Certifikát banky — bez neho sa nedá overiť odpoveď o zaplatení",
        povinna: true,
        viacriadkova: true,
        inyZdroj: () => zoSuboru(process.env.GPWEBPAY_PUBLIC_KEY_FILE),
      }),
      polozka("gpwebpay", {
        premenna: "GPWEBPAY_URL",
        nazov: "Adresa brány",
        popis:
          "Ostrá je https://3dsecure.gpwebpay.com/pgw/order.do; bez vyplnenia sa použije testovacia",
        povinna: false,
      }),
    ];
  },

  endpoint(): string {
    return hodnota("gpwebpay", "GPWEBPAY_URL") || SKUSOBNA_BRANA;
  },

  async test(): Promise<TestBrany> {
    // GP webpay nemá endpoint na overenie prístupov — jediné, čo sa dá
    // skontrolovať bez zakladania platby, sú kľúče. Tak to aj napíšeme,
    // nech to nevyzerá ako záruka, že brána platbu prijme.
    const cfg = nastavenie();
    const vzorka = podpisovanyRetazec(PORADIE_POZIADAVKY, {
      MERCHANTNUMBER: cfg.merchantNumber,
      OPERATION: "CREATE_ORDER",
      ORDERNUMBER: "1",
      AMOUNT: "100",
      CURRENCY: "978",
      DEPOSITFLAG: "1",
      URL: "https://example.test/",
    });
    const podpis = podpisat(vzorka, cfg.privatnyKluc);
    if (!podpis) return { ok: false, detail: "Súkromným kľúčom sa nepodarilo podpísať." };
    if (cfg.verejnyKluc.asymmetricKeyType !== "rsa") {
      return { ok: false, detail: "Verejný kľúč brány nie je RSA." };
    }
    return {
      ok: true,
      detail:
        "Kľúče sa načítali a podpis sa vytvoril. Či ho brána prijme, ukáže až " +
        "prvá skúšobná platba — GP webpay overenie prístupov naprázdno nepozná.",
    };
  },
};
