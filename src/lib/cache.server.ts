// Krátkodobá pamäť odpovedí na strane servera.
//
// Pri spustení predaja sedí na jednom podujatí tisíc ľudí a všetci chcú to
// isté: údaje o podujatí, cenník a mapu sedadiel. Bez tohto ide každý pohľad
// zvlášť do Supabase — a jedna cesta tam trvá ~130 ms, lebo databáza je
// v inom štáte. Nie je to o výkone servera, ten sa nudí; je to o počte ciest.
//
// Dôležitejšie než samotné pamätanie je **zlučovanie súbežných dopytov**:
// keď platnosť vyprší a naraz príde sto ľudí, do databázy smie ísť jeden
// a zvyšok počká na jeho odpoveď. Bez toho by cache pri každom vypršaní
// pustila celý nápor naraz a bola by na nič práve vo chvíli, keď ju treba.
//
// Pamäť je v procese, nie zdieľaná. Pri jednej inštancii (dnešný `fork` režim
// pm2) to je celá pravda; keby raz bežalo viac inštancií, každá by mala
// vlastnú a platnosť by sa medzi nimi líšila o dĺžku TTL.

type Zaznam = { hodnota: unknown; platneDo: number };

const zaznamy = new Map<string, Zaznam>();
const rozpracovane = new Map<string, Promise<unknown>>();

/** Nad týmto počtom sa pri zápise vyhádžu prošlé záznamy. */
const STROP = 5000;

function uprac() {
  const teraz = Date.now();
  for (const [k, z] of zaznamy) {
    if (z.platneDo <= teraz) zaznamy.delete(k);
  }
  // Keby aj po upratovaní bolo plno, zahodíme najstaršie vložené.
  if (zaznamy.size > STROP) {
    const koľko = zaznamy.size - STROP;
    let i = 0;
    for (const k of zaznamy.keys()) {
      zaznamy.delete(k);
      if (++i >= koľko) break;
    }
  }
}

/**
 * Vráti zapamätanú hodnotu, alebo ju načíta a zapamätá.
 *
 * `nacitaj` sa pri súbežných netrafeniach spustí **raz**; ostatní volajúci
 * dostanú tú istú odpoveď. Keď načítanie zlyhá, nič sa neuloží a chyba
 * prebublá volajúcemu — cache nesmie zakonzervovať výpadok.
 */
export async function cachuj<T>(
  kluc: string,
  ttlMs: number,
  nacitaj: () => Promise<T>,
): Promise<T> {
  const teraz = Date.now();
  const z = zaznamy.get(kluc);
  if (z && z.platneDo > teraz) return z.hodnota as T;

  const bezi = rozpracovane.get(kluc);
  if (bezi) return bezi as Promise<T>;

  const p = (async () => {
    try {
      const hodnota = await nacitaj();
      zaznamy.set(kluc, { hodnota, platneDo: Date.now() + ttlMs });
      if (zaznamy.size > STROP) uprac();
      return hodnota;
    } finally {
      rozpracovane.delete(kluc);
    }
  })();

  rozpracovane.set(kluc, p);
  return p;
}

/** Zahodí všetko, čo začína danou predponou. Volaj po zápise, ktorý to mení. */
export function zabudni(predpona: string): void {
  for (const k of zaznamy.keys()) {
    if (k.startsWith(predpona)) zaznamy.delete(k);
  }
}

/** Pre diagnostiku v administrácii. */
export function stavCache(): { zaznamov: number; rozpracovanych: number } {
  return { zaznamov: zaznamy.size, rozpracovanych: rozpracovane.size };
}
