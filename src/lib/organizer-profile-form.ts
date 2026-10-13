// Stav formulára organizátorského profilu a jeho prevod na vstup servera.
//
// Oddelené od `ProfileSteps.tsx` zámerne: ten súbor exportuje komponenty a
// miešať do toho čisté funkcie znefunkční rýchle prekreslenie pri vývoji.
import { formatujIban } from "./organizer-profile";
import type { OnboardingState } from "./organizer-onboarding.functions";

export type ProfileForm = {
  display_name: string;
  subdomain: string;
  bio: string;
  logo_url: string;
  cover_url: string;
  website: string;
  city: string;
  company_name: string;
  ico: string;
  dic: string;
  ic_dph: string;
  vat_payer: boolean;
  billing_address: string;
  phone: string;
  payout_iban: string;
  payout_frequency: "" | "per_event" | "monthly";
  listed_in_catalog: boolean;
  cancellation_policy: string;
  complaint_contact: string;
  accept_terms: boolean;
  links: Record<string, string>;
};

export const prazdnyForm: ProfileForm = {
  display_name: "",
  subdomain: "",
  bio: "",
  logo_url: "",
  cover_url: "",
  website: "",
  city: "",
  company_name: "",
  ico: "",
  dic: "",
  ic_dph: "",
  vat_payer: false,
  billing_address: "",
  phone: "",
  payout_iban: "",
  payout_frequency: "",
  listed_in_catalog: true,
  cancellation_policy: "",
  complaint_contact: "",
  accept_terms: false,
  links: {},
};

export function formZoStavu(stav: OnboardingState): ProfileForm {
  const p = stav.profile;
  const links: Record<string, string> = {};
  for (const l of stav.links) links[l.platform] = l.url;
  return {
    display_name: p.display_name ?? "",
    subdomain: p.subdomain ?? "",
    bio: p.bio ?? "",
    logo_url: p.logo_url ?? "",
    cover_url: p.cover_url ?? "",
    website: p.website ?? "",
    city: p.city ?? "",
    company_name: p.company_name ?? "",
    ico: p.ico ?? "",
    dic: p.dic ?? "",
    ic_dph: p.ic_dph ?? "",
    vat_payer: p.vat_payer,
    billing_address: p.billing_address ?? "",
    phone: p.phone ?? "",
    payout_iban: p.payout_iban ? formatujIban(p.payout_iban) : "",
    payout_frequency: (p.payout_frequency as ProfileForm["payout_frequency"]) || "",
    listed_in_catalog: p.listed_in_catalog,
    cancellation_policy: p.cancellation_policy ?? "",
    complaint_contact: p.complaint_contact ?? "",
    // Už odklikaný súhlas sa znova nepýta.
    accept_terms: !!p.terms_accepted_at,
    links,
  };
}

/**
 * Formulár na vstup servera. `uz_odklikane` zabráni tomu, aby sa pri každom
 * uložení prepisoval čas súhlasu s podmienkami.
 */
export function vstupZFormu(form: ProfileForm, uzOdklikane: boolean, step?: number) {
  return {
    step,
    display_name: form.display_name,
    subdomain: form.subdomain.trim().toLowerCase() || null,
    bio: form.bio,
    logo_url: form.logo_url,
    cover_url: form.cover_url,
    website: form.website,
    city: form.city,
    company_name: form.company_name,
    ico: form.ico,
    dic: form.dic,
    ic_dph: form.ic_dph,
    vat_payer: form.vat_payer,
    billing_address: form.billing_address,
    phone: form.phone,
    payout_iban: form.payout_iban,
    payout_frequency: form.payout_frequency === "" ? null : form.payout_frequency,
    listed_in_catalog: form.listed_in_catalog,
    cancellation_policy: form.cancellation_policy,
    complaint_contact: form.complaint_contact,
    accept_terms: form.accept_terms && !uzOdklikane,
    links: Object.entries(form.links)
      .filter(([, url]) => url.trim() !== "")
      .map(([platform, url]) => ({ platform, url: url.trim() })),
  };
}
