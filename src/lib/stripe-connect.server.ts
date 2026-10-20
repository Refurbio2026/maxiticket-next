// Stripe Connect — Express účty organizátorov.
//
// Načo to je: aby peniaze za vstupenky išli organizátorovi priamo z platby
// a nie prevodom od nás raz za obdobie. My si z každej platby vezmeme
// províziu (`application_fee_amount`) a zvyšok Stripe prevedie na jeho účet.
//
// Prečo Express a nie Standard: Express účet si organizátor založí za pár
// minút v Stripe formulári, overenie identity aj výplaty rieši Stripe a my
// nemusíme zbierať ani skladovať jeho doklady. Standard by vyžadoval, aby
// mal vlastný Stripe účet; Custom by naložil overovanie na nás.
//
// ČO SI DRŽÍME MY: len `stripe_account_id` a tri príznaky z `account.updated`
// (`charges_enabled`, `payouts_enabled`, `details_submitted`). Žiadne doklady,
// žiadne bankové údaje — tie zostávajú u Stripe.
//
// DÔLEŽITÉ: `stripe_account_id` ani príznaky si organizátor nesmie nastaviť
// sám (odobrané práva v migrácii) — inak by si vedel presmerovať výplaty.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { siteUrl } from "./site-url.server";
import { pripravPristupy } from "./pristupy.server";
import { chybaStripe, volajStripe } from "./payment-gateways/stripe.gateway.server";
import {
  postavAccountLink,
  postavExpressUcet,
  precitajUcet,
  type StavUctu,
} from "./payment-gateways/stripe-telo";

export type StavOrganizatora = {
  ucet: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  /** Čo Stripe ešte potrebuje. */
  chyba: string[];
  aktualizovane: string | null;
};

const PRAZDNY_STAV: StavOrganizatora = {
  ucet: null,
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: false,
  chyba: [],
  aktualizovane: null,
};

/** Čo o účte organizátora vieme z našej databázy — bez volania Stripe. */
export async function stavOrganizatora(organizerId: string): Promise<StavOrganizatora> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select(
      "stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_requirements, stripe_account_updated_at",
    )
    .eq("id", organizerId)
    .maybeSingle();

  if (error) {
    // Kým nie je prehraná migrácia, tieto stĺpce neexistujú. Stránka výplat
    // má v takom prípade povedať „nie je nastavené", nie spadnúť.
    console.error("Stav Stripe účtu sa nedá prečítať", error.message);
    return PRAZDNY_STAV;
  }

  const chyba = Array.isArray(data?.stripe_requirements)
    ? (data?.stripe_requirements as unknown[]).map((x) => String(x))
    : [];

  return {
    ucet: data?.stripe_account_id ?? null,
    charges_enabled: data?.stripe_charges_enabled === true,
    payouts_enabled: data?.stripe_payouts_enabled === true,
    details_submitted: data?.stripe_details_submitted === true,
    chyba,
    aktualizovane: data?.stripe_account_updated_at ?? null,
  };
}

/** Uloží stav účtu k organizátorovi. Jediné miesto, kde sa tieto stĺpce píšu. */
async function zapisStav(organizerId: string, ucet: string, stav: StavUctu): Promise<void> {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      stripe_account_id: ucet,
      stripe_charges_enabled: stav.charges_enabled,
      stripe_payouts_enabled: stav.payouts_enabled,
      stripe_details_submitted: stav.details_submitted,
      stripe_requirements: stav.chyba,
      stripe_account_updated_at: new Date().toISOString(),
    })
    .eq("id", organizerId);
  if (error) throw new Error(`Stav Stripe účtu sa nepodarilo uložiť: ${error.message}`);
}

/**
 * Založí Express účet, ak ho organizátor ešte nemá. Vráti jeho id.
 *
 * Idempotencia stojí na `stripe_account_id` v našej databáze: keď tam už
 * niečo je, nový účet sa nezakladá. Bez toho by každé kliknutie na „Nastaviť
 * výplaty" vyrobilo organizátorovi ďalší účet u Stripe.
 */
