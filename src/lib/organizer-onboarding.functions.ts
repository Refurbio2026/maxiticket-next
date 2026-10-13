// Sprievodca registráciou organizátora: vlastný profil, sociálne siete
// a odoslanie žiadosti o schválenie účtu.
//
// Prečo to ide cez server a nie priamo z prehliadača: `profiles` nesie aj
// dohodnutú províziu a stav schválenia. Migrácia `20261002100000` odobrala
// prihlásenému používateľovi právo zápisu do tých stĺpcov, takže by ho
// databáza odmietla aj tak — ale tu sa k nim nedostane ani omylom, pretože
// zápis skladá server z presne vymenovaných polí.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { zabudni } from "./cache.server";
import { siteUrl } from "./site-url.server";
import {
  KROK_HOTOVO,
  LINK_PLATFORM_KEYS,
  TERMS_VERSION,
  chybaNaZiadost,
  chybaPredPredajom,
  platnyIban,
  type Nedostatok,
  type OrganizerStatus,
} from "./organizer-profile";
import { chybaSubdomeny } from "./subdomena";

// Stĺpce, ktoré organizátor o sebe vidí. `commission_rate` medzi nimi nie je.
// Jediný reťazec zámerne: zo spojenia `+` TypeScript stratí literálový typ
// a supabase-js potom neodvodí tvar riadku.
const PROFIL_STLPCE =
  "display_name, subdomain, bio, logo_url, cover_url, website, city, company_name, ico, dic, ic_dph, vat_payer, billing_address, phone, payout_iban, payout_frequency, listed_in_catalog, cancellation_policy, complaint_contact, terms_accepted_at, terms_version, onboarding_step, onboarding_completed_at, organizer_status, organizer_requested_at, organizer_review_note";

type ProfilUpdate = Database["public"]["Tables"]["profiles"]["Update"] & { id: string };

export type OnboardingLink = { platform: string; url: string };

export type OnboardingProfile = {
  display_name: string | null;
  subdomain: string | null;
  bio: string | null;
  logo_url: string | null;
  cover_url: string | null;
  website: string | null;
  city: string | null;
  company_name: string | null;
  ico: string | null;
  dic: string | null;
  ic_dph: string | null;
  vat_payer: boolean;
  billing_address: string | null;
  phone: string | null;
  payout_iban: string | null;
  payout_frequency: string | null;
  listed_in_catalog: boolean;
  cancellation_policy: string | null;
  complaint_contact: string | null;
  terms_accepted_at: string | null;
  terms_version: string | null;
  onboarding_step: number;
  onboarding_completed_at: string | null;
  organizer_status: OrganizerStatus;
  organizer_requested_at: string | null;
  organizer_review_note: string | null;
};

export type OnboardingState = {
  email: string;
  profile: OnboardingProfile;
  links: OnboardingLink[];
  /** Rolu `organizer` prideľuje admin pri schválení — dovtedy je to `false`. */
  has_organizer_role: boolean;
  /** Čo chýba na odoslanie žiadosti. */
  missing_application: Nedostatok[];
  /** Čo chýba na spustenie predaja (žiadosť to neblokuje). */
  missing_sale: Nedostatok[];
  /** Verejná adresa profilu, keď je adresa nastavená. */
  public_url: string | null;
  terms_version: string;
};

const PRAZDNY: OnboardingProfile = {
  display_name: null,
  subdomain: null,
  bio: null,
  logo_url: null,
  cover_url: null,
  website: null,
  city: null,
  company_name: null,
  ico: null,
  dic: null,
  ic_dph: null,
  vat_payer: false,
  billing_address: null,
  phone: null,
  payout_iban: null,
  payout_frequency: null,
  listed_in_catalog: true,
  cancellation_policy: null,
  complaint_contact: null,
  terms_accepted_at: null,
  terms_version: null,
  onboarding_step: 0,
  onboarding_completed_at: null,
  organizer_status: "none",
  organizer_requested_at: null,
  organizer_review_note: null,
};

