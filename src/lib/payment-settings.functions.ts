// Prehľad a nastavenie platobných brán pre administráciu.
//
// BEZPEČNOSŤ: hodnoty prístupov sa odtiaľto **nikdy** nevracajú — ani adminovi.
// Stránka ukazuje len to, či je premenná vyplnená. Kľúče zostávajú v secrets;
// v databáze je iba to, čo sa smie prepínať (zapnutá / vypnutá brána
// a ktorá je predvolená).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  branaPodlaId,
  nacitajNastaveniaBran,
  pripravPristupy,
  vsetkyBrany,
} from "./payment-gateways/index.server";
import { ulozPristupy } from "./payment-gateways/pristupy.server";
import { rezimZAdresy, type PolozkaKonfiguracie } from "./payment-gateways/types";
import { siteUrl } from "./site-url.server";
import { errorMessage } from "./error-message";

const ID_BRANY = z.enum(["gopay", "gpwebpay", "tatrapayplus"]);

export type PrehladBrany = {
  id: string;
  label: string;
  hint: string;
  /** Má vyplnené všetky povinné prístupy. */
  nakonfigurovana: boolean;
  /** Prepínač v admine. */
  zapnuta: boolean;
  /** Naozaj sa ponúkne zákazníkovi (nakonfigurovaná aj zapnutá). */
  vPonuke: boolean;
  predvolena: boolean;
  endpoint: string;
  rezim: "test" | "ostrá" | "neznáma";
  konfiguracia: PolozkaKonfiguracie[];
  chybaju: string[];
  /** Adresa, ktorú treba brány zaregistrovať / nastaviť. */
  navratovaAdresa: string;
  /** `null` znamená, že brána server-to-server notifikáciu nemá. */
  notifikacnaAdresa: string | null;
  vieRefundovat: boolean;
  vieDopytStavu: boolean;
};

export type PrehladPlatobnychBran = {
  brany: PrehladBrany[];
  /** Základ všetkých návratových adries — bez neho nefunguje žiadna brána. */
  adresaWebu: string | null;
  adresaWebuChyba: string | null;
  predvolena: string | null;
  /** Predvolená brána z premennej prostredia; nastavenie v admine ju prebije. */
  predvolenaZPremennej: string | null;
  updated_at: string | null;
  /** Koľko objednávok čaká na doplatenie — dôvod, prečo treba cron. */
  cakajuceObjednavky: number;
};

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

/** Adresy sa dajú poskladať len vtedy, keď je nastavená adresa webu. */
function adresyBrany(id: string, origin: string | null) {
  if (!origin) return { navratovaAdresa: "", notifikacnaAdresa: null };
  if (id === "gpwebpay") {
    return {
      navratovaAdresa: `${origin}/api/public/payments/gpwebpay/return`,
      notifikacnaAdresa: null,
    };
  }
  if (id === "tatrapayplus") {
    return {
      navratovaAdresa: `${origin}/api/public/payments/tatrapayplus/return`,
      notifikacnaAdresa: null,
    };
  }
  return {
    navratovaAdresa: `${origin}/checkout/return`,
    notifikacnaAdresa: `${origin}/api/public/payments/gopay/webhook`,
  };
}

export const getPaymentGatewayOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PrehladPlatobnychBran> => {
    await assertAdmin(context.userId);
    await pripravPristupy();

    let adresaWebu: string | null = null;
    let adresaWebuChyba: string | null = null;
    try {
      adresaWebu = siteUrl();
    } catch (e) {
      adresaWebuChyba = errorMessage(e);
    }

    const nastavenia = await nacitajNastaveniaBran();
    const { count } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "awaiting_payment");

    const brany = vsetkyBrany().map((b): PrehladBrany => {
      const konfiguracia = b.konfiguracia();
      const chybaju = konfiguracia.filter((k) => k.povinna && !k.vyplnena).map((k) => k.premenna);
      const nakonfigurovana = b.isConfigured();
      const zapnuta = nastavenia.zapnute[b.id];
      const endpoint = b.endpoint();
      return {
        id: b.id,
        label: b.label,
        hint: b.hint,
        nakonfigurovana,
        zapnuta,
        vPonuke: nakonfigurovana && zapnuta,
        predvolena: false,
        endpoint,
        rezim: rezimZAdresy(endpoint),
        konfiguracia,
        chybaju,
        ...adresyBrany(b.id, adresaWebu),
        vieRefundovat: b.supportsRefund,
        // GP webpay stav dopytovať nevie — pre admina je to dôležité,
        // lebo z toho vyplýva potreba cronu.
        vieDopytStavu: b.id !== "gpwebpay",
      };
    });

    const vPonuke = brany.filter((b) => b.vPonuke);
    const zvolena = nastavenia.predvolena || process.env.PAYMENT_PROVIDER?.trim() || null;
    const predvolena = vPonuke.find((b) => b.id === zvolena)?.id ?? vPonuke[0]?.id ?? null;
    for (const b of brany) b.predvolena = b.id === predvolena;

    return {
      brany,
      adresaWebu,
      adresaWebuChyba,
      predvolena,
      predvolenaZPremennej: process.env.PAYMENT_PROVIDER?.trim() || null,
      updated_at: nastavenia.updated_at,
      cakajuceObjednavky: count ?? 0,
    };
  });

