// Doručenie vstupeniek poštou — cena a kontrola adresy.
//
// Prečo zvlášť od `eph.ts`: tam ide o to, čo prijme pošta pri podaji. Tu ide
// o to, čo vyplní zákazník v pokladni a koľko mu k objednávke pripočítame.
// Obe kontroly musia prejsť, ale zákazníkovi hovoríme jeho jazykom —
// „Vyplň PSČ", nie `validation_failed`.
//
// CENA JE PEVNÁ. Nepočíta sa z hmotnosti ani z tarify pošty: obálka so
// vstupenkami váži do 50 g a tarifu si organizátor nastaví v admine. Keby sa
// cena odvodzovala z cenníka pošty, museli by sme ho v kóde udržiavať aktuálny
// a pri každej zmene tarify by sa zákazníkom menila cena bez vedomia
// organizátora.

import { skontrolujAdresu, type Chyba } from "./eph";

export const SPOSOBY_DORUCENIA = {
  email: "E-mailom",
  posta: "Poštou na adresu",
} as const;
export type SposobDorucenia = keyof typeof SPOSOBY_DORUCENIA;

export function jeSposobDorucenia(h: unknown): h is SposobDorucenia {
  return h === "email" || h === "posta";
}

export type AdresaDorucenia = {
  meno?: string | null;
  ulica?: string | null;
  mesto?: string | null;
  psc?: string | null;
  krajina?: string | null;
};

/** Zaokrúhlenie na centy — na sumu, ktorá ide do objednávky aj na faktúru. */
export function naCenty(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Koľko zaplatí zákazník za doručenie.
 *
 * Pri e-maile vždy nula — vstupenka s QR kódom nás nestojí nič a je to
 * predvolená cesta. Pri pošte pevná suma z nastavenia; keď nie je nastavená,
 * doručenie poštou sa vôbec nenabíha (viď `doruceniePostouMozne`).
 */
export function cenaDorucenia(sposob: SposobDorucenia, postovne: number | null): number {
  if (sposob !== "posta") return 0;
  const suma = Number(postovne);
  if (!Number.isFinite(suma) || suma <= 0) return 0;
  return naCenty(suma);
}

/**
 * Smie si zákazník vybrať poštu? Len keď je doručovanie zapnuté A je určená
 * cena. Zapnuté doručovanie s nulovou cenou by znamenalo, že poštovné platíme
 * my — to je rozhodnutie, ktoré sa nemá stať nedopatrením.
 */
export function doruceniePostouMozne(zapnute: boolean, postovne: number | null): boolean {
  return zapnute && cenaDorucenia("posta", postovne) > 0;
}

/** PSČ na Slovensku: päť číslic, so medzerou alebo bez nej. */
const PSC_SK = /^\d{3}\s?\d{2}$/;

/** Uloží sa v tvare „821 09" — tak ho pošta aj ľudia čítajú. */
export function normalizujPsc(psc: string | null | undefined): string {
  const cisla = (psc ?? "").replace(/\D/g, "");
  return cisla.length === 5 ? `${cisla.slice(0, 3)} ${cisla.slice(3)}` : (psc ?? "").trim();
}

/**
 * Kontrola toho, čo zákazník vyplnil v pokladni.
 *
 * Pri e-maile netreba nič — adresa sa ani nezbiera. Pri pošte kontrolujeme
 * najprv pravidlá pošty (dĺžky, povinné polia) a navyše dve veci, ktoré
 * `eph.ts` nerieši, lebo pošta ich odmietne až pri podaji:
 *  - PSČ naozaj vo formáte slovenského PSČ,
 *  - len Slovensko — cenník je pevný a do zahraničia neplatí.
 */
export function skontrolujDorucenie(
  sposob: SposobDorucenia,
  adresa: AdresaDorucenia | null | undefined,
): Chyba[] {
  if (sposob !== "posta") return [];
  const a = adresa ?? {};
  const krajina = (a.krajina || "SK").trim().toUpperCase();

  const ch = skontrolujAdresu({
    name: a.meno ?? null,
    street: a.ulica ?? "",
    city: a.mesto ?? "",
    zip: a.psc ?? null,
    country: krajina,
  });

  if (krajina !== "SK") {
    ch.push({
      pole: "krajina",
      sprava: "Poštou doručujeme len na Slovensko. Do zahraničia pošleme vstupenky e-mailom.",
    });
  }
  // Prázdne PSČ už ohlásila kontrola vyššie — tu ide o tvar.
  if ((a.psc ?? "").trim() && !PSC_SK.test((a.psc ?? "").trim())) {
    ch.push({ pole: "psc", sprava: "PSČ zadaj ako päť číslic, napríklad 821 09." });
  }
  return ch;
}

/** Prvá chyba ako veta pre zákazníka, alebo `null`, keď je všetko v poriadku. */
export function prvaChyba(chyby: Chyba[]): string | null {
  return chyby.length ? chyby[0].sprava : null;
}
