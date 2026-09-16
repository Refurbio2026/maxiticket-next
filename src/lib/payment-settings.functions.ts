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
import { ulozPristupy } from "./pristupy.server";
import { rezimZAdresy, type PolozkaKonfiguracie } from "./payment-gateways/types";
import { systemPodlaId, vsetkyFakturacneSystemy } from "./invoicing/index.server";
import { siteUrl } from "./site-url.server";
import { errorMessage } from "./error-message";
import { jePovolenaSadzba, predvolenaSadzba, zabudniSadzbu } from "./dph.server";

const ID_BRANY = z.enum(["gopay", "gpwebpay", "tatrapayplus"]);
const ID_FAKTURACIE = z.enum(["superfaktura", "faktero"]);
const ID_SYSTEMU = z.union([ID_BRANY, ID_FAKTURACIE]);

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

export type PrehladFakturacie = {
  id: string;
  label: string;
  hint: string;
  nakonfigurovana: boolean;
  pouziva: boolean;
  endpoint: string;
  rezim: "test" | "ostrá" | "neznáma";
  konfiguracia: PolozkaKonfiguracie[];
  chybaju: string[];
};

export type PrehladPlatobnychBran = {
  brany: PrehladBrany[];
  fakturacia: PrehladFakturacie[];
  /** Systém, ktorý práve vystavuje faktúry. */
  fakturacnySystem: string | null;
  /** Predvolená sadzba DPH v percentách. */
  sadzbaDph: number;
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

function jeFakturacia(id: string): boolean {
  return id === "superfaktura" || id === "faktero";
}

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

    const { data: nastavenieFakturacie } = await supabaseAdmin
      .from("payment_settings")
      .select("invoice_provider")
      .eq("id", true)
      .maybeSingle();
    const zvolenaFakturacia =
      nastavenieFakturacie?.invoice_provider || process.env.INVOICE_PROVIDER?.trim() || null;

    const fakturacia = vsetkyFakturacneSystemy().map((f): PrehladFakturacie => {
      const konfiguracia = f.konfiguracia();
      const endpoint = f.endpoint();
      return {
        id: f.id,
        label: f.label,
        hint: f.hint,
        nakonfigurovana: f.isConfigured(),
        pouziva: false,
        endpoint,
        // Faktero rozlišuje režim prefixom kľúča, nie adresou.
        rezim: f.rezim(),
        konfiguracia,
        chybaju: konfiguracia.filter((k) => k.povinna && !k.vyplnena).map((k) => k.premenna),
      };
    });
    const pouzivaSa =
      fakturacia.find((f) => f.id === zvolenaFakturacia && f.nakonfigurovana)?.id ??
      fakturacia.find((f) => f.nakonfigurovana)?.id ??
      null;
    for (const f of fakturacia) f.pouziva = f.id === pouzivaSa;

    const vPonuke = brany.filter((b) => b.vPonuke);
    const zvolena = nastavenia.predvolena || process.env.PAYMENT_PROVIDER?.trim() || null;
    const predvolena = vPonuke.find((b) => b.id === zvolena)?.id ?? vPonuke[0]?.id ?? null;
    for (const b of brany) b.predvolena = b.id === predvolena;

    return {
      brany,
      fakturacia,
      fakturacnySystem: pouzivaSa,
      sadzbaDph: await predvolenaSadzba(),
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
        invoice_provider: ID_FAKTURACIE.nullable(),
        default_vat_rate: z.number().nonnegative().max(100),
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

    if (!jePovolenaSadzba(data.default_vat_rate)) {
      throw new Error(`Sadzba ${data.default_vat_rate} % nie je platná sadzba DPH.`);
    }
    const { error: chybaDph } = await supabaseAdmin
      .from("platform_settings")
      .update({ default_vat_rate: data.default_vat_rate })
      .eq("id", true);
    if (chybaDph) throw new Error(chybaDph.message);
    zabudniSadzbu();

    const { error } = await supabaseAdmin
      .from("payment_settings")
      .update({
        gopay_enabled: data.gopay_enabled,
        gpwebpay_enabled: data.gpwebpay_enabled,
        tatrapayplus_enabled: data.tatrapayplus_enabled,
        default_provider: data.default_provider,
        invoice_provider: data.invoice_provider,
        updated_by: context.userId,
      })
      .eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testPaymentGateway = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ provider: ID_SYSTEMU }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; detail: string }> => {
    await assertAdmin(context.userId);
    await pripravPristupy();
    const brana = jeFakturacia(data.provider)
      ? systemPodlaId(data.provider)
      : branaPodlaId(data.provider);
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
        provider: ID_SYSTEMU,
        // Hodnoty môžu byť dlhé — PEM kľúč má aj pár tisíc znakov.
        values: z.record(z.string(), z.string().max(20000).nullable()),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; ulozene: string[] }> => {
    await assertAdmin(context.userId);
    await pripravPristupy();

    const brana = jeFakturacia(data.provider)
      ? systemPodlaId(data.provider)
      : branaPodlaId(data.provider);
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

// --- Platba prevodom na účet -------------------------------------------
// Nie je to brána, takže nemá prístupy ani test spojenia. Je to účet, na
// ktorý zákazník pošle peniaze, a lehota, dokedy to má stihnúť.

export type NastaveniePrevoduAdmin = {
  enabled: boolean;
  days_to_reminder: number;
  days_to_cancel: number;
  seated_allowed: boolean;
  iban: string | null;
  holder: string | null;
  bank_name: string | null;
};

export const getTransferSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NastaveniePrevoduAdmin> => {
    await assertAdmin(context.userId);
    const { data } = await supabaseAdmin
      .from("platform_settings")
      .select(
        "transfer_enabled, transfer_days_to_reminder, transfer_days_to_cancel, transfer_seated_allowed, transfer_iban, transfer_holder, transfer_bank_name",
      )
      .eq("id", true)
      .maybeSingle();
    return {
      enabled: Boolean(data?.transfer_enabled),
      days_to_reminder: data?.transfer_days_to_reminder ?? 2,
      days_to_cancel: data?.transfer_days_to_cancel ?? 2,
      seated_allowed: Boolean(data?.transfer_seated_allowed),
      iban: data?.transfer_iban ?? null,
      holder: data?.transfer_holder ?? null,
      bank_name: data?.transfer_bank_name ?? null,
    };
  });

export const updateTransferSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        enabled: z.boolean(),
        days_to_reminder: z.number().int().min(1).max(30),
        days_to_cancel: z.number().int().min(1).max(30),
        seated_allowed: z.boolean(),
        iban: z.string().max(50).optional().nullable(),
        holder: z.string().max(200).optional().nullable(),
        bank_name: z.string().max(200).optional().nullable(),
      })
      // Bez účtu nemá zákazník kam poslať peniaze a objednávka by len držala
      // sedadlá, kým nevyprší. Preto sa kanál bez IBAN-u nedá zapnúť.
      .refine((d) => !d.enabled || !!d.iban?.trim(), {
        message: "Platbu prevodom sa nedá zapnúť bez IBAN-u účtu.",
        path: ["iban"],
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("platform_settings")
      .update({
        transfer_enabled: data.enabled,
        transfer_days_to_reminder: data.days_to_reminder,
        transfer_days_to_cancel: data.days_to_cancel,
        transfer_seated_allowed: data.seated_allowed,
        transfer_iban: data.iban?.replace(/\s+/g, "").toUpperCase() || null,
        transfer_holder: data.holder?.trim() || null,
        transfer_bank_name: data.bank_name?.trim() || null,
      })
      .eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
