// ComGate: skladanie tiel, meny a limity.
//
// Čisté funkcie, žiadna sieť ani databáza — tu sa počítajú peniaze a prevádza
// mena, takže to má byť pokryté testami.
//
// Staviame na **v2.0 REST** (JSON + Basic auth), nie na staršom form API v1.0:
// autentifikácia je v hlavičke, telo je JSON a nemusíme posielať `merchant`,
// `secret` ani `prepareOnly` v tele. Zdroj: apidoc.comgate.cz/en/api/rest.
//
// POZOR NA JEDNOTKY: `price` aj `amount` sú **celé čísla v najmenšej jednotke**
// (halier, cent). `price: 1000` s `curr: "CZK"` je 10,00 Kč.

/** Meny, v ktorých predávame. ComGate podporuje aj ďalšie, my tieto dve. */
export const MENY = ["EUR", "CZK"] as const;
export type Mena = (typeof MENY)[number];

/**
 * Limity ComGate na jednu platbu, v najmenšej jednotke.
 *
 * Z dokumentácie (min 1 CZK, 0,1 EUR; max 1 000 000 CZK, 40 000 EUR). Keď
 * sumu neprepustíme my, odmietne ju ComGate chybou 1309 alebo 1107 a zákazník
 * uvidí len „platba sa nedá založiť" — lepšie je povedať to zrozumiteľne tu.
 */
export const LIMITY: Record<Mena, { min: number; max: number }> = {
  CZK: { min: 100, max: 100_000_000 },
  EUR: { min: 10, max: 4_000_000 },
};

/** Štát, podľa ktorého ComGate ponúkne platobné metódy. */
const STAT_PRE_MENU: Record<Mena, string> = { EUR: "SK", CZK: "CZ" };

/** Jazyky, ktoré brána pozná (ISO 639-1). Čokoľvek iné → čeština, jej default. */
const JAZYKY = new Set([
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "fi",
  "fr",
  "hr",
  "hu",
  "it",
  "lt",
  "lv",
  "nl",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sl",
  "sk",
  "sv",
  "uk",
  "vi",
]);

export function jeMena(x: unknown): x is Mena {
  return typeof x === "string" && (MENY as readonly string[]).includes(x.toUpperCase());
}

/** Normalizuje menu; neznámu odmietne, nech sa nepredáva v niečom, čo brána nevie. */
export function mena(x: unknown): Mena {
  const m = typeof x === "string" ? x.toUpperCase() : "";
  if (!jeMena(m)) {
    throw new Error(`ComGate nepodporuje menu '${String(x)}'. Povolené: ${MENY.join(", ")}.`);
  }
  return m as Mena;
}

/** Suma na najmenšiu jednotku. Zaokrúhľuje — zlomok haliera neexistuje. */
export function najmensiaJednotka(suma: number): number {
  if (!Number.isFinite(suma)) throw new Error("Suma nie je číslo");
  if (suma < 0) throw new Error("Suma nemôže byť negatívna");
  return Math.round(suma * 100);
}

/** Overí sumu proti limitom meny. Vracia hlášku, alebo `null` keď je v poriadku. */
export function chybaSumy(jednotky: number, m: Mena): string | null {
  const { min, max } = LIMITY[m];
  const naPeniaze = (x: number) => (x / 100).toLocaleString("sk-SK", { minimumFractionDigits: 2 });
  if (jednotky < min) return `Najmenšia platba cez ComGate je ${naPeniaze(min)} ${m}.`;
  if (jednotky > max) return `Najväčšia platba cez ComGate je ${naPeniaze(max)} ${m}.`;
  return null;
}

export function statPreMenu(m: Mena): string {
  return STAT_PRE_MENU[m];
}

export function jazykPreComgate(jazyk: string | null | undefined): string {
  const j = (jazyk || "").toLowerCase().slice(0, 2);
  return JAZYKY.has(j) ? j : "cs";
}

/**
 * `label` smie mať 1–16 znakov. Názvy podujatí sú dlhšie, takže sa skracujú;
 * zákazník ho vidí v bankovom výpise, preto nech je to aspoň čosi rozpoznateľné.
 */
export function popisPreVypis(nazov: string, zaloha: string): string {
  const cisty = (nazov || "").replace(/\s+/g, " ").trim();
  const text = cisty || zaloha;
  return text.slice(0, 16) || "Vstupenky";
}

export type CreateVstup = {
  /** Suma v najmenšej jednotke. */
  jednotky: number;
  mena: Mena;
  /** 1–16 znakov, ide do výpisu. */
  label: string;
  /** Variabilný symbol / číslo objednávky. */
  refId: string;
  email: string | null;
  telefon: string | null;
  menoKupujuceho: string | null;
  jazyk: string;
  /** Kam sa zákazník vráti; používa sa pre všetky tri stavy. */
  navratUrl: string;
  /** `true` = simulovaná platba. */
  test: boolean;
  /** Po akom čase platba vyprší, napr. `30m`. */
  expirace?: string;
};

