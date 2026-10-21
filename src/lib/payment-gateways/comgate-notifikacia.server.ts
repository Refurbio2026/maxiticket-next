// Overenie a prečítanie push notifikácie od ComGate.
//
// ComGate notifikáciu **nepodpisuje**. Posiela v tele pole `secret` — to isté
// heslo, ktorým sa my prihlasujeme k ich API. Overenie teda stojí na troch
// veciach a žiadna z nich sama nestačí:
//
//   1. `secret` v tele sedí s našim (porovnanie v konštantnom čase),
//   2. notifikácia sa berie len ako **podnet**, nie ako pravda — stav si
//      vypýtame priamo z `/v2.0/payment/transId/…`, čo dokumentácia ComGate
//      výslovne žiada („the payment status should never be evaluated solely
//      based on the received notification"),
//   3. obmedzenie na IP brány patrí do nginxu, nie sem — perimeter je
//      Patrikov a navyše dnes zlieva adresy, takže by to tu nefungovalo.
//
// Telo prichádza ako JSON (pri platbách založených cez v2.0 API) alebo ako
// form-urlencoded (pri v1.0). Prijímame oboje — brána si to vyberá sama podľa
// toho, ako platba vznikla, a jedného dňa môže prísť aj to druhé.
import crypto from "node:crypto";

export type Notifikacia = {
  transId: string;
  refId: string | null;
  status: string;
  /** Suma v najmenšej jednotke, ako ju poslala brána. Len na porovnanie v logu. */
  price: number | null;
  curr: string | null;
  test: boolean;
};

/** Porovnanie v konštantnom čase — bežné `===` prezradí heslo po znakoch. */
export function rovnakeTajomstvo(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Prečíta telo notifikácie. Nerozhoduje o pravdivosti — len vyťahuje polia.
 *
 * `null` znamená, že sa telo nedá prečítať; volajúci to má odmietnuť.
 */
export function precitajTelo(
  telo: string,
  contentType: string | null,
): { polia: Record<string, string>; notifikacia: Notifikacia | null } {
  const polia: Record<string, string> = {};

  const jeJson = (contentType || "").toLowerCase().includes("json") || telo.trim().startsWith("{");
  if (jeJson) {
    try {
      const d = JSON.parse(telo) as Record<string, unknown>;
      for (const [k, v] of Object.entries(d)) {
        if (v !== null && v !== undefined && typeof v !== "object") polia[k] = String(v);
      }
    } catch {
      return { polia, notifikacia: null };
    }
  } else {
    for (const [k, v] of new URLSearchParams(telo).entries()) polia[k] = v;
  }

  const transId = (polia.transId || "").trim();
  const status = (polia.status || "").trim().toUpperCase();
  if (!transId || !status) return { polia, notifikacia: null };

  const cena = Number(polia.price);
  return {
    polia,
    notifikacia: {
      transId,
      refId: polia.refId?.trim() || null,
      status,
      price: Number.isFinite(cena) ? cena : null,
      curr: polia.curr?.trim().toUpperCase() || null,
      // Brána posiela "true"/"false" ako text aj ako JSON boolean.
      test: polia.test === "true" || polia.test === "1",
    },
  };
}

/**
 * Jediné miesto, kde sa rozhoduje, čo s prijatou notifikáciou.
 *
 * Je to vytiahnuté z routy zámerne: ide o bezpečnostné rozhodnutie a takto sa
 * dá otestovať každá vetva bez siete a bez databázy. Routa len premení
 * výsledok na HTTP odpoveď.
 */
export type Rozhodnutie =
  | { co: "nenastavene" }
  | { co: "cudzie-heslo" }
  | { co: "necitatelne" }
  | { co: "spracuj"; notifikacia: Notifikacia };

export function rozhodniONotifikacii(
  telo: string,
  contentType: string | null,
  naseTajomstvo: string | null | undefined,
): Rozhodnutie {
  if (!naseTajomstvo) return { co: "nenastavene" };

  const { polia, notifikacia } = precitajTelo(telo, contentType);

  // Heslo sa overuje PRED čímkoľvek iným: bez neho je to otvorené API na
  // vydávanie vstupeniek.
  if (!rovnakeTajomstvo(polia.secret ?? "", naseTajomstvo)) return { co: "cudzie-heslo" };
  if (!notifikacia) return { co: "necitatelne" };

  return { co: "spracuj", notifikacia };
}
