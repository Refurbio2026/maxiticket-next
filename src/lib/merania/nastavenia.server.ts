// Meracie kódy platformy — prístupy z administrácie.
//
// Ukladajú sa tým istým spôsobom ako prístupy k bránam
// (`integration_credentials`), hoci tajné nie sú: identifikátor GA4 či Meta
// Pixelu vidí každý, kto si otvorí zdroj stránky. Dôvod je jednotnosť —
// jedno miesto, jeden formulár, jedna história zmien.
//
// POZOR, ČO TU NIE JE: pole na vlastný HTML/JS úryvok do hlavičky. Je to
// v iných systémoch obvyklé, ale znamenalo by to, že kto sa dostane
// k jednému adminskému účtu, má ľubovoľný JavaScript na celom webe vrátane
// pokladne. Preto sú tu len presne tie polia, ktorých tvar sa dá overiť
// (`kody.ts`), a čokoľvek iné sa zahodí.
//
// Organizátor má vlastné kódy v `pixel_settings` — tieto sú platformové
// a bežia na celom webe.
import { hodnota, polozka, pripravPristupy } from "@/lib/pristupy.server";
import type { PolozkaKonfiguracie } from "@/lib/payment-gateways/types";
import { maCoMerat, overMerania, type Merania } from "./kody";

export const PROVIDER = "merania";

/** Nastavenia tak, ako ich zadal človek — bez kontroly tvaru. */
export function meraniaSurove(): Merania {
  return {
    gtm: hodnota(PROVIDER, "MERANIA_GTM") || null,
    ga4: hodnota(PROVIDER, "MERANIA_GA4") || null,
    googleAds: hodnota(PROVIDER, "MERANIA_GOOGLE_ADS") || null,
    konverznaNavestie: hodnota(PROVIDER, "MERANIA_ADS_NAVESTIE") || null,
    metaPixel: hodnota(PROVIDER, "MERANIA_META_PIXEL") || null,
  };
}

/** Len to, čo prešlo kontrolou tvaru. Toto ide na web. */
export function meraniaPlatne(): Merania {
  return overMerania(meraniaSurove());
}

/** To isté, ale so načítaním prístupov — pre server functions. */
export async function meraniaPreWeb(): Promise<Merania> {
  await pripravPristupy();
  return meraniaPlatne();
}

/**
 * Stav do administrácie: čo je zapnuté a čo je vyplnené zle.
 *
 * Zle vyplnené ID sa nehlási ako „prázdne", ale ako chyba — inak by človek
 * videl prázdnu kartu, nechápal prečo meranie nebeží, a hľadal by to
 * v kóde namiesto v preklepe.
 */
export function meraniaStav(): { pripravene: boolean; detail: string } {
  const surove = meraniaSurove();
  const platne = meraniaPlatne();

  const zle: string[] = [];
  const popisy: Record<keyof Merania, string> = {
    gtm: "GTM ID",
    ga4: "GA4 ID",
    googleAds: "Google Ads ID",
    konverznaNavestie: "konverzné návestie",
    metaPixel: "Meta Pixel ID",
  };
  for (const k of Object.keys(popisy) as Array<keyof Merania>) {
    if (surove[k] && !platne[k]) zle.push(popisy[k]);
  }
  if (zle.length) {
    return {
      pripravene: false,
      detail: `Nesprávny tvar: ${zle.join(", ")}. Takto zadané sa na web nevloží.`,
    };
  }

  if (!maCoMerat(platne)) {
    return { pripravene: false, detail: "Nie je vyplnený žiadny merací kód — nemeria sa nič." };
  }

  const bezi = [
    platne.gtm && "Tag Manager",
    platne.ga4 && "GA4",
    platne.googleAds && "Google Ads",
    platne.metaPixel && "Meta Pixel",
  ].filter(Boolean);

  // Ads bez návestia je polovičná konfigurácia: meranie beží, ale nákup
  // sa do Ads nezapíše. Lepšie to povedať teraz než hľadať, prečo
  // v kampani nie sú konverzie.
  if (platne.googleAds && !platne.konverznaNavestie) {
    return {
      pripravene: true,
      detail: `Beží: ${bezi.join(", ")}. Google Ads nemá konverzné návestie, takže nákupy sa doň nezapíšu.`,
    };
  }
  return { pripravene: true, detail: `Beží: ${bezi.join(", ")}.` };
}

export function meraniaKonfiguracia(): PolozkaKonfiguracie[] {
  const pol = (premenna: string, nazov: string, popis: string) =>
    polozka(PROVIDER, { premenna, nazov, popis, povinna: false });

  return [
    pol(
      "MERANIA_GTM",
      "Google Tag Manager — ID kontejnera",
      "Tvar GTM-XXXXXXX. Keď ho vyplníš, ostatné kódy môžeš spravovať v GTM namiesto tu.",
    ),
    pol("MERANIA_GA4", "Google Analytics 4 — ID merania", "Tvar G-XXXXXXXXXX."),
    pol("MERANIA_GOOGLE_ADS", "Google Ads — ID konverzie", "Tvar AW-123456789."),
    pol(
      "MERANIA_ADS_NAVESTIE",
      "Google Ads — konverzné návestie",
      "Druhá časť konverzie (za lomkou). Bez nej sa nákup do Ads nezapíše.",
    ),
    pol("MERANIA_META_PIXEL", "Meta Pixel — ID", "Len číslice, napríklad 123456789012345."),
  ];
}
