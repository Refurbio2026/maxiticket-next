// Sadzby DPH — konštanty použiteľné na serveri aj v prehliadači.
//
// Od 1. 1. 2025 je na Slovensku základná sadzba 23 %. Na vstupné neplatí jedna
// sadzba: príloha 7a zákona o DPH dáva 5 % na vstup na divadelné predstavenia,
// do múzeí a na športové podujatia, ale **hudobné koncerty zostávajú
// v základnej sadzbe**. Preto sa sadzba nastavuje na podujatí a kód ju
// neodvodzuje.

/** Základná sadzba. Použije sa, keď nie je nastavené nič iné. */
export const ZAKLADNA_SADZBA = 23;

/** Sadzby, ktoré zákon pozná — na kontrolu vstupu z formulára. */
export const POVOLENE_SADZBY = [0, 5, 19, 23] as const;

export function jePovolenaSadzba(sadzba: number): boolean {
  return (POVOLENE_SADZBY as readonly number[]).includes(sadzba);
}

/** Krátke vysvetlenie pre obsluhu; zaradenie podujatia je na účtovníčke. */
export const POPIS_SADZIEB: Record<number, string> = {
  0: "Oslobodené od dane",
  5: "Divadlo, opera, balet, muzikál, bábkové divadlo, múzeá, výstavy a športové podujatia",
  19: "Znížená sadzba (elektrina, vybrané potraviny, nealko v reštaurácii)",
  23: "Základná sadzba — sem patria aj hudobné koncerty",
};
