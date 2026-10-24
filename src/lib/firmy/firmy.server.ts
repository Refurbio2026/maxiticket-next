// Register firiem — volania do vonkajších zdrojov.
//
// PRAVIDLO ČÍSLO JEDNA: nič z toho nesmie zablokovať nákup. Register bol pri
// písaní tohto kódu nedostupný (spojenie padalo na timeout) a zákazník musí
// vedieť údaje dopísať ručne aj vtedy. Preto má každé volanie krátky časový
// limit a zlyhanie sa vracia ako „nenašlo sa", nie ako chyba.
//
// ZDROJE:
//   * RPO (Štatistický úrad SR) — bezplatný, oficiálny, bez kľúča. Názov,
//     IČO, sídlo, zápis v obchodnom registri. **Nedá DIČ ani IČ DPH.**
//   * VIES (EÚ) — bezplatné overenie IČ DPH, keď ho zákazník zadá.
//   * FinStat — platený; vie aj DIČ a IČ DPH. Pozri `finstatStav()`.
import { hodnota } from "../pristupy.server";
import { druhDotazu, normalizujIcDph, normalizujIco, type Firma } from "./firmy";
import { precitajOdpoved } from "./rpo-parse";

const RPO = "https://api.statistics.sk/rpo/v1/search";
const VIES = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms";

/** Krátko. Zákazník stojí v checkoute a čaká. */
const LIMIT_MS = 4000;

async function ziskaj(url: string): Promise<unknown | null> {
  const prerusenie = new AbortController();
  const casovac = setTimeout(() => prerusenie.abort(), LIMIT_MS);
  try {
    const r = await fetch(url, {
      signal: prerusenie.signal,
      headers: { Accept: "application/json" },
    });
    if (!r.ok) {
      console.error("Register firiem odpovedal", r.status, url.split("?")[0]);
      return null;
    }
    return (await r.json()) as unknown;
  } catch (e) {
    // Nedostupný register nie je chyba nákupu — zapíšeme a ideme ďalej.
    console.error(
      "Register firiem nedostupný",
      url.split("?")[0],
      e instanceof Error ? e.message : e,
    );
    return null;
  } finally {
    clearTimeout(casovac);
  }
}

/** Hľadanie v RPO podľa IČO alebo názvu. Pri zlyhaní prázdny zoznam. */
export async function hladajVRpo(dotaz: string, kolko = 8): Promise<Firma[]> {
  const druh = druhDotazu(dotaz);
  if (druh === "prazdne") return [];

  const parametre = new URLSearchParams();
  if (druh === "ico") {
    parametre.set("identifier", normalizujIco(dotaz));
  } else if (druh === "nazov") {
    parametre.set("fullName", dotaz.trim());
    parametre.set("limit", String(Math.min(kolko, 20)));
  } else {
    // IČ DPH register nepozná; skúsime z neho aspoň číselnú časť ako IČO.
    const v = normalizujIcDph(dotaz);
    if (!v) return [];
    parametre.set("identifier", v.cislo.slice(0, 8));
  }

  const data = await ziskaj(`${RPO}?${parametre.toString()}`);
  return precitajOdpoved(data).slice(0, kolko);
}

export type OverenieIcDph = {
  platne: boolean;
  nazov: string | null;
  adresa: string | null;
  /** `null` znamená, že sa to nepodarilo overiť — nie že je neplatné. */
  dostupne: boolean;
};

/**
 * Overí IČ DPH vo VIES.
 *
 * Rozlišuje „neplatné" od „nepodarilo sa overiť". Zákazníkovi sa nesmie
 * tvrdiť, že má zlé IČ DPH, len preto, že služba EÚ práve nejde.
 */
export async function overIcDph(icDph: string): Promise<OverenieIcDph> {
  const v = normalizujIcDph(icDph);
  if (!v) return { platne: false, nazov: null, adresa: null, dostupne: true };

  const data = (await ziskaj(`${VIES}/${v.stat}/vat/${encodeURIComponent(v.cislo)}`)) as Record<
    string,
    unknown
  > | null;
  if (!data) return { platne: false, nazov: null, adresa: null, dostupne: false };

  const cisty = (x: unknown) => {
    const t = typeof x === "string" ? x.trim() : "";
    // VIES vracia „---", keď hodnotu nevie.
    return t && t !== "---" ? t : null;
  };
  return {
    platne: data.isValid === true,
    nazov: cisty(data.name),
    adresa: cisty(data.address),
    dostupne: true,
  };
}

export type FinstatStav = { pripravene: boolean; detail: string };

/**
 * Stav napojenia na FinStat.
 *
 * FinStat je **platený** (balíky PREMIUM a vyššie) a jeho technická
 * dokumentácia je prístupná len zákazníkom po prihlásení — vrátane presného
 * spôsobu podpisu požiadavky. Ten sa nedá uhádnuť a hádať sa nebude: zle
 * podpísané volanie by tichodko vracalo chybu a vyzeralo by to ako porucha
 * registra.
 *
 * Keď bude kľúč aj dokumentácia, doplní sa provider k RPO a bude navyše
 * dávať DIČ a IČ DPH.
 */
export function finstatStav(): FinstatStav {
  const kluc = hodnota("finstat", "FINSTAT_API_KEY");
  if (!kluc) {
    return {
      pripravene: false,
      detail:
        "FinStat nie je napojený. Je platený a jeho API dokumentácia je len pre zákazníkov — " +
        "bez nej sa podpis požiadavky nedá doplniť. Dovtedy sa hľadá v bezplatnom registri RPO, " +
        "ktorý nedáva DIČ ani IČ DPH.",
    };
  }
  return {
    pripravene: false,
    detail:
      "Kľúč k FinStatu je uložený, ale chýba jeho technická dokumentácia (podpis požiadavky). " +
      "Pošli ju a napojenie doplním.",
  };
}
