// Overenie podpisu Stripe webhooku.
//
// Bez tohto overenia je webhook otvorené API na vydávanie vstupeniek: kto
// pozná adresu, pošle si „zaplatené" a dostane lístky. Preto sa telo overuje
// **pred** čímkoľvek iným a nikdy sa mu neveria sumy — tie sa berú z Stripe
// objektu až po overení.
//
// Stripe posiela hlavičku `Stripe-Signature`:
//   t=1699999999,v1=5257a869e7…,v1=…
// Podpisuje sa `${t}.${surové telo}` kľúčom `whsec_…` (HMAC-SHA256, hex).
// Podpisov v1 môže byť viac — počas rotácie kľúča. Stačí jeden platný.
import crypto from "node:crypto";

export type VysledokPodpisu = { ok: true } | { ok: false; dovod: string };

/** Predvolená tolerancia veku podpisu. Stripe sám odporúča päť minút. */
export const TOLERANCIA_S = 300;

export function rozparsujHlavicku(hlavicka: string): { t: number | null; v1: string[] } {
  let t: number | null = null;
  const v1: string[] = [];
  for (const cast of (hlavicka || "").split(",")) {
    const [kluc, hodnota] = cast.split("=", 2).map((x) => (x ?? "").trim());
    if (kluc === "t" && /^\d+$/.test(hodnota)) t = Number(hodnota);
    else if (kluc === "v1" && /^[0-9a-f]+$/i.test(hodnota)) v1.push(hodnota.toLowerCase());
  }
  return { t, v1 };
}

/** Porovnanie v konštantnom čase — bežné `===` prezradí podpis po znakoch. */
function rovnake(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Overí podpis surového tela.
 *
 * `telo` musí byť presne to, čo prišlo — nie preparsovaný a znova
 * poskládaný JSON. Jediná zmena bieleho znaku podpis zneplatní.
 */
export function overPodpis(
  telo: string,
  hlavicka: string,
  tajomstvo: string,
  moznosti?: { toleranciaS?: number; teraz?: number },
): VysledokPodpisu {
  if (!tajomstvo) return { ok: false, dovod: "chýba podpisové tajomstvo webhooku" };
  if (!hlavicka) return { ok: false, dovod: "chýba hlavička Stripe-Signature" };

  const { t, v1 } = rozparsujHlavicku(hlavicka);
  if (t === null) return { ok: false, dovod: "v podpise chýba časová značka" };
  if (v1.length === 0) return { ok: false, dovod: "v podpise chýba v1" };

  const tolerancia = moznosti?.toleranciaS ?? TOLERANCIA_S;
  const teraz = moznosti?.teraz ?? Math.floor(Date.now() / 1000);
  const vek = teraz - t;
  // Záporný vek zámerne tolerujeme do rovnakej miery: hodiny serverov sa
  // rozchádzajú a odmietnuť platnú notifikáciu je horšie než pustiť ju o pár
  // sekúnd „z budúcnosti".
  if (Math.abs(vek) > tolerancia) {
    return { ok: false, dovod: `podpis je starý ${vek} s, tolerancia je ${tolerancia} s` };
  }

  const ocakavany = crypto
    .createHmac("sha256", tajomstvo)
    .update(`${t}.${telo}`, "utf8")
    .digest("hex");

  for (const podpis of v1) {
    if (rovnake(podpis, ocakavany)) return { ok: true };
  }
  return { ok: false, dovod: "podpis nesedí" };
}
