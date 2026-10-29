// Meracie kódy pre verejný web.
//
// Bez prihlásenia zámerne: identifikátor GA4 či Meta Pixelu nie je tajomstvo,
// na stránke s nimi beží skript a prečíta ich každý, kto si otvorí zdroj.
// Vracia sa len to, čo prešlo kontrolou tvaru — zle vyplnené pole sa chová,
// akoby nebolo vyplnené vôbec.
import { createServerFn } from "@tanstack/react-start";
import { meraniaPreWeb } from "./nastavenia.server";

export const verejneMerania = createServerFn({ method: "GET" }).handler(async () => {
  const m = await meraniaPreWeb();
  return {
    gtm: m.gtm ?? null,
    ga4: m.ga4 ?? null,
    googleAds: m.googleAds ?? null,
    konverznaNavestie: m.konverznaNavestie ?? null,
    metaPixel: m.metaPixel ?? null,
  };
});
