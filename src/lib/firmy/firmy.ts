// Register firiem — čisté časti.
//
// Načo to je: keď si zákazník v checkoute zaškrtne nákup na firmu, nemá
// prepisovať údaje z výpisu ručne. Zadá IČO alebo názov a zvyšok sa doplní.
//
// ODKIAĽ SA BERÚ ÚDAJE (a prečo z viacerých zdrojov):
//   * **RPO** Štatistického úradu — bezplatný, oficiálny, bez kľúča. Dá názov,
//     IČO, sídlo a zápis v registri. **Nedá DIČ ani IČ DPH.**
//   * **VIES** (EÚ) — bezplatné overenie IČ DPH, keď ho zákazník zadá.
//   * **FinStat** — platený, dá aj DIČ a IČ DPH. Doplní sa, keď bude kľúč;
//     jeho presný podpis požiadavky je v dokumentácii pre zákazníkov, takže
//     sa nedá uhádnuť a zámerne sa tu nehádá.
//
// NIČ Z TOHO NESMIE ZABLOKOVAŤ NÁKUP. Register bol pri písaní tohto kódu
// nedostupný (timeout) — preto má kontrola IČO fungovať aj offline a zákazník
// musí vždy vedieť údaje dopísať ručne.

/** Firma tak, ako ju vrátime do checkoutu. */
export type Firma = {
  nazov: string;
  ico: string;
  dic: string | null;
  ic_dph: string | null;
  ulica: string | null;
  mesto: string | null;
  psc: string | null;
  stat: string;
  /** Odkiaľ údaje pochádzajú — zobrazuje sa zákazníkovi. */
  zdroj: "rpo" | "finstat" | "vies";
  /** Zápis v obchodnom registri, keď ho zdroj vie. */
  registracia: string | null;
};

/** Z IČO nechá len číslice. Ľudia ho píšu s medzerami, tak ako ho vidia. */
export function normalizujIco(vstup: unknown): string {
  return typeof vstup === "string" ? vstup.replace(/\D/g, "") : "";
}

/**
 * Kontrolná číslica IČO (modulo 11).
 *
 * Toto je to podstatné: preklep sa odhalí **bez siete**. Register bol pri
 * písaní nedostupný a aj tak má zákazník dostať okamžitú odpoveď, že si
 * zle prepísal číslo.
 */
export function platneIco(vstup: unknown): boolean {
  const ico = normalizujIco(vstup);
  if (!/^\d{8}$/.test(ico)) return false;

  let sucet = 0;
  for (let i = 0; i < 7; i++) sucet += Number(ico[i]) * (8 - i);
  const zostatok = sucet % 11;
  const ocakavana = zostatok === 0 ? 1 : zostatok === 1 ? 0 : 11 - zostatok;
  return Number(ico[7]) === ocakavana;
}

/** IČ DPH v tvare, aký čaká VIES: dvojpísmenový štát + číslo. */
export function normalizujIcDph(vstup: unknown): { stat: string; cislo: string } | null {
  const t = typeof vstup === "string" ? vstup.toUpperCase().replace(/[\s.-]/g, "") : "";
  // Telo musí začínať číslicou. Bez toho by „MsKS Pezinok" po odstránení
  // medzier prešlo ako IČ DPH štátu „MS" — presne to chytili testy.
  // Písmená ďalej v tele povoliť treba (napríklad IE6388047V, NL…B01).
  const m = t.match(/^([A-Z]{2})([0-9][0-9A-Z]{1,12})$/);
  if (!m) return null;
  return { stat: m[1], cislo: m[2] };
}

/**
 * DIČ je desať číslic.
 *
 * Predponu štátu zámerne odstrihneme: ľudia do poľa DIČ bežne vložia IČ DPH
 * (`SK2020662889`) a pri slovenských firmách je to to isté číslo. Odmietnuť to
 * by bolo formálne správne a prakticky otravné.
 */
export function normalizujDic(vstup: unknown): string | null {
  const t = typeof vstup === "string" ? vstup.replace(/\D/g, "") : "";
  return /^\d{10}$/.test(t) ? t : null;
}

export type DruhDotazu = "ico" | "ic_dph" | "nazov" | "prazdne";

/**
 * Čo zákazník vlastne napísal.
 *
 * Rozhoduje to, do ktorého zdroja sa pôjde: osem číslic je IČO, text
 * s predponou štátu je IČ DPH, zvyšok je názov.
 */
export function druhDotazu(vstup: unknown): DruhDotazu {
  const t = typeof vstup === "string" ? vstup.trim() : "";
  if (t.length < 2) return "prazdne";
  if (/^\d[\d\s]*$/.test(t) && normalizujIco(t).length === 8) return "ico";
  if (normalizujIcDph(t) && /^[A-Za-z]{2}/.test(t)) return "ic_dph";
  return "nazov";
}

/** Zloží adresu do jedného riadku na zobrazenie v ponuke. */
export function adresaJedenRiadok(f: Pick<Firma, "ulica" | "psc" | "mesto">): string {
  return [f.ulica, [f.psc, f.mesto].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/**
 * Spojí údaje z viacerých zdrojov.
 *
 * Prednosť má ten, kto údaj naozaj má: RPO vie sídlo a zápis v registri,
 * FinStat navyše DIČ a IČ DPH. Nikdy sa neprepíše vyplnená hodnota prázdnou —
 * inak by druhý zdroj vymazal, čo prvý našiel.
 */
export function zlucFirmy(zaklad: Firma, doplnok: Partial<Firma> | null): Firma {
  if (!doplnok) return zaklad;
  const vyber = <K extends keyof Firma>(k: K): Firma[K] => {
    const nove = doplnok[k];
    const prazdne = nove === null || nove === undefined || nove === "";
    return prazdne ? zaklad[k] : (nove as Firma[K]);
  };
  return {
    nazov: vyber("nazov"),
    ico: vyber("ico"),
    dic: vyber("dic"),
    ic_dph: vyber("ic_dph"),
    ulica: vyber("ulica"),
    mesto: vyber("mesto"),
    psc: vyber("psc"),
    stat: vyber("stat"),
    zdroj: zaklad.zdroj,
    registracia: vyber("registracia"),
  };
}

/** Čo z firmy predplníme do formulára objednávky. */
export function naFormular(f: Firma): {
  name: string;
  ico: string;
  dic: string;
  ic_dph: string;
  street: string;
  city: string;
  zip: string;
} {
  return {
    name: f.nazov,
    ico: f.ico,
    dic: f.dic ?? "",
    ic_dph: f.ic_dph ?? "",
    street: f.ulica ?? "",
    city: f.mesto ?? "",
    zip: f.psc ?? "",
  };
}
