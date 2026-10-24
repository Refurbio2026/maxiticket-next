// Výplaty z ComGate — čítanie odpovedí.
//
// ComGate dáva dve veci:
//   GET /v2.0/transferList.json?date=RRRR-MM-DD   zoznam výplat za deň
//   GET /v2.0/singleTransfer.json?transferId=…    platby, z ktorých sa skladá
//
// POZOR NA TVAR: v testovacej prevádzke žiadne výplaty nie sú, takže som
// skutočnú odpoveď nikdy nevidel — overené je len to, že obe adresy
// odpovedajú (prázdny zoznam, resp. „nie si vlastník tejto výplaty").
// Preto sa tu nečíta podľa presných názvov polí, ale zhovievavo: hľadá sa
// kľúč, ktorý názvom zodpovedá. Keď sa nenájde nič, funkcia to prizná a
// krok to ohlási — nikdy nepredstiera, že výplata sedí.
export type Vyplata = {
  id: string;
  datum: string | null;
  suma: number | null;
  mena: string | null;
  ucet: string | null;
};

export type PlatbaVoVyplate = {
  transId: string | null;
  suma: number | null;
  poplatok: number | null;
  vs: string | null;
};

type Zaznam = Record<string, unknown>;

/** Hodnota podľa prvého kľúča, ktorý sedí na vzor. */
function podla(z: Zaznam, vzor: RegExp): unknown {
  for (const [k, v] of Object.entries(z)) if (vzor.test(k)) return v;
  return undefined;
}

function cislo(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") {
    const n = Number(x.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function text(x: unknown): string | null {
  const t = typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : "";
  return t || null;
}

/** Pole záznamov nájde aj vtedy, keď je zabalené v objekte. */
function zoznam(data: unknown): Zaznam[] {
  if (Array.isArray(data)) return data as Zaznam[];
  if (data && typeof data === "object") {
    for (const v of Object.values(data as Zaznam)) {
      if (Array.isArray(v)) return v as Zaznam[];
    }
  }
  return [];
}

export function precitajVyplaty(data: unknown): Vyplata[] {
  return zoznam(data)
    .map((z) => ({
      id: text(podla(z, /transferid|^id$/i)) ?? "",
      datum: text(podla(z, /date|datum/i))?.slice(0, 10) ?? null,
      // Suma chodí buď ako číslo, alebo v najmenších jednotkách — rozlíšiť
      // sa to nedá, preto sa berie tak, ako prišla, a porovnáva s toleranciou.
      suma: cislo(podla(z, /amount|price|suma|castka|částka|outgoing/i)),
      mena: text(podla(z, /curr|mena/i)),
      ucet: text(podla(z, /account|ucet|iban/i)),
    }))
    .filter((v) => v.id);
}

export function precitajRozpad(data: unknown): PlatbaVoVyplate[] {
  return zoznam(data)
    .map((z) => ({
      transId: text(podla(z, /transid|paymentid/i)),
      suma: cislo(podla(z, /amount|price|suma|castka|částka/i)),
      poplatok: cislo(podla(z, /fee|poplatok|poplatek/i)),
      vs: text(podla(z, /refid|variable|vs/i)),
    }))
    .filter((p) => p.transId || p.suma !== null);
}

export type Porovnanie = {
  /** Súčet platieb, ktoré brána vo výplate uvádza. */
  suctyBrany: number;
  /** Súčet tých istých platieb podľa našej knihy. */
  suctyNase: number;
  /** Platby vo výplate, ktoré v našej knihe nie sú. */
  chybajuNam: string[];
  /** Rozdiel v sume; nula znamená, že výplata sedí. */
  rozdiel: number;
};

/**
 * Porovná rozpad výplaty s našou knihou platieb.
 *
 * `nase` je mapa referencia brány → suma, akú evidujeme my.
 */
export function porovnaj(rozpad: PlatbaVoVyplate[], nase: Map<string, number>): Porovnanie {
  let suctyBrany = 0;
  let suctyNase = 0;
  const chybajuNam: string[] = [];

  for (const p of rozpad) {
    suctyBrany += p.suma ?? 0;
    if (!p.transId) continue;
    const u = nase.get(p.transId);
    if (u === undefined) chybajuNam.push(p.transId);
    else suctyNase += u;
  }

  return {
    suctyBrany: Math.round(suctyBrany * 100) / 100,
    suctyNase: Math.round(suctyNase * 100) / 100,
    chybajuNam,
    rozdiel: Math.round((suctyBrany - suctyNase) * 100) / 100,
  };
}
