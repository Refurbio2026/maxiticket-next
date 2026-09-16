// Rozhranie zdrojov bankových pohybov.
//
// Zdroj je buď nahratý súbor (mesačný výpis), alebo REST API banky. Oboje sa
// nakoniec premení na ten istý tvar `NormalizovanaTransakcia`, takže párovanie
// nevie a nemusí vedieť, odkiaľ pohyb prišiel.
//
// E-mailové avízo (`imap`) tu zámerne chýba. Hlavičku `From` sa dá sfalšovať
// a starý systém na jej základe vydával vstupenky — stačilo poslať e-mail
// s cudzím variabilným symbolom.
import type { ChybaParsovania, NormalizovanaTransakcia } from "../normalize";

/** Súhrn mesačného výpisu: zostatky a kontrolné súčty. */
export type SuhrnVypisu = {
  period_from: string;
  period_to: string;
  opening_balance: number | null;
  closing_balance: number | null;
  credit_sum: number;
  debit_sum: number;
  charges_sum: number;
  credit_count: number;
  debit_count: number;
  currency: string;
};

export type VysledokParsovania = {
  suhrn: SuhrnVypisu | null;
  transakcie: NormalizovanaTransakcia[];
  /** Riadky, ktoré sa nepodarilo prečítať. Nezastavia import zvyšku. */
  chyby: ChybaParsovania[];
};

/** Parser súborového výpisu. Čistá funkcia — žiadne IO, dá sa testovať. */
export type ParserVypisu = {
  id: string;
  nazov: string;
  /** Prípony, ktoré parser prijíma. Kontroluje sa aj obsah, nielen názov. */
  pripony: string[];
  parsuj(obsah: string): VysledokParsovania;
};

/** Zdroj, ktorý si pohyby vypýta cez API. */
export type ApiZdroj = {
  id: string;
  /** Okno sa prekrýva, aby transakcia nevypadla medzi dvoma behmi. */
  stiahni(opts: {
    tajomstvo: string;
    config: Record<string, unknown>;
    od: Date;
    do: Date;
  }): Promise<VysledokParsovania>;
};

/** Súčty z transakcií — keď výpis vlastný súhrn neobsahuje. */
export function dopocitajSuhrn(
  transakcie: NormalizovanaTransakcia[],
  zaklad?: Partial<SuhrnVypisu>,
): SuhrnVypisu | null {
  if (transakcie.length === 0 && !zaklad?.period_from) return null;
  const datumy = transakcie.map((t) => t.booked_at.slice(0, 10)).sort();
  const kredity = transakcie.filter((t) => t.amount > 0);
  const debety = transakcie.filter((t) => t.amount < 0);
  const suma = (xs: NormalizovanaTransakcia[]) =>
    Math.round(xs.reduce((s, t) => s + t.amount, 0) * 100) / 100;

  return {
    period_from: zaklad?.period_from ?? datumy[0] ?? "",
    period_to: zaklad?.period_to ?? datumy[datumy.length - 1] ?? "",
    opening_balance: zaklad?.opening_balance ?? null,
    closing_balance: zaklad?.closing_balance ?? null,
    credit_sum: zaklad?.credit_sum ?? suma(kredity),
    debit_sum: zaklad?.debit_sum ?? Math.abs(suma(debety)),
    charges_sum: zaklad?.charges_sum ?? 0,
    credit_count: zaklad?.credit_count ?? kredity.length,
    debit_count: zaklad?.debit_count ?? debety.length,
    currency: zaklad?.currency ?? transakcie[0]?.currency ?? "EUR",
  };
}