export const updatePaymentGatewaySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        gopay_enabled: z.boolean(),
        gpwebpay_enabled: z.boolean(),
        tatrapayplus_enabled: z.boolean(),
        default_provider: ID_BRANY.nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    await pripravPristupy();

    // Predvolená brána, ktorá je vypnutá alebo bez prístupov, by znamenala
    // checkout bez možnosti zaplatiť. Radšej to odmietneme hneď.
    if (data.default_provider) {
      const zapnuta = {
        gopay: data.gopay_enabled,
        gpwebpay: data.gpwebpay_enabled,
        tatrapayplus: data.tatrapayplus_enabled,
      }[data.default_provider];
      const brana = branaPodlaId(data.default_provider);
      if (!zapnuta) throw new Error(`${brana.label} nemôže byť predvolená, keď je vypnutá.`);
      if (!brana.isConfigured()) {
        throw new Error(`${brana.label} nemá vyplnené prístupy, nedá sa nastaviť ako predvolená.`);
      }
    }

    const { error } = await supabaseAdmin
      .from("payment_settings")
      .update({
        gopay_enabled: data.gopay_enabled,
        gpwebpay_enabled: data.gpwebpay_enabled,
        tatrapayplus_enabled: data.tatrapayplus_enabled,
        default_provider: data.default_provider,
        updated_by: context.userId,
      })
      .eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testPaymentGateway = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ provider: ID_BRANY }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; detail: string }> => {
    await assertAdmin(context.userId);
    await pripravPristupy();
    const brana = branaPodlaId(data.provider);
    if (!brana.isConfigured()) {
      return { ok: false, detail: "Brána nemá vyplnené všetky povinné prístupy." };
    }
    try {
      return await brana.test();
    } catch (e) {
      return { ok: false, detail: errorMessage(e) };
    }
  });

/**
 * Uloží prístupy k jednej bráne.
 *
 * Hodnota `null` znamená zmazať — brána sa vtedy vráti k tomu, čo je
 * prípadne v prostredí. Kľúč, ktorý v požiadavke nie je, sa nemení; vďaka
 * tomu sa dá formulár odoslať bez toho, aby doň bolo treba znovu opisovať
 * heslá, ktoré sa v ňom aj tak nezobrazujú.
 *
 * Odpoveď zámerne neobsahuje uložené hodnoty.
 */
export const savePaymentCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        provider: ID_BRANY,
        // Hodnoty môžu byť dlhé — PEM kľúč má aj pár tisíc znakov.
        values: z.record(z.string(), z.string().max(20000).nullable()),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; ulozene: string[] }> => {
    await assertAdmin(context.userId);
    await pripravPristupy();

    const brana = branaPodlaId(data.provider);
    // Prijmeme len kľúče, o ktorých brána naozaj vie. Inak by sa do tabuľky
    // dalo napchať čokoľvek.
    const povolene = new Set(brana.konfiguracia().map((k) => k.premenna));
    const zmeny: Record<string, string | null> = {};
    for (const [kluc, v] of Object.entries(data.values)) {
      if (!povolene.has(kluc)) throw new Error(`Brána ${brana.label} nepozná pole '${kluc}'.`);
      zmeny[kluc] = v;
    }

    await ulozPristupy(data.provider, zmeny, context.userId);
    return { ok: true, ulozene: Object.keys(zmeny) };
  });
