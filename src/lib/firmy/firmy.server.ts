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
import { hodnota, polozka } from "../pristupy.server";
import type { PolozkaKonfiguracie } from "../payment-gateways/types";
import { druhDotazu, normalizujIcDph, normalizujIco, type Firma } from "./firmy";
import { precitajOdpoved } from "./rpo-parse";
import {
  adresa,
  popisChyby,
  precitajDetail,
  precitajNavrhy,
  type Navrh,
  type Pristupy,
} from "./finstat";

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

/** Stav napojenia na FinStat — pre admina. */
export function finstatStav(): FinstatStav {
  const apiKey = hodnota("finstat", "FINSTAT_API_KEY");
  const privateKey = hodnota("finstat", "FINSTAT_PRIVATE_KEY");
  if (!apiKey && !privateKey) {
    return {
      pripravene: false,
      detail:
        "FinStat nie je napojený — hľadá sa v bezplatnom registri RPO, ktorý nedáva DIČ ani IČ DPH.",
    };
  }
  if (!apiKey || !privateKey) {
    return {
      pripravene: false,
      detail: `Chýba ${!apiKey ? "API kľúč" : "privátny kľúč"} FinStatu — bez oboch sa hash požiadavky nedá spočítať.`,
    };
  }
  return { pripravene: true, detail: "FinStat je napojený; dopĺňa DIČ a IČ DPH." };
}

// --- FinStat -----------------------------------------------------------------
//
// Toto je ten zdroj, ktorý dá **DIČ a IČ DPH** — bezplatný register ich nemá.
// Limity z dokumentácie: 4 000 volaní denne, 75 000 mesačne, odporúčané
// najviac 2 vlákna a výslovný zákaz volať to z prehliadača. Voláme to zo
// servera, takže sa kľúč k zákazníkovi nedostane.

function finstatPristupy(): Pristupy | null {
  const apiKey = hodnota("finstat", "FINSTAT_API_KEY");
  const privateKey = hodnota("finstat", "FINSTAT_PRIVATE_KEY");
  if (!apiKey || !privateKey) return null;
  return {
    apiKey,
    privateKey,
    // Podľa čoho FinStat v štatistikách rozlíši, odkiaľ volanie prišlo.
    stationId: hodnota("finstat", "FINSTAT_STATION_ID") || "eticketo",
    stationName: hodnota("finstat", "FINSTAT_STATION_NAME") || "eticketo.eu",
  };
}

export function jeFinstatNastaveny(): boolean {
  return finstatPristupy() !== null;
}

/** Volanie FinStatu. Pri chybe vracia `null` a dôvod zapíše do logu. */
async function volajFinstat(
  metoda: "detail" | "autocomplete",
  parameter: string,
): Promise<unknown | null> {
  const p = finstatPristupy();
  if (!p) return null;

  const prerusenie = new AbortController();
  const casovac = setTimeout(() => prerusenie.abort(), LIMIT_MS);
  try {
    const r = await fetch(adresa(metoda, parameter, p), {
      signal: prerusenie.signal,
      headers: { Accept: "application/json" },
    });
    if (!r.ok) {
      // 402 je vyčerpaný limit, 429 priveľa volaní — oboje má spadnúť na
      // bezplatný register, nie zhodiť vyhľadávanie.
      console.error(popisChyby(r.status), `(${metoda})`);
      return null;
    }
    return (await r.json()) as unknown;
  } catch (e) {
    console.error("FinStat nedostupný", metoda, e instanceof Error ? e.message : e);
    return null;
  } finally {
    clearTimeout(casovac);
  }
}

/** Detail firmy podľa IČO — vráti aj DIČ a IČ DPH. */
export async function hladajVoFinstate(ico: string): Promise<Firma | null> {
  const data = await volajFinstat("detail", normalizujIco(ico));
  return data ? precitajDetail(data) : null;
}

/** Návrhy firiem podľa názvu. FinStat vyžaduje najmenej tri znaky. */
export async function navrhyZFinstatu(dotaz: string): Promise<Navrh[]> {
  const t = dotaz.trim();
  if (t.length < 3) return [];
  const data = await volajFinstat("autocomplete", t);
  return data ? precitajNavrhy(data) : [];
}

/** Čo FinStat potrebuje — pre kartu v admine. */
export function finstatKonfiguracia(): PolozkaKonfiguracie[] {
  return [
    polozka("finstat", {
      premenna: "FINSTAT_API_KEY",
      nazov: "API kľúč",
      popis: "Z FinStatu. Bez privátneho kľúča sa hash požiadavky nedá spočítať.",
      povinna: true,
      tajna: true,
    }),
    polozka("finstat", {
      premenna: "FINSTAT_PRIVATE_KEY",
      nazov: "Privátny kľúč",
      popis: "Druhý kľúč z FinStatu. Do adresy volania sa nikdy neposiela, len do hashu.",
      povinna: true,
      tajna: true,
    }),
    polozka("finstat", {
      premenna: "FINSTAT_STATION_ID",
      nazov: "Označenie stanice",
      popis: "Nepovinné. Bez vyplnenia sa posiela „eticketo“.",
      povinna: false,
    }),
  ];
}
