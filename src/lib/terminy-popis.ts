// Ako sa termíny podujatia napíšu do jedného riadku v katalógu.
//
// PREČO: na karte v katalógu bol dosiaľ `event_date` zo stĺpca podujatia —
// surový ISO dátum s sekundami („2026-11-17 · 18:00:00") a bez zmienky, že
// podujatie má ďalšie termíny. Kto hľadá, kedy sa to hrá, sa to z karty
// nedozvedel; musel otvoriť detail.
//
// Vzor je prevzatý z toho, ako to robí Ticketportal (overené 28. 10. 2026):
// v zozname jedna položka s rozsahom dátumov, nie položka na každý termín.
// Výber konkrétneho termínu patrí na detail podujatia — ten to u nás vie
// („Vyber termín") už dnes.
import { plural } from "./plural";

export type TerminLite = {
  event_date: string;
  event_time?: string | null;
  status?: string | null;
};

/** Termíny, ktoré sa dnes dajú kúpiť — v predaji a neodohrané. */
export function terminyVPredaji(terminy: TerminLite[] | undefined, dnes?: string): TerminLite[] {
  const den = dnes ?? new Date().toISOString().slice(0, 10);
  return (
    (terminy ?? [])
      // Porovnáva sa na deň, aby dnešné večerné predstavenie zostalo v predaji
      // ešte aj popoludní — rovnako ako na detaile podujatia.
      .filter((t) => t.status === "on_sale" && t.event_date >= den)
      .slice()
      .sort((a, b) =>
        `${a.event_date}T${a.event_time ?? ""}`.localeCompare(
          `${b.event_date}T${b.event_time ?? ""}`,
        ),
      )
  );
}

/** `3` → „3 termíny"; skloňovanie podľa slovenského pravidla. */
export function pocetTerminov(n: number): string {
  return `${n} ${plural(n, "termín", "termíny", "termínov")}`;
}

/** `2026-11-17` → `17. 11. 2026`. Pri nečitateľnom vstupe vráti vstup. */
export function den(datum: string): string {
  const d = new Date(`${datum}T00:00:00`);
  if (Number.isNaN(d.getTime())) return datum;
  return d.toLocaleDateString("sk-SK", { day: "numeric", month: "numeric", year: "numeric" });
}

/** `18:00:00` → `18:00`; prázdny čas nevracia nič. */
export function hodina(cas: string | null | undefined): string {
  const t = (cas ?? "").slice(0, 5);
  return /^\d{2}:\d{2}$/.test(t) ? t : "";
}

/**
 * Rozsah dvoch dátumov. Keď sú v tom istom roku, rok sa napíše raz;
 * keď aj v tom istom mesiaci, mesiac tiež — „17. – 19. 11. 2026".
 */
export function rozsah(od: string, po: string): string {
  const a = new Date(`${od}T00:00:00`);
  const b = new Date(`${po}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${den(od)} – ${den(po)}`;
  if (od === po) return den(od);

  const rovnakyRok = a.getFullYear() === b.getFullYear();
  const rovnakyMesiac = rovnakyRok && a.getMonth() === b.getMonth();
  if (rovnakyMesiac) return `${a.getDate()}. – ${den(po)}`;
  if (rovnakyRok) {
    return `${a.getDate()}. ${a.getMonth() + 1}. – ${den(po)}`;
  }
  return `${den(od)} – ${den(po)}`;
}

export type PopisTerminov = {
  /** Text do karty, napríklad „17. – 19. 11. 2026". */
  text: string;
  /** Koľko termínov je v predaji. 0 = žiadny. */
  pocet: number;
  /** Doplnok „3 termíny", keď je ich viac. Pri jednom `null`. */
  viac: string | null;
};

/**
 * Jeden riadok o tom, kedy sa podujatie hrá.
 *
 * `zaloha` je dátum zo stĺpca podujatia — použije sa, keď žiadny termín nie
 * je v predaji. Bez nej by karta pri podujatí bez otvoreného predaja
 * neukázala vôbec nič, čo vyzerá ako chyba stránky.
 */
export function popisTerminov(
  terminy: TerminLite[] | undefined,
  zaloha?: { event_date?: string | null; event_time?: string | null },
  dnes?: string,
): PopisTerminov {
  const v = terminyVPredaji(terminy, dnes);

  if (v.length === 0) {
    const d = zaloha?.event_date;
    if (!d) return { text: "Termín zverejníme", pocet: 0, viac: null };
    const h = hodina(zaloha?.event_time);
    return { text: h ? `${den(d)} · ${h}` : den(d), pocet: 0, viac: null };
  }

  if (v.length === 1) {
    const h = hodina(v[0].event_time);
    return {
      text: h ? `${den(v[0].event_date)} · ${h}` : den(v[0].event_date),
      pocet: 1,
      viac: null,
    };
  }

  return {
    text: rozsah(v[0].event_date, v[v.length - 1].event_date),
    pocet: v.length,
    viac: pocetTerminov(v.length),
  };
}

/**
 * Padne podujatie do zvoleného rozsahu dátumov?
 *
 * Rozhoduje KTORÝKOĽVEK termín v predaji, nie dátum zo stĺpca podujatia.
 * Ten je len najbližší z termínov, takže filtrovanie podľa neho skrylo
 * podujatie, ktoré v hľadanom období naozaj hrá — a naopak ukázalo
 * podujatie, ktorého jediný termín v tom období nie je.
 *
 * Keď žiadny termín v predaji nie je, padá sa na dátum podujatia, aby sa
 * filtrovanie chovalo rovnako ako text na karte.
 */
export function vRozsahu(
  terminy: TerminLite[] | undefined,
  zaloha: { event_date?: string | null } | undefined,
  od: string | null | undefined,
  po: string | null | undefined,
  dnes?: string,
): boolean {
  if (!od && !po) return true;
  const v = terminyVPredaji(terminy, dnes);
  const datumy = v.length ? v.map((t) => t.event_date) : [zaloha?.event_date].filter(Boolean);
  if (!datumy.length) return false;
  return datumy.some((d) => (!od || (d as string) >= od) && (!po || (d as string) <= po));
}
