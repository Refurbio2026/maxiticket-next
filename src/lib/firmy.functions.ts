// Vyhľadávanie firiem pre checkout.
//
// Volá sa to **bez prihlásenia** z verejného checkoutu, takže má brzdu. Je to
// ale len čítanie z verejných registrov a nič o našich zákazníkoch neprezrádza.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ipBucket } from "./client-ip.server";
import { pripravPristupy } from "./pristupy.server";
import { druhDotazu, platneIco, type Firma } from "./firmy/firmy";
import { hladajVRpo, overIcDph } from "./firmy/firmy.server";

export type VysledokHladania = {
  firmy: Firma[];
  /** Hláška pre zákazníka, keď sa nič nenašlo alebo register nejde. */
  sprava: string | null;
  /** Overenie IČ DPH, keď bolo zadané. */
  icDph: { platne: boolean; dostupne: boolean; nazov: string | null } | null;
};

async function limituj(bucket: string, limit: number, sekundy: number) {
  const { data: allowed, error } = await supabaseAdmin.rpc("hit_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: sekundy,
  });
  if (error) {
    // Výpadok počítadla nesmie zastaviť nákup — brzda je ochrana, nie kritická cesta.
    console.error("rate limit zlyhal", bucket, error.message);
    return;
  }
  if (allowed === false) throw new Error("Priveľa hľadaní. Skús to prosím o chvíľu.");
}

/**
 * Nájde firmu podľa IČO, IČ DPH alebo názvu.
 *
 * Nikdy nevyhodí chybu kvôli nedostupnému registru — zákazník má vždy môcť
 * údaje dopísať ručne, takže sa vracia prázdny zoznam a vysvetlenie.
 */
export const najdiFirmu = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ dotaz: z.string().trim().min(2).max(120) }).parse(input))
  .handler(async ({ data }): Promise<VysledokHladania> => {
    // Perimeter dnes zlieva IP, takže bez použiteľnej adresy spoločný strop.
    const kluc = ipBucket("firmy:ip:");
    await limituj(kluc ?? "firmy:spolocne", kluc ? 60 : 600, 3600);
    await pripravPristupy();

    const druh = druhDotazu(data.dotaz);

    // Preklep v IČO sa odhalí bez siete — register na to netreba.
    if (druh === "ico" && !platneIco(data.dotaz)) {
      return {
        firmy: [],
        sprava: "Toto IČO neprešlo kontrolou — skontroluj, či si neprehodil číslice.",
        icDph: null,
      };
    }

    const firmy = await hladajVRpo(data.dotaz);

    let icDph: VysledokHladania["icDph"] = null;
    if (druh === "ic_dph") {
      const o = await overIcDph(data.dotaz);
      icDph = { platne: o.platne, dostupne: o.dostupne, nazov: o.nazov };
      // VIES vie meno aj adresu; keď register nič nenašiel, aspoň toto.
      if (firmy.length === 0 && o.platne && o.nazov) {
        firmy.push({
          nazov: o.nazov,
          ico: "",
          dic: null,
          ic_dph: data.dotaz.toUpperCase().replace(/\s/g, ""),
          ulica: o.adresa ?? null,
          mesto: null,
          psc: null,
          stat: "SK",
          zdroj: "vies",
          registracia: null,
        });
      }
    }

    if (firmy.length > 0) return { firmy, sprava: null, icDph };

    return {
      firmy: [],
      sprava:
        druh === "nazov"
          ? "Pod týmto názvom sa nič nenašlo. Skús IČO alebo údaje vyplň ručne."
          : "Register teraz neodpovedá alebo firmu nepozná. Údaje môžeš vyplniť ručne.",
      icDph,
    };
  });