async function citajProfil(userId: string): Promise<OnboardingProfile> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select(PROFIL_STLPCE)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return PRAZDNY;
  return {
    ...PRAZDNY,
    ...data,
    organizer_status: data.organizer_status as OrganizerStatus,
  } as OnboardingProfile;
}

async function citajOdkazy(userId: string): Promise<OnboardingLink[]> {
  const { data } = await supabaseAdmin
    .from("organizer_links")
    .select("platform, url")
    .eq("organizer_id", userId)
    .order("sort_order", { ascending: true });
  return (data || []).map((r) => ({ platform: r.platform, url: r.url }));
}

/**
 * Má túto adresu už niekto iný? Tvar a rezervované názvy stráži `subdomena.ts`,
 * tu ide len o obsadenosť.
 *
 * Zámerne vlastný dopyt a nie import z `organizers.functions.ts`: moduly
 * `.functions.ts` sa navzájom neimportujú, aby sa serverový kód nedostal do
 * klientskeho balíka cez import v komponente.
 */
async function maAdresuNiektoIny(subdomena: string, okremId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("subdomain", subdomena)
    .neq("id", okremId)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function maRolu(userId: string, role: "organizer" | "admin"): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", role)
    .maybeSingle();
  return !!data;
}

function verejnaAdresaProfilu(subdomena: string | null): string | null {
  return subdomena ? `${siteUrl().replace(/\/$/, "")}/o/${subdomena}` : null;
}

/** Stav sprievodcu pre prihláseného používateľa. */
export const getMyOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingState> => {
    const [profile, links, organizer] = await Promise.all([
      citajProfil(context.userId),
      citajOdkazy(context.userId),
      maRolu(context.userId, "organizer"),
    ]);
    const email = (context.claims as { email?: string } | undefined)?.email ?? "";
    return {
      email,
      profile,
      links,
      has_organizer_role: organizer,
      missing_application: chybaNaZiadost(profile),
      missing_sale: chybaPredPredajom(profile),
      public_url: verejnaAdresaProfilu(profile.subdomain),
      terms_version: TERMS_VERSION,
    };
  });

// Voľnosť adresy overuje `checkSubdomain` v `organizers.functions.ts` — tá istá
// funkcia, akú používa asistent v admine. Dve kontroly tej istej veci by sa
// rozišli.

const nepovinnyText = (max: number) => z.string().max(max).optional().nullable();

const OnboardingInput = z.object({
  /** Dokiaľ sa sprievodca dostal; uloží sa len posun vpred. */
  step: z.number().int().min(0).max(99).optional(),
  display_name: nepovinnyText(200),
  subdomain: nepovinnyText(80),
  bio: nepovinnyText(2000),
  logo_url: nepovinnyText(2000),
  cover_url: nepovinnyText(2000),
  website: nepovinnyText(500),
  city: nepovinnyText(200),
  company_name: nepovinnyText(300),
  ico: nepovinnyText(20),
  dic: nepovinnyText(20),
  ic_dph: nepovinnyText(20),
  vat_payer: z.boolean().optional(),
  billing_address: nepovinnyText(400),
  phone: nepovinnyText(50),
  payout_iban: nepovinnyText(60),
  payout_frequency: z.enum(["per_event", "monthly"]).optional().nullable(),
  listed_in_catalog: z.boolean().optional(),
  cancellation_policy: nepovinnyText(5000),
  complaint_contact: nepovinnyText(300),
  /** Odklik VOP. Odvolať súhlas sa tu nedá — to je vec zrušenia účtu. */
  accept_terms: z.boolean().optional(),
  links: z
    .array(
      z.object({
        platform: z.enum(LINK_PLATFORM_KEYS as [string, ...string[]]),
        url: z.string().max(500),
      }),
    )
    .max(LINK_PLATFORM_KEYS.length)
    .optional(),
});

export type OnboardingInputData = z.input<typeof OnboardingInput>;

