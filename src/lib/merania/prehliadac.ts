// Súhlas v prehliadači — čítanie, zápis a oznámenie zmeny.
//
// Oddelené od `suhlas.ts`, aby čistá logika zostala testovateľná bez
// prehliadača. Tu je všetko, čo sa dotýka `window`.
import { KLUC_SUHLASU, precitajSuhlas, zapisSuhlas, type Suhlas } from "./suhlas";

/** Udalosť, na ktorú čaká vkladanie meracích kódov. */
export const UDALOST_ZMENY = "eticketo:suhlas-zmeneny";
/** Udalosť, ktorou sa lišta dá otvoriť znova (odkaz v pätke). */
export const UDALOST_OTVOR = "eticketo:otvor-suhlas";

/**
 * Prečíta súhlas. `null` = nerozhodnuté.
 *
 * Prehliadač v anonymnom režime alebo so zakázanými dátami stránky môže pri
 * čítaní vyhodiť výnimku — vtedy je to tiež nerozhodnuté a nespúšťa sa nič.
 */
export function nacitajSuhlas(): Suhlas | null {
  if (typeof window === "undefined") return null;
  try {
    return precitajSuhlas(window.localStorage.getItem(KLUC_SUHLASU));
  } catch {
    return null;
  }
}

/**
 * Uloží rozhodnutie a oznámi ho zvyšku stránky.
 *
 * Keď sa uložiť nedá (zakázané dáta stránky), rozhodnutie aj tak oznámime —
 * platí pre toto načítanie stránky a návštevník nemusí klikať druhý raz.
 */
export function ulozSuhlas(volba: { analytika: boolean; marketing: boolean }): Suhlas | null {
  if (typeof window === "undefined") return null;
  const raw = zapisSuhlas(volba);
  try {
    window.localStorage.setItem(KLUC_SUHLASU, raw);
  } catch {
    // Pokračujeme — viď komentár vyššie.
  }
  const s = precitajSuhlas(raw);
  window.dispatchEvent(new CustomEvent(UDALOST_ZMENY, { detail: s }));
  return s;
}

/** Vloží skript do hlavičky. Vracia `false`, keď tam už taký je. */
export function vlozSkript(
  kluc: string,
  opts: { kod?: string; src?: string; async?: boolean },
): boolean {
  if (typeof document === "undefined") return false;
  const id = `eticketo-merania-${kluc}`;
  if (document.getElementById(id)) return false;

  const el = document.createElement("script");
  el.id = id;
  if (opts.src) {
    el.src = opts.src;
    el.async = opts.async ?? true;
  }
  if (opts.kod) el.textContent = opts.kod;
  document.head.appendChild(el);
  return true;
}
