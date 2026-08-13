/**
 * Slovenské skloňovanie počítaného podstatného mena.
 *
 * 1 podujatie · 2–4 podujatia · 5 a viac podujatí. Rovnaké pravidlo platí aj
 * pre 0 (nula podujatí), preto sa jednotné číslo viaže len na presnú jednotku.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

/** „3 podujatia" — najčastejší prípad, nech sa tvary neopakujú po celej aplikácii. */
export function pocetPodujati(n: number): string {
  return `${n} ${plural(n, "podujatie", "podujatia", "podujatí")}`;
}
