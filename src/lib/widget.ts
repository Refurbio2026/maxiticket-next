// Widget na web organizátora — spoločné, čisté časti.
//
// Organizátor si na vlastnú stránku vloží dva riadky a zobrazia sa mu jeho
// podujatia s tlačidlom na kúpu. Nákup sa **vždy** otvorí na eticketo.eu
// v novej karte: platobná brána a 3DS vo vnorenom ráme na cudzej doméne sú
// nespoľahlivé a z pohľadu bezpečnosti zlý zvyk (zákazník nevidí, komu
// zadáva kartu).
//
// Tento modul neobsahuje nič serverové ani DOM — len overovanie parametrov,
// skladanie adries a úryvku kódu, aby sa to dalo testovať.

/** Čo widget zobrazuje. */
export type Rezim = "zoznam" | "podujatie" | "tlacidlo";

export type Vzhlad = "svetly" | "tmavy" | "auto";

export const REZIMY: Rezim[] = ["zoznam", "podujatie", "tlacidlo"];
export const VZHLADY: Vzhlad[] = ["svetly", "tmavy", "auto"];

export const POCET_PODUJATI = { najmenej: 1, najviac: 20, predvolene: 5 } as const;

/** Predvolená oranžová z `--gradient-flame`. */
export const FARBA_PREDVOLENA = "#fe6a00";

export type Nastavenia = {
  rezim: Rezim;
  /** Subdoména organizátora — `mskspezinok` z `mskspezinok.eticketo.eu`. */
  organizator: string;
  /** Id podujatia; povinné pre režimy `podujatie` a `tlacidlo`. */
  podujatie: string | null;
  pocet: number;
  vzhlad: Vzhlad;
  farba: string;
};

export const NASTAVENIA_PREDVOLENE: Nastavenia = {
  rezim: "zoznam",
  organizator: "",
  podujatie: null,
  pocet: POCET_PODUJATI.predvolene,
  vzhlad: "auto",
  farba: FARBA_PREDVOLENA,
};

/** Subdoména: to isté, čo dovoľuje `slugify` v databáze. */
export function platnaSubdomena(x: unknown): boolean {
  return typeof x === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x) && x.length <= 63;
}

export function platneUuid(x: unknown): boolean {
  return (
    typeof x === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)
  );
}

/** Farba sa vkladá do CSS, takže sa pripúšťa len čistý hex. */
export function platnaFarba(x: unknown): boolean {
  return typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x);
}

/** Počet orežaný do rozumných hraníc; nečíslo spadne na predvolený. */
export function orezPocet(x: unknown): number {
  const n = typeof x === "number" ? x : Number.parseInt(String(x ?? ""), 10);
  if (!Number.isFinite(n)) return POCET_PODUJATI.predvolene;
  return Math.min(POCET_PODUJATI.najviac, Math.max(POCET_PODUJATI.najmenej, Math.trunc(n)));
}

/**
 * Prečíta parametre tak, ako prídu z `data-*` atribútov alebo z adresy.
 *
 * Nikdy nespadne: čo nerozumie, nahradí predvoleným. Widget na cudzom webe
 * nemá právo zhodiť stránku pre preklep v atribúte.
 */
export function precitajNastavenia(vstup: Record<string, unknown>): Nastavenia {
  const rezim = REZIMY.includes(vstup.rezim as Rezim)
    ? (vstup.rezim as Rezim)
    : NASTAVENIA_PREDVOLENE.rezim;
  const vzhlad = VZHLADY.includes(vstup.vzhlad as Vzhlad)
    ? (vstup.vzhlad as Vzhlad)
    : NASTAVENIA_PREDVOLENE.vzhlad;
  return {
    rezim,
    organizator: platnaSubdomena(vstup.organizator) ? (vstup.organizator as string) : "",
    podujatie: platneUuid(vstup.podujatie) ? (vstup.podujatie as string) : null,
    pocet: orezPocet(vstup.pocet),
    vzhlad,
    farba: platnaFarba(vstup.farba) ? (vstup.farba as string).toLowerCase() : FARBA_PREDVOLENA,
  };
}

/** Čo musí byť vyplnené, aby sa dalo niečo zobraziť. Prázdne pole = v poriadku. */
export function coChyba(n: Nastavenia): string[] {
  const chyby: string[] = [];
  if (n.rezim === "zoznam" && !n.organizator) {
    chyby.push("Chýba subdoména organizátora.");
  }
  if ((n.rezim === "podujatie" || n.rezim === "tlacidlo") && !n.podujatie) {
    chyby.push("Pri jednom podujatí treba vybrať konkrétne podujatie.");
  }
  return chyby;
}

/** Adresa, z ktorej si widget vytiahne dáta. */
export function adresaDat(zaklad: string, n: Nastavenia): string {
  const u = new URL("/api/widget/events", zaklad);
  if (n.rezim === "zoznam") {
    u.searchParams.set("organizator", n.organizator);
    u.searchParams.set("pocet", String(n.pocet));
  } else if (n.podujatie) {
    u.searchParams.set("podujatie", n.podujatie);
  }
  return u.toString();
}

/** Adresa, kam ide zákazník kupovať. `utm_source` nech organizátor vidí v štatistike. */
export function adresaNakupu(zaklad: string, idPodujatia: string): string {
  const u = new URL(`/events/${idPodujatia}`, zaklad);
  u.searchParams.set("utm_source", "widget");
  return u.toString();
}

/** Úryvok kódu na skopírovanie. Píše sa do stránky organizátora, preto strohý. */
export function uryvokKodu(zaklad: string, n: Nastavenia): string {
  const atributy: string[] = [`src="${zaklad}/widget.js"`];
  if (n.rezim !== "zoznam") atributy.push(`data-rezim="${n.rezim}"`);
  if (n.rezim === "zoznam") {
    atributy.push(`data-organizator="${n.organizator}"`);
    if (n.pocet !== POCET_PODUJATI.predvolene) atributy.push(`data-pocet="${n.pocet}"`);
  } else if (n.podujatie) {
    atributy.push(`data-podujatie="${n.podujatie}"`);
  }
  if (n.vzhlad !== NASTAVENIA_PREDVOLENE.vzhlad) atributy.push(`data-vzhlad="${n.vzhlad}"`);
  if (n.farba !== FARBA_PREDVOLENA) atributy.push(`data-farba="${n.farba}"`);

  // Odsadenie je na čítanie v stránke organizátora, nie pre nás.
  return `<div id="eticketo"></div>\n<script\n  ${atributy.join("\n  ")}\n  defer></script>`;
}

/** Jedno podujatie tak, ako ho widget dostane. Len to, čo je aj tak verejné. */
export type WidgetPodujatie = {
  id: string;
  nazov: string;
  datum: string;
  cas: string | null;
  miesto: string | null;
  mesto: string | null;
  obrazok: string | null;
  kategoria: string | null;
  cena_od: number | null;
  odkaz: string;
};

export type WidgetOdpoved = {
  organizator: { nazov: string; subdomena: string | null } | null;
  podujatia: WidgetPodujatie[];
};
