// Zoskupenie katalógu podľa série (turné).
//
// PREČO: to isté predstavenie vo troch mestách sú u nás tri podujatia —
// `event_dates` nemá miesto, takže termín je vždy v tej istej sále a turné
// pod jedno podujatie dať nemožno. V katalógu to ale vyzerá ako tri rovnaké
// karty bez súvislosti.
//
// Vzor je z Ticketportalu (overené 28. 10. 2026): v zozname jedna položka
// s rozsahom dátumov, na detaile zvislý zoznam predstavení, každé s miestom,
// mestom a vlastným tlačidlom Kúpiť.
//
// Séria je `event_groups` — tabuľka, ktorá v projekte existuje a vo formulári
// podujatia sa dá vybrať. Podujatie BEZ série sa chová ako doteraz; nič sa
// nezoskupuje samo podľa názvu, lebo dva rôzne koncerty s rovnakým názvom
// nie sú turné.
import { plural } from "./plural";
import { terminyVPredaji, type TerminLite } from "./terminy-popis";

/** Minimum, ktoré o podujatí potrebujeme vedieť. Zvyšok nás tu nezaujíma. */
export type PodujatieVKatalogu = {
  id: string;
  title: string;
  city: string;
  venue: string;
  event_date: string;
  event_time?: string | null;
  category?: string;
  image_url?: string;
  group_id?: string;
  group_name?: string;
  dates?: TerminLite[];
};

export type PolozkaKatalogu<E extends PodujatieVKatalogu> =
  | { druh: "podujatie"; kluc: string; podujatie: E }
  | {
      druh: "seria";
      kluc: string;
      nazov: string;
      kategoria?: string;
      obrazok?: string;
      podujatia: E[];
      /** Mestá v poradí, v akom sa hrá; bez opakovania. */
      mesta: string[];
      /** Prvý a posledný dátum, podľa ktorého sa skladá rozsah. */
      od: string;
      po: string;
      cenaOd: number;
    };

/** Najbližší dátum podujatia — termín v predaji má prednosť pred stĺpcom. */
export function najblizsiDatum(e: PodujatieVKatalogu, dnes?: string): string {
  const v = terminyVPredaji(e.dates, dnes);
  return v.length ? v[0].event_date : e.event_date;
}

/** Posledný dátum, aby rozsah série nekončil na prvom predstavení. */
export function poslednyDatum(e: PodujatieVKatalogu, dnes?: string): string {
  const v = terminyVPredaji(e.dates, dnes);
  return v.length ? v[v.length - 1].event_date : e.event_date;
}

/** „Prešov a ďalšie 2" — do karty sa tri mestá nezmestia. */
export function popisMiest(mesta: string[]): string {
  if (mesta.length === 0) return "";
  if (mesta.length === 1) return mesta[0];
  if (mesta.length === 2) return `${mesta[0]} a ${mesta[1]}`;
  const zvysok = mesta.length - 1;
  return `${mesta[0]} a ďalšie ${zvysok}`;
}

/** `3` → „3 mestá"; pri jednom meste sa počet nehlási. */
export function pocetMiest(n: number): string {
  return `${n} ${plural(n, "mesto", "mestá", "miest")}`;
}

/**
 * Zoskupí podujatia do položiek katalógu.
 *
 * Séria sa vytvorí len z DVOCH a viac podujatí. Jedno podujatie v série
 * zostane obyčajnou kartou — inak by klik viedol na stránku série s jediným
 * riadkom, čo je o jeden krok viac bez úžitku.
 *
 * Poradie: séria sa zaradí na miesto svojho najbližšieho podujatia, takže
 * zoradenie katalógu podľa dátumu zostáva v platnosti.
 */
export function zoskupPodujatia<E extends PodujatieVKatalogu>(
  podujatia: E[],
  cena: (e: E) => number,
  dnes?: string,
): PolozkaKatalogu<E>[] {
  const serie = new Map<string, E[]>();
  for (const e of podujatia) {
    if (!e.group_id) continue;
    const zoznam = serie.get(e.group_id);
    if (zoznam) zoznam.push(e);
    else serie.set(e.group_id, [e]);
  }

  const polozky: PolozkaKatalogu<E>[] = [];
  const hotove = new Set<string>();

  for (const e of podujatia) {
    const vSerii = e.group_id ? serie.get(e.group_id) : undefined;

    if (!vSerii || vSerii.length < 2) {
      polozky.push({ druh: "podujatie", kluc: e.id, podujatie: e });
      continue;
    }
    if (hotove.has(e.group_id!)) continue;
    hotove.add(e.group_id!);

    // V rámci série radíme podľa dátumu — poradie z katalógu môže byť podľa
    // ceny alebo názvu, ale zoznam predstavení má ísť chronologicky.
    const zoradene = vSerii
      .slice()
      .sort((a, b) => najblizsiDatum(a, dnes).localeCompare(najblizsiDatum(b, dnes)));

    const mesta: string[] = [];
    for (const x of zoradene) if (x.city && !mesta.includes(x.city)) mesta.push(x.city);

    const ceny = zoradene.map(cena).filter((c) => Number.isFinite(c) && c > 0);
    const prvy = zoradene[0];
    const posledny = zoradene[zoradene.length - 1];

    polozky.push({
      druh: "seria",
      kluc: e.group_id!,
      nazov: e.group_name || prvy.title,
      kategoria: prvy.category,
      // Obrázok série v katalógu berieme z prvého predstavenia; vlastný
      // obrázok skupiny zobrazuje až stránka série.
      obrazok: zoradene.find((x) => x.image_url)?.image_url,
      podujatia: zoradene,
      mesta,
      od: najblizsiDatum(prvy, dnes),
      po: poslednyDatum(posledny, dnes),
      cenaOd: ceny.length ? Math.min(...ceny) : 0,
    });
  }

  return polozky;
}
