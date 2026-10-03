// Rozpoznanie organizátora z adresy, na ktorú prišla požiadavka.
//
// `bbd.eticketo.eu` má ukázať ten istý obchod, len zúžený na podujatia jedného
// organizátora. Appka dosiaľ o hlavičke `Host` nevedela nič — mala jedno
// `PUBLIC_SITE_URL` — takže toto je jediné miesto, kde sa adresa prekladá na
// organizátora, a používa sa raz, v koreni stránky.
//
// POZOR na platby a e-maily: odkazy, ktoré opúšťajú server (návrat z brány,
// notifikácia, odkaz na vstupenky), sa aj naďalej skladajú z `PUBLIC_SITE_URL`,
// teda z hlavnej adresy. Je to zámer — brány majú návratovú adresu
// zaregistrovanú a wildcard by im nesedel. Zákazník teda kúpi na subdoméne
// a vráti sa na hlavnú adresu.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { siteUrl } from "./site-url.server";
import { subdomenaZHosta } from "./subdomena";

export type KontextSubdomeny = {
  /** `null` = hlavná adresa, obchod sa nefiltruje. */
  subdomena: string | null;
  organizer_id: string | null;
  nazov: string | null;
  /** Subdoména v adrese bola, ale nepatrí žiadnemu organizátorovi. */
  neznama: boolean;
};

const PRAZDNY: KontextSubdomeny = {
  subdomena: null,
  organizer_id: null,
  nazov: null,
  neznama: false,
};

/** Hostiteľ z požiadavky; `x-forwarded-host` má prednosť, pred appkou stojí nginx. */
function hostZPoziadavky(): string | null {
  const request = getRequest();
  if (!request?.headers) return null;
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

export async function kontextZHosta(host: string | null): Promise<KontextSubdomeny> {
  const subdomena = subdomenaZHosta(host, siteUrl());
  if (!subdomena) return PRAZDNY;

  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, company_name")
    .ilike("subdomain", subdomena)
    .maybeSingle();

  if (!data) return { subdomena, organizer_id: null, nazov: null, neznama: true };

  return {
    subdomena,
    organizer_id: data.id,
    nazov: data.company_name || data.full_name || null,
    neznama: false,
  };
}

/**
 * Kontext pre prehliadač. Volá sa raz v koreni stránky; výsledok si stránky
 * podujatí pridajú do dopytu ako `organizer_id`.
 */
export const getSubdomainContext = createServerFn({ method: "GET" }).handler(
  async (): Promise<KontextSubdomeny> => kontextZHosta(hostZPoziadavky()),
);
