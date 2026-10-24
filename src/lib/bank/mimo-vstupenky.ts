// Pohyby, ktoré s predajom vstupeniek nemajú čo do činenia.
//
// PREČO: zdroj ťahá pohyby z firemného účtu, cez ktorý tečie všetko — výplaty,
// faktúry dodávateľom, presuny medzi vlastnými účtami, bankové poplatky.
// Párovanie ich nespáruje (a ani nemá), takže by všetky skončili v zozname
// „na vyriešenie". O mesiac by v ňom bolo zopár stoviek položiek a tá jedna
// skutočne problémová by v nich zapadla.
//
// ČO TO NIE JE: mazanie. Pohyb zostáva uložený aj dohľadateľný, len dostane
// stav `ignored` s dôvodom, takže nestrká hlavu do zoznamu na riešenie.
//
// PRAVIDLO: keď je čo i len tieň pochybnosti, pohyb sa NEOZNAČÍ. Nespárovaná
// platba navyše je otrava; prehliadnutá platba za vstupenku je sťažnosť.

export type PohybNaPosudenie = {
  amount: number;
  vs_normalized: string | null;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  message: string | null;
};

export type Kontext = {
  /** Naše vlastné účty — presun medzi nimi nie je platba za vstupenku. */
  vlastneIbany: string[];
  /** Názvy, pod ktorými vystupujeme my sami. */
  vlastneNazvy: string[];
  /** Variabilné symboly objednávok zo starého systému. */
  stareVs: Set<string>;
};

export type Zaradenie = { mimo: true; dovod: string; popis: string } | null;

const BANKY = [
  "tatra banka",
  "vseobecna uverova banka",
  "všeobecná úverová banka",
  "slovenska sporitelna",
  "slovenská sporiteľňa",
  "ceskoslovenska obchodna banka",
  "fio banka",
  "unicredit",
  "365.bank",
];

/** Poplatky a dane, ktoré banka strháva sama. */
const POPLATKY = [
  "transakcna dan",
  "transakčná daň",
  "poplatok",
  "poplatky",
  "uroky",
  "úroky",
  "danovy odvod",
];

const bez = (t: string | null | undefined) =>
  (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Patrí pohyb mimo predaja vstupeniek?
 *
 * Volá sa až POTOM, ako párovanie nenašlo objednávku — spárovaný pohyb sem
 * nikdy nepríde.
 */
export function zaradMimo(tx: PohybNaPosudenie, k: Kontext): Zaradenie {
  const protistrana = bez(tx.counterparty_name);
  const sprava = bez(tx.message);
  const iban = (tx.counterparty_iban ?? "").replace(/\s/g, "").toUpperCase();

  // 1) Platba zo starého systému. Poznáme ju podľa variabilného symbolu,
  //    takže je to istota, nie odhad.
  if (tx.vs_normalized && k.stareVs.has(tx.vs_normalized.replace(/^0+/, ""))) {
    return {
      mimo: true,
      dovod: "stary_system",
      popis: "Platba za vstupenku zo starého systému (MaxiTicket).",
    };
  }

  // 2) Presun medzi našimi vlastnými účtami.
  const nasIban = k.vlastneIbany.some((x) => x && iban === x.replace(/\s/g, "").toUpperCase());
  const nasNazov = k.vlastneNazvy.some((n) => bez(n) && protistrana === bez(n));
  if (nasIban || (nasNazov && !tx.vs_normalized)) {
    return { mimo: true, dovod: "vlastny_prevod", popis: "Presun medzi vlastnými účtami." };
  }

  // 3) Poplatky, dane a úroky banky.
  const odBanky = BANKY.some((b) => protistrana.includes(bez(b)));
  const jePoplatok = POPLATKY.some((p) => sprava.includes(bez(p)) || protistrana.includes(bez(p)));
  if ((odBanky || jePoplatok) && !tx.vs_normalized) {
    return { mimo: true, dovod: "bankovy_poplatok", popis: "Poplatok, daň alebo úrok banky." };
  }

  // 4) Odchádzajúca platba bez variabilného symbolu.
  //    S variabilným symbolom ju nechávame tak: mohlo by ísť o vrátenie
  //    vstupného, ktoré chceme vidieť.
  if (tx.amount < 0 && !tx.vs_normalized) {
    return {
      mimo: true,
      dovod: "odchadzajuca",
      popis: "Odchádzajúca platba bez variabilného symbolu.",
    };
  }

  return null;
}
