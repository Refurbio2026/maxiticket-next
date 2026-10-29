// Súhlas s cookies — čistá logika.
//
// PREČO TO MUSÍ BYŤ PRVÉ: meracie kódy (GA4, Google Ads, Meta Pixel) sa
// v projekte dali zadať už dávno, ale na web sa nikdy nevkladali práve
// preto, že chýbal súhlas. Analytické a marketingové cookies sa podľa
// § 109 ods. 8 zákona č. 452/2021 Z. z. a GDPR smú nastaviť len po
// preukázateľnom súhlase — a Meta Pixel navyše posiela údaje mimo EÚ.
// Vložiť ich bez súhlasu by nebola drobnosť, ale porušenie.
//
// NEROZHODNUTÉ ≠ NESÚHLAS: kým sa človek nevyjadrí, nespúšťa sa nič, ale
// lišta sa mu zobrazuje. Preto `null` a nie `false`.

/** Kategórie v tom členení, aké vidí návštevník v lište. */
export const KATEGORIE = {
  nutne: "Nutné na chod stránky",
  analytika: "Meranie návštevnosti",
  marketing: "Reklama a remarketing",
} as const;
export type Kategoria = keyof typeof KATEGORIE;

/**
 * Verzia súhlasu. ZVÝŠIŤ pri každom pridaní nového merača — starý súhlas
 * sa tým stane neplatným a človek sa spýta znova. Bez toho by nový nástroj
 * bežal na základe súhlasu, ktorý sa ho netýkal.
 */
export const VERZIA_SUHLASU = 1;

export type Suhlas = {
  verzia: number;
  analytika: boolean;
  marketing: boolean;
  /** Kedy sa rozhodol — na preukázanie súhlasu treba aj čas. */
  kedy: string;
};

/** Kľúč v prehliadači. Mení sa len s menom značky, nie s verziou. */
export const KLUC_SUHLASU = "eticketo-suhlas-cookies";

/**
 * Prečíta uložený súhlas. `null` znamená „nerozhodnuté" — teda nespúšťať
 * nič a zobraziť lištu.
 *
 * Starší alebo poškodený zápis je tiež `null`: radšej sa spýtať druhý raz
 * než merať na základe niečoho, čomu nerozumieme.
 */
export function precitajSuhlas(ulozene: string | null | undefined): Suhlas | null {
  if (!ulozene) return null;
  try {
    const x = JSON.parse(ulozene) as Partial<Suhlas>;
    if (typeof x !== "object" || x === null) return null;
    if (x.verzia !== VERZIA_SUHLASU) return null;
    if (typeof x.analytika !== "boolean" || typeof x.marketing !== "boolean") return null;
    return {
      verzia: VERZIA_SUHLASU,
      analytika: x.analytika,
      marketing: x.marketing,
      kedy: typeof x.kedy === "string" ? x.kedy : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Súhlas na zápis do prehliadača. */
export function zapisSuhlas(
  volba: { analytika: boolean; marketing: boolean },
  kedy?: string,
): string {
  const s: Suhlas = {
    verzia: VERZIA_SUHLASU,
    analytika: volba.analytika,
    marketing: volba.marketing,
    kedy: kedy ?? new Date().toISOString(),
  };
  return JSON.stringify(s);
}

/**
 * Smie sa spustiť nástroj z tejto kategórie?
 *
 * `nutne` platí vždy — bez nich stránka nefunguje a súhlas sa na ne
 * nevyžaduje. Pri nerozhodnutom súhlase je odpoveď nie.
 */
export function smieSa(suhlas: Suhlas | null, kategoria: Kategoria): boolean {
  if (kategoria === "nutne") return true;
  if (!suhlas) return false;
  return kategoria === "analytika" ? suhlas.analytika : suhlas.marketing;
}

/** „Prijať všetko" a „Odmietnuť všetko" — dve tlačidlá v lište. */
export const VSETKO_ANO = { analytika: true, marketing: true };
export const VSETKO_NIE = { analytika: false, marketing: false };

/**
 * Režim súhlasu pre Google (Consent Mode v2).
 *
 * Google očakáva tieto názvy a hodnoty `granted`/`denied`. Posielajú sa
 * VŽDY, aj pri odmietnutí — tag potom beží v obmedzenom režime a neukladá
 * identifikátory. Keby sa nepošlo nič, Google si predvolí `granted`.
 */
export function googleConsent(suhlas: Suhlas | null): Record<string, "granted" | "denied"> {
  const a = smieSa(suhlas, "analytika") ? "granted" : "denied";
  const m = smieSa(suhlas, "marketing") ? "granted" : "denied";
  return {
    ad_storage: m,
    ad_user_data: m,
    ad_personalization: m,
    analytics_storage: a,
    functionality_storage: "granted",
    security_storage: "granted",
  };
}
