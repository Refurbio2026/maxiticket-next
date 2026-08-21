// Peňažná matematika vyúčtovania organizátora.
//
// Vyčlenené z `settlements.functions.ts`, aby sa dala otestovať bez databázy —
// chyba tu znamená, že organizátor dostane zaplatené zle.
/** Zaokrúhlenie na centy. `Number.EPSILON` drží prípady ako 1.005. */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type SettlementTotals = {
  gross_amount: number;
  refunded_amount: number;
  commission_amount: number;
  costs_amount: number;
  net_amount: number;
};

/**
 * Súčty jedného vyúčtovania.
 *
 * Provízia sa počíta zo skutočnej tržby, teda až po odpočítaní vrátených
 * peňazí. Náklady (napr. tlač vstupeniek) idú až po provízii — platforma si
 * neberie podiel zo zisku, ale z predaja.
 */
export function computeSettlementTotals(opts: {
  gross: number;
  refunded: number;
  costsAmount: number;
  /** Sadzba provízie v percentách. */
  rate: number;
}): SettlementTotals {
  const { gross, refunded, costsAmount, rate } = opts;
  const base = round2(gross - refunded);
  const commission = round2((base * rate) / 100);
  return {
    gross_amount: round2(gross),
    refunded_amount: round2(refunded),
    commission_amount: commission,
    costs_amount: round2(costsAmount),
    net_amount: round2(base - commission - costsAmount),
  };
}
