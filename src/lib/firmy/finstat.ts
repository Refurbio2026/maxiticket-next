// FinStat API — čisté časti.
//
// Špecifikácia: finstat.github.io/api-documentation (verejný repozitár
// `finstat/api-documentation`). Nič tu nie je uhádnuté; výpočet hashu je
// overený proti **ich vlastným príkladom** v testoch.
//
// ČO FINSTAT PRIDÁVA oproti bezplatnému RPO: **DIČ a IČ DPH**. To je celý
// dôvod, prečo sa oplatí — register právnických osôb daňové čísla nedáva.
//
// LIMITY (z dokumentácie): 4 000 volaní denne, 75 000 mesačne, odporúčané
// najviac 2 vlákna, a výslovný zákaz volať to z prehliadača. Voláme to zo
// servera, takže kľúč sa k zákazníkovi nedostane.
import crypto from "node:crypto";
import { normalizujIco, type Firma } from "./firmy";

export const FINSTAT = "https://www.finstat.sk/api";

/**
 * Overovací hash požiadavky.
 *
 * Základ je presne `SomeSalt+{apiKey}+{privateKey}++{parameter}+ended` —
 * **dve plus** za privátnym kľúčom, tak to má aj ich PHP vzor
 * (`sprintf("SomeSalt+%s+%s++%s+ended", …)`). SHA-256, hex malými písmenami.
 */
export function hash(apiKey: string, privateKey: string, parameter: string): string {
  const zaklad = `SomeSalt+${apiKey}+${privateKey}++${parameter}+ended`;
  return crypto.createHash("sha256").update(zaklad, "utf8").digest("hex");
}

export type Pristupy = {
  apiKey: string;
  privateKey: string;
  /** Nepovinné označenie stanice; FinStat podľa neho vie rozlíšiť volajúceho. */
  stationId?: string;
  stationName?: string;
};

/** Adresa volania. `.json` na konci je ich prepínač na JSON namiesto XML. */
export function adresa(metoda: "detail" | "autocomplete", parameter: string, p: Pristupy): string {
  const u = new URL(`${FINSTAT}/${metoda}.json`);
  u.searchParams.set(metoda === "detail" ? "ico" : "query", parameter);
  u.searchParams.set("apiKey", p.apiKey);
  u.searchParams.set("hash", hash(p.apiKey, p.privateKey, parameter));
  if (p.stationId) u.searchParams.set("StationId", p.stationId);
  if (p.stationName) u.searchParams.set("StationName", p.stationName);
  return u.toString();
}

const text = (x: unknown): string | null => {
  const t = typeof x === "string" ? x.trim() : "";
  return t || null;
};

/** Odpoveď `detail` → naša firma. */
export function precitajDetail(data: unknown): Firma | null {
  const d = (data ?? {}) as Record<string, unknown>;
  const ico = normalizujIco(d.Ico);
  const nazov = text(d.Name);
  if (!ico && !nazov) return null;

  const ulica = [text(d.Street), text(d.StreetNumber)].filter(Boolean).join(" ") || null;

  return {
    nazov: nazov ?? "",
    ico,
    dic: text(d.Dic),
    ic_dph: text(d.IcDPH),
    ulica,
    mesto: text(d.City),
    psc: text(d.ZipCode),
    // Dokumentácia: prázdna krajina znamená Slovensko.
    stat: text(d.Country) ? (text(d.Country) as string) : "SK",
    zdroj: "finstat",
    registracia: null,
  };
}

export type Navrh = { ico: string; nazov: string; mesto: string | null; zrusena: boolean };

/**
 * Odpoveď `autocomplete` → návrhy.
 *
 * Zrušené firmy sa nezahadzujú, len sa označia — zákazník môže kupovať aj
 * na firmu, ktorá sa práve ruší, a nemá to zostať bez vysvetlenia.
 */
export function precitajNavrhy(data: unknown): Navrh[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const zoznam = Array.isArray(d.Results) ? d.Results : [];
  return zoznam
    .map((x) => {
      const r = (x ?? {}) as Record<string, unknown>;
      const ico = normalizujIco(r.Ico);
      const nazov = text(r.Name);
      if (!ico && !nazov) return null;
      return {
        ico,
        nazov: nazov ?? "",
        mesto: text(r.City),
        zrusena: r.Cancelled === true || r.Cancelled === "true",
      };
    })
    .filter((x): x is Navrh => x !== null);
}

/** Čo znamenajú HTTP kódy FinStatu. Zákazníkovi sa z toho nič neukazuje. */
export function popisChyby(status: number): string {
  switch (status) {
    case 400:
      return "FinStat: chýba povinný parameter.";
    case 402:
      return "FinStat: vyčerpaný denný alebo mesačný limit volaní.";
    case 403:
      return "FinStat: neplatný kľúč alebo hash, prípadne vypršaná licencia.";
    case 404:
      return "FinStat: dotaz je príliš krátky (najmenej 3 znaky) alebo sa nič nenašlo.";
    case 429:
      return "FinStat: priveľa volaní za sekundu.";
    default:
      return `FinStat odpovedal ${status}.`;
  }
}