export type Telo = Record<string, unknown>;

/**
 * Telo pre `POST /v2.0/payment.json`.
 *
 * `method: "ALL"` necháva výber metódy na zákazníkovi v okne ComGate.
 * `country` sa viaže na menu (CZ+CZK, SK+EUR) — podľa dokumentácie to
 * rozhoduje, aké metódy sa ponúknu.
 *
 * Všetky tri návratové adresy sú rovnaké: naša stránka objednávky si stav
 * aj tak dopýta sama, takže nepotrebuje vedieť z adresy, ako to skončilo.
 */
export function postavCreate(v: CreateVstup): Telo {
  if (!v.email && !v.telefon) {
    throw new Error("ComGate vyžaduje e-mail alebo telefón kupujúceho.");
  }
  const chyba = chybaSumy(v.jednotky, v.mena);
  if (chyba) throw new Error(chyba);

  return {
    price: v.jednotky,
    curr: v.mena,
    label: v.label,
    refId: v.refId,
    method: "ALL",
    country: statPreMenu(v.mena),
    lang: jazykPreComgate(v.jazyk),
    email: v.email || undefined,
    // Telefón posielame len v medzinárodnom tvare — inak ho brána odmietne.
    phone: v.telefon && /^\+[0-9]{7,15}$/.test(v.telefon) ? v.telefon : undefined,
    fullName: v.menoKupujuceho || undefined,
    category: "OTHER",
    delivery: "ELECTRONIC_DELIVERY",
    test: v.test,
    expirationTime: v.expirace,
    url_paid: v.navratUrl,
    url_cancelled: v.navratUrl,
    url_pending: v.navratUrl,
  };
}

/** Telo pre `POST /v2.0/refund.json`. */
export function postavRefund(v: {
  transId: string;
  jednotky: number;
  test: boolean;
  refId?: string | null;
}): Telo {
  if (v.jednotky <= 0) throw new Error("Refundovaná suma musí byť väčšia než nula.");
  return {
    transId: v.transId,
    amount: v.jednotky,
    test: v.test,
    refId: v.refId || undefined,
  };
}

/** Stav platby u ComGate → náš stav. */
export type ComgateStatus = "PENDING" | "PAID" | "CANCELLED" | "AUTHORIZED";

export function nasStav(status: unknown): "pending" | "paid" | "cancelled" {
  switch (String(status ?? "").toUpperCase()) {
    case "PAID":
      return "paid";
    case "CANCELLED":
      return "cancelled";
    // AUTHORIZED je len predautorizácia karty — peniaze ešte neprišli a bez
    // `capturePreauth` ani neprídu. My predautorizáciu nepoužívame, takže keby
    // sa objavila, je to rozhodne nie „zaplatené".
    case "AUTHORIZED":
    case "PENDING":
    default:
      return "pending";
  }
}

/**
 * Prečíta odpoveď ComGate. Nenulový `code` je chyba aj pri HTTP 200 —
 * brána vracia stav v tele, nie v HTTP kóde.
 */
export function precitajOdpoved(data: unknown): { kod: number; sprava: string } {
  const d = (data ?? {}) as Record<string, unknown>;
  const kod = Number(d.code);
  return {
    kod: Number.isFinite(kod) ? kod : -1,
    sprava: typeof d.message === "string" ? d.message : "",
  };
}

/** Čo znamenajú kódy, ktoré sa nám môžu reálne vrátiť. */
const KODY: Record<number, string> = {
  1102: "jazyk nie je podporovaný",
  1103: "nesprávne zadaná metóda platby",
  1104: "platbu sa nepodarilo načítať",
  1107: "táto cena nie je podporovaná",
  1301: "neznámy e-shop — skontroluj identifikátor obchodu",
  1303: "chýba odkaz alebo jazyk",
  1304: "neplatná kategória",
  1305: "chýba popis produktu",
  1306: "zvoľ správnu metódu platby",
  1308: "zvolená metóda platby nie je povolená",
  1309: "nesprávna suma",
  1310: "neznáma mena — má ju obchod povolenú?",
  1311: "neplatný identifikátor bankového účtu",
  1400: "chybná požiadavka",
  1401: "refundovaná platba je v stave CANCELLED",
  1402: "refundovaná suma je vyššia než povolená",
  1500: "neočekávaná chyba na strane ComGate",
};

export function popisKodu(kod: number, sprava: string): string {
  const znamy = KODY[kod];
  if (znamy) return `ComGate ${kod}: ${znamy}`;
  return `ComGate ${kod}${sprava ? `: ${sprava}` : ""}`;
}
