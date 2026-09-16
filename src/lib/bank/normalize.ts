// Normalizácia bankovej transakcie — spoločná pre všetky zdroje.
//
// Každá banka a brána posiela sumy a symboly inak: „1 234,56", „1.234,56",
// „123456" v centoch, VS raz s nulami zľava, raz bez. Párovací engine musí
// dostať jeden tvar, inak by každé pravidlo riešilo formáty znova.
//
// Súbor je zámerne čistý — žiadny import zo servera, žiadna databáza. Vďaka
// tomu sa dá otestovať na vzorkách z reálnych výpisov bez pripojenia.

/** Dĺžka variabilného a špecifického symbolu po normalizácii. */
export const DLZKA_SYMBOLU = 10;
/** Dĺžka konštantného symbolu. */
export const DLZKA_KS = 4;

/**
 * Prevedie sumu z výpisu na číslo.
 *
 * Zvládne oddeľovač tisícov medzerou, bodkou aj pevnou medzerou a desatinnú
 * čiarku. Vracia `null`, keď v texte nie je použiteľné číslo — volajúci to
 * musí premeniť na `parse_error`, nie na nulu. Suma 0 by sa totiž tvárila ako
 * platná transakcia a spárovala by objednávku zadarmo.
 */
export function normalizujSumu(vstup: string | number | null | undefined): number | null {
  if (typeof vstup === "number") return Number.isFinite(vstup) ? zaokruhli(vstup) : null;
  if (vstup == null) return null;

  let text = String(vstup).trim();
  if (!text) return null;

  // Znamienko si zapamätáme zvlášť — niektoré výpisy ho píšu za číslo („27,70-").
  const zaporne = /^-/.test(text) || /-\s*$/.test(text);
  text = text.replace(/[-+]/g, "");

  // Mena a nezmyselné znaky preč; ostanú číslice a oddeľovače.
  text = text.replace(/[^\d.,\s\u00a0]/g, "");
  // Medzery (aj pevné) sú vždy oddeľovač tisícov.
  text = text.replace(/[\s\u00a0]/g, "");
  if (!text) return null;

  const poslednaCiarka = text.lastIndexOf(",");
  const poslednaBodka = text.lastIndexOf(".");

  if (poslednaCiarka >= 0 && poslednaBodka >= 0) {
    // Oba oddeľovače naraz: ten vzadu je desatinný, ten vpredu tisícový.
    if (poslednaCiarka > poslednaBodka) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (poslednaCiarka >= 0) {
    text = text.replace(",", ".");
  } else if (poslednaBodka >= 0) {
    // Jediná bodka: desatinná len vtedy, keď za ňou nie sú presne tri
    // číslice. „1.234" je tisíc dvestotridsaťštyri, „27.70" je dvadsaťsedem
    // celých sedem. Pri „1.234" sa nedá rozhodnúť inak než touto konvenciou.
    const za = text.length - poslednaBodka - 1;
    if (za === 3) text = text.replace(".", "");
  }

  const cislo = Number(text);
  if (!Number.isFinite(cislo)) return null;
  return zaokruhli(zaporne ? -cislo : cislo);
}

/** Suma v centoch (GoPay REST) na eurá. */
export function zCentov(centy: number | string | null | undefined): number | null {
  const n = typeof centy === "string" ? Number(centy.trim()) : centy;
  if (n == null || !Number.isFinite(n)) return null;
  return zaokruhli(n / 100);
}

function zaokruhli(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Symbol doplnený nulami zľava na pevnú dĺžku.
 *
 * Starý systém ukladal symboly ako čísla, takže `0015501234` sa stalo
 * `15501234` a nuly zľava sa nenávratne stratili. Porovnávať sa potom dalo len
 * náhodou. Tu je symbol vždy text pevnej dĺžky.
 *
 * Symbol dlhší než `dlzka` sa NEOREZÁVA — vráti sa tak, ako je. Orezaný symbol
 * by sa mohol zhodovať s cudzou objednávkou a to je horšie než nespárovať.
 */
export function normalizujSymbol(
  vstup: string | number | null | undefined,
  dlzka: number = DLZKA_SYMBOLU,
): string | null {
  if (vstup == null) return null;
  const cislice = String(vstup).replace(/\D/g, "");
  if (!cislice) return null;
  // Samé nuly nie sú symbol, je to „nevyplnené".
  if (/^0+$/.test(cislice)) return null;
  if (cislice.length >= dlzka) return cislice;
  return cislice.padStart(dlzka, "0");
}

export type Referencia = { vs: string | null; ss: string | null; ks: string | null };

/**
 * Rozloží referenciu platiteľa v tvare `/VS0015501234/SS0145000029/KS0308`.
 *
 * Používa ju ČSOB, SLSP aj camt.053 (`EndToEndId`). Ktorákoľvek časť môže
 * chýbať alebo byť prázdna (`/VS15501234/SS/KS0308`).
 */
export function rozlozReferenciu(vstup: string | null | undefined): Referencia {
  const prazdna: Referencia = { vs: null, ss: null, ks: null };
  if (!vstup) return prazdna;
  const text = String(vstup);
  const najdi = (znacka: string) => {
    const m = text.match(new RegExp(`/${znacka}\\s*:?\\s*(\\d*)`, "i"));
    return m ? m[1] : null;
  };
  return {
    vs: normalizujSymbol(najdi("VS")),
    ss: normalizujSymbol(najdi("SS")),
    ks: normalizujSymbol(najdi("KS"), DLZKA_KS),
  };
}

/**
 * Nájde variabilný symbol v popise platby.
 *
 * Posledná záchrana, keď banka pole VS nevyplnila (ČSOB a VÚB to robia).
 * Hľadá sa samostatné 8- až 10-miestne číslo. Kratšie čísla sa ignorujú
 * zámerne — v popise býva dátum, suma aj číslo karty a tie by sa trafili
 * do cudzej objednávky.
 *
 * Keď je takých čísel v popise viac, vráti sa `null`: hádať medzi dvoma
 * kandidátmi je horšie než poslať platbu človeku.
 */
export function vsZPopisu(popis: string | null | undefined): string | null {
  if (!popis) return null;
  const najdene = [...String(popis).matchAll(/(?<!\d)(\d{8,10})(?!\d)/g)].map((m) => m[1]);
  const unikatne = [...new Set(najdene)];
  if (unikatne.length !== 1) return null;
  return normalizujSymbol(unikatne[0]);
}

/**
 * Prekryje čísla platobných kariet v texte.
 *
 * Popisy z brán bežne obsahujú celé alebo čiastočné číslo karty a ukladať ho
 * je zbytočné riziko — do párovania neprispieva ničím. Necháva sa posledná
 * štvorica, podľa ktorej vie support kartu identifikovať.
 */
export function maskujKartu(text: string | null | undefined): string | null {
  if (!text) return text ?? null;
  return String(text).replace(/(?<!\d)(\d[\d\s-]{10,21}\d)(?!\d)/g, (zhoda) => {
    const cislice = zhoda.replace(/\D/g, "");
    if (cislice.length < 12 || cislice.length > 19) return zhoda;
    return `••••${cislice.slice(-4)}`;
  });
}

/** IBAN do logu — len banka a posledná štvorica. */
export function maskujIban(iban: string | null | undefined): string {
  if (!iban) return "—";
  const cisty = String(iban).replace(/\s+/g, "").toUpperCase();
  if (cisty.length <= 8) return cisty;
  return `${cisty.slice(0, 4)}…${cisty.slice(-4)}`;
}

/** Zjednotí IBAN na tvar bez medzier a veľkými písmenami. */
export function normalizujIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const cisty = String(iban).replace(/[\s-]/g, "").toUpperCase();
  return cisty || null;
}

/**
 * Transakcia v tvare, v akom ju dostáva párovanie.
 *
 * `booked_at` je dátum z banky, `received_at` doplní až zápis. Starý systém
 * mal na oboje jeden stĺpec a podľa neho sa rozhodovalo, či sa platba vôbec
 * spracuje — transakcie z Fio tak vypadli z okna hneď pri zápise.
 */
export type NormalizovanaTransakcia = {
  external_id: string | null;
  booked_at: string;
  value_date: string | null;
  amount: number;
  currency: string;
  vs_normalized: string | null;
  variable_symbol: string | null;
  specific_symbol: string | null;
  constant_symbol: string | null;
  counterparty_iban: string | null;
  counterparty_name: string | null;
  message: string | null;
  provider_tx_id: string | null;
};

export type ChybaParsovania = { chyba: string; riadok?: string };

export function jeChyba(x: NormalizovanaTransakcia | ChybaParsovania): x is ChybaParsovania {
  return (x as ChybaParsovania).chyba !== undefined;
}
