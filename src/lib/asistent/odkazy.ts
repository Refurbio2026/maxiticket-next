// Odkazy v odpovedi asistenta.
//
// Model píše cesty ako `/events` alebo `[Moje vstupenky](/account)`. Tu sa
// odpoveď rozdelí na text a odkazy, aby ich widget vedel vykresliť ako
// klikacie. Zámerne sa nevykresľuje HTML ani cudzie adresy — odkazom sa
// stane len cesta v tejto aplikácii, takže z odpovede nemôže vzniknúť
// odkaz na cudzí web.

export type Cast = { text: string; cesta?: string };

/**
 * Cesty, ktoré sa smú stať odkazom.
 *
 * Model môže napísať aj cestu, ktorá v aplikácii neexistuje — taký odkaz by
 * návštevníka poslal do prázdna. Preto sa odkazom stane len to, čo poznáme;
 * zvyšok zostane obyčajným textom.
 */
const ZNAME_CESTY = [
  "/events",
  "/account",
  "/contact",
  "/support",
  "/onboarding",
  "/partners",
  "/artists",
  "/login",
  "/register",
  "/p/",
];

function jeZnama(cesta: string): boolean {
  return ZNAME_CESTY.some((z) => cesta === z || cesta.startsWith(z.endsWith("/") ? z : `${z}/`));
}

/** `[názov](/cesta)` aj holé `/cesta`. Nič iné sa za odkaz nepovažuje. */
export function rozdelOdkazy(text: string): Cast[] {
  const vzor = /\[([^\]]{1,80})\]\((\/[\w\-/$.]*)\)|(^|[\s(])(\/[a-z][\w-]*(?:\/[\w\-$.]+)*)/gi;
  const casti: Cast[] = [];
  let koniecPredchadzajucej = 0;

  for (const zhoda of text.matchAll(vzor)) {
    const index = zhoda.index ?? 0;
    const [cela, popis, cestaVZatvorke, predel, holaCesta] = zhoda;
    const cesta = cestaVZatvorke ?? holaCesta;
    if (!cesta) continue;

    const zaciatok = index + (cestaVZatvorke ? 0 : (predel ?? "").length);
    if (zaciatok > koniecPredchadzajucej) {
      casti.push({ text: text.slice(koniecPredchadzajucej, zaciatok) });
    }
    // Neznáma cesta zostane textom — radšej nič, než odkaz do prázdna.
    casti.push(jeZnama(cesta) ? { text: popis ?? cesta, cesta } : { text: popis ?? cesta });
    koniecPredchadzajucej = index + cela.length;
  }

  if (koniecPredchadzajucej < text.length) casti.push({ text: text.slice(koniecPredchadzajucej) });
  return casti.length ? casti : [{ text }];
}