/** Prázdny text je NULL; `undefined` znamená „pole sa teraz nemení". */
const ocisti = (v: string | null | undefined): string | null | undefined => {
  if (v === undefined) return undefined;
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Uloží rozpracovaný sprievodca. Posiela sa len to, čo sa na danom kroku mení;
 * `undefined` znamená „nechaj, ako bolo".
 */
export const saveOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => OnboardingInput.parse(input))
  .handler(async ({ data, context }): Promise<OnboardingState> => {
    const teraz = await citajProfil(context.userId);

    const row: ProfilUpdate = { id: context.userId, updated_at: new Date().toISOString() };

    if (data.display_name !== undefined) row.display_name = ocisti(data.display_name);
    if (data.bio !== undefined) row.bio = ocisti(data.bio);
    if (data.logo_url !== undefined) row.logo_url = ocisti(data.logo_url);
    if (data.cover_url !== undefined) row.cover_url = ocisti(data.cover_url);
    if (data.city !== undefined) row.city = ocisti(data.city);
    if (data.company_name !== undefined) row.company_name = ocisti(data.company_name);
    if (data.ico !== undefined) row.ico = ocisti(data.ico);
    if (data.dic !== undefined) row.dic = ocisti(data.dic);
    if (data.ic_dph !== undefined) row.ic_dph = ocisti(data.ic_dph);
    if (data.vat_payer !== undefined) row.vat_payer = data.vat_payer;
    if (data.billing_address !== undefined) row.billing_address = ocisti(data.billing_address);
    if (data.phone !== undefined) row.phone = ocisti(data.phone);
    if (data.payout_frequency !== undefined) row.payout_frequency = data.payout_frequency;
    if (data.listed_in_catalog !== undefined) row.listed_in_catalog = data.listed_in_catalog;
    if (data.cancellation_policy !== undefined) {
      row.cancellation_policy = ocisti(data.cancellation_policy);
    }
    if (data.complaint_contact !== undefined)
      row.complaint_contact = ocisti(data.complaint_contact);

    // Web si píše človek, takže „eticketo.eu" bez schémy je bežnejšie než odkaz.
    if (data.website !== undefined) {
      const web = ocisti(data.website);
      row.website = web ? (/^https?:\/\//i.test(web) ? web : `https://${web}`) : null;
    }

    if (data.subdomain !== undefined) {
      const subdomena = ocisti(data.subdomain)?.toLowerCase() ?? null;
      if (subdomena) {
        const format = chybaSubdomeny(subdomena);
        if (format) throw new Error(format);
        if (await maAdresuNiektoIny(subdomena, context.userId)) {
          throw new Error(`Adresu „${subdomena}" už používa iný organizátor.`);
        }
      }
      // Adresu raz zverejneného profilu nemeníme potichu — organizátor ju už
      // mohol rozposlať. Prepísať sa dá, ale nie vymazať.
      if (!subdomena && teraz.subdomain) {
        throw new Error("Adresu profilu sa nedá zmazať, len zmeniť na inú.");
      }
      row.subdomain = subdomena;
    }

    if (data.payout_iban !== undefined) {
      const iban = ocisti(data.payout_iban);
      if (iban && !platnyIban(iban)) {
        throw new Error("IBAN neprešiel kontrolou. Skontroluj, či si neprehodil číslice.");
      }
      row.payout_iban = iban ? iban.replace(/[\s-]/g, "").toUpperCase() : null;
    }

    if (data.accept_terms) {
      row.terms_accepted_at = new Date().toISOString();
      row.terms_version = TERMS_VERSION;
    }

    if (data.step !== undefined) {
      // Dozadu sa krok neposúva: keby organizátor otvoril sprievodcu znova
      // a preklikal prvý krok, nechceme mu zahodiť rozpracované kroky za ním.
      row.onboarding_step = Math.max(teraz.onboarding_step, data.step);
    }

    // Prvý zápis z prehliadača je zároveň prihlásenie sa k organizátorskému
    // účtu — bežný kupujúci sa takto dostane na začiatok sprievodcu.
    if (teraz.organizer_status === "none") row.organizer_status = "onboarding";

    const { error } = await supabaseAdmin.from("profiles").upsert(row, { onConflict: "id" });
    if (error) throw new Error(prelozChybu(error.message));

    if (data.links) {
      await ulozOdkazy(context.userId, data.links);
    }

    // Verejná stránka organizátora sa pol minúty pamätá.
    zabudni("organizator:");

    const profile = await citajProfil(context.userId);
    const [links, organizer] = await Promise.all([
      citajOdkazy(context.userId),
      maRolu(context.userId, "organizer"),
    ]);
    return {
      email: (context.claims as { email?: string } | undefined)?.email ?? "",
      profile,
      links,
      has_organizer_role: organizer,
      missing_application: chybaNaZiadost(profile),
      missing_sale: chybaPredPredajom(profile),
      public_url: verejnaAdresaProfilu(profile.subdomain),
      terms_version: TERMS_VERSION,
    };
  });

async function ulozOdkazy(userId: string, odkazy: { platform: string; url: string }[]) {
  const platne = odkazy
    .map((o) => ({ platform: o.platform, url: o.url.trim() }))
    .filter((o) => o.url !== "");

  for (const o of platne) {
    if (!/^https?:\/\//i.test(o.url)) {
      throw new Error(`Odkaz na ${o.platform} musí začínať https://`);
    }
  }

  // Platformy, ktoré organizátor vymazal, musia zmiznúť aj z databázy —
  // inak by sa na verejnej stránke držal starý profil navždy.
  const ponechane = platne.map((o) => o.platform);
  let mazanie = supabaseAdmin.from("organizer_links").delete().eq("organizer_id", userId);
  if (ponechane.length > 0) {
    mazanie = mazanie.not("platform", "in", `(${ponechane.join(",")})`);
  }
  const { error: chybaMazania } = await mazanie;
  if (chybaMazania) throw new Error(chybaMazania.message);

  if (platne.length === 0) return;

  const { error } = await supabaseAdmin.from("organizer_links").upsert(
    platne.map((o, i) => ({
      organizer_id: userId,
      platform: o.platform,
      url: o.url,
      sort_order: (i + 1) * 10,
    })),
    { onConflict: "organizer_id,platform" },
  );
  if (error) throw new Error(error.message);
}

function prelozChybu(sprava: string): string {
  if (sprava.includes("profiles_subdomain_unique")) {
    return "Adresu už používa iný organizátor.";
  }
  if (sprava.includes("profiles_subdomain_rezervovane")) {
    return "Táto adresa je vyhradená, zvoľ inú.";
  }
  if (sprava.includes("profiles_subdomain_tvar")) {
    return "Adresa smie mať 3–32 znakov: malé písmená, číslice a spojovník.";
  }
  return sprava;
}

/** Odošle žiadosť adminovi. Z 'rejected' sa dá požiadať znova. */
export const submitOrganizerApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ status: OrganizerStatus }> => {
    const profil = await citajProfil(context.userId);

    if (profil.organizer_status === "approved") {
      return { status: "approved" };
    }
    if (profil.organizer_status === "pending") {
      return { status: "pending" };
    }
    if (profil.organizer_status === "suspended") {
      throw new Error("Účet je pozastavený. Ozvi sa prosím podpore.");
    }

    const chyby = chybaNaZiadost(profil);
    if (chyby.length > 0) {
      throw new Error(`Pred odoslaním doplň: ${chyby.map((c) => c.popis).join(", ")}.`);
    }

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        organizer_status: "pending",
        organizer_requested_at: new Date().toISOString(),
        onboarding_step: KROK_HOTOVO,
        onboarding_completed_at: new Date().toISOString(),
        // Starý dôvod zamietnutia po oprave už neplatí.
        organizer_review_note: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_log").insert({
      entity: "organizer",
      entity_id: context.userId,
      action: "ziadost_odoslana",
      actor: context.userId,
      after: { subdomain: profil.subdomain, company_name: profil.company_name },
    });

    return { status: "pending" };
  });