export async function zalozUcetAkTreba(organizerId: string): Promise<string> {
  await pripravPristupy();

  const { data: profil } = await supabaseAdmin
    .from("profiles")
    .select("stripe_account_id, display_name, company_name, website, organizer_status")
    .eq("id", organizerId)
    .maybeSingle();
  if (!profil) throw new Error("Organizátor sa nenašiel.");
  if (profil.stripe_account_id) return profil.stripe_account_id;

  // Výplaty nastavuje až schválený organizátor. Neschválený nemá čo predávať,
  // takže by to bol len účet u Stripe, ktorý nikto nepoužije.
  if (profil.organizer_status !== "approved") {
    throw new Error("Výplaty sa dajú nastaviť až po schválení organizátorského účtu.");
  }

  const { data: ucetUzivatela } = await supabaseAdmin.auth.admin.getUserById(organizerId);
  const email = ucetUzivatela?.user?.email ?? null;

  const o = await volajStripe("/v1/accounts", {
    telo: postavExpressUcet({
      email,
      nazov: profil.display_name || profil.company_name || null,
      web: profil.website || null,
      stat: "SK",
    }),
    // Keby odpoveď nedorazila a organizátor klikol znova, Stripe vráti ten
    // istý účet namiesto vytvorenia druhého.
    idempotency: `account:${organizerId}`,
  });
  if (o.status >= 300) throw new Error(chybaStripe(o));

  const ucet = typeof o.data.id === "string" ? o.data.id : "";
  if (!ucet) throw new Error("Stripe nevrátil id účtu.");

  await zapisStav(organizerId, ucet, precitajUcet(o.data));
  return ucet;
}

/**
 * Odkaz, ktorým organizátor dokončí registráciu u Stripe.
 *
 * Odkaz je jednorazový a krátko platný — preto sa nikam neukladá a generuje
 * sa pri každom kliknutí nanovo. `refresh_url` je adresa, na ktorú Stripe
 * pošle organizátora, keď odkaz vyprší; tam si vyžiada nový.
 */
export async function odkazNaOnboarding(organizerId: string): Promise<string> {
  const ucet = await zalozUcetAkTreba(organizerId);
  const zaklad = siteUrl().replace(/\/$/, "");

  const o = await volajStripe("/v1/account_links", {
    telo: postavAccountLink({
      ucet,
      obnovitUrl: `${zaklad}/organizer/payouts?obnovit=1`,
      navratUrl: `${zaklad}/organizer/payouts?hotovo=1`,
    }),
  });
  if (o.status >= 300) throw new Error(chybaStripe(o));

  const url = typeof o.data.url === "string" ? o.data.url : "";
  if (!url) throw new Error("Stripe nevrátil odkaz na registráciu.");
  return url;
}

/**
 * Dopýta sa Stripe na stav účtu a uloží ho.
 *
 * Používa sa po návrate z onboardingu (nečakáme na webhook, aby organizátor
 * videl výsledok hneď) a dá sa tým aj dobehnúť zmeškaný `account.updated`.
 */
export async function zosynchronizujUcet(organizerId: string): Promise<StavOrganizatora> {
  await pripravPristupy();
  const { data: profil } = await supabaseAdmin
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", organizerId)
    .maybeSingle();
  if (!profil?.stripe_account_id) return stavOrganizatora(organizerId);

  const o = await volajStripe(`/v1/accounts/${encodeURIComponent(profil.stripe_account_id)}`);
  if (o.status >= 300) throw new Error(chybaStripe(o));

  await zapisStav(organizerId, profil.stripe_account_id, precitajUcet(o.data));
  return stavOrganizatora(organizerId);
}

/**
 * Spracuje `account.updated` z webhooku.
 *
 * Telu veríme až po overení podpisu; organizátora hľadáme podľa id účtu,
 * nie podľa čohokoľvek z tela. Keď účet nepoznáme, notifikáciu zahodíme —
 * môže ísť o účet z iného prostredia (test oproti ostrému).
 */
export async function spracujAccountUpdated(ucet: unknown): Promise<{ zmenene: boolean }> {
  const u = (ucet ?? {}) as Record<string, unknown>;
  const id = typeof u.id === "string" ? u.id : "";
  if (!id) return { zmenene: false };

  const { data: profil } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("stripe_account_id", id)
    .maybeSingle();
  if (!profil?.id) return { zmenene: false };

  await zapisStav(profil.id, id, precitajUcet(u));
  return { zmenene: true };
}
