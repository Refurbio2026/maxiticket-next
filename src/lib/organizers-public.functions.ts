// Verejná stránka organizátora na /o/<subdomain>.
//
// Číta z pohľadu `public_organizers`, nie z `profiles`: tá tabuľka nesie IBAN
// na výplatu a dohodnutú províziu, a tie sa na verejnú stránku nesmú dostať
// ani omylom pri doplnení stĺpca. Pohľad zároveň sám filtruje na schválených
// organizátorov, ktorí súhlasili so zobrazením — neschválený účet je tu
// neviditeľný rovnako ako nepublikovaná stránka v `site_pages`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cachuj } from "./cache.server";

export type PublicOrganizer = {
  id: string;
  subdomain: string;
  display_name: string;
  company_name: string | null;
  ico: string | null;
  bio: string | null;
  logo_url: string | null;
  cover_url: string | null;
  website: string | null;
  city: string | null;
  cancellation_policy: string | null;
  complaint_contact: string | null;
};

export type PublicOrganizerEvent = {
  id: string;
  title: string;
  category: string;
  event_date: string;
  event_time: string;
  venue: string;
  city: string;
  image_url: string | null;
  base_price: number | null;
};

export type PublicOrganizerPage = {
  organizer: PublicOrganizer;
  links: { platform: string; url: string }[];
  upcoming: PublicOrganizerEvent[];
  past_count: number;
};

async function nacitaj(subdomena: string): Promise<PublicOrganizerPage | null> {
  const { data: org } = await supabaseAdmin
    .from("public_organizers")
    // Jediný reťazec, nie spojenie `+` — inak supabase-js neodvodí tvar riadku.
    .select(
      "id, subdomain, display_name, company_name, ico, bio, logo_url, cover_url, website, city, cancellation_policy, complaint_contact",
    )
    .ilike("subdomain", subdomena)
    .maybeSingle();
  if (!org || !org.id || !org.subdomain) return null;

  const dnes = new Date().toISOString().slice(0, 10);
  const [{ data: links }, { data: buduce }, { count: minule }] = await Promise.all([
    supabaseAdmin
      .from("organizer_links")
      .select("platform, url")
      .eq("organizer_id", org.id)
      .order("sort_order", { ascending: true }),
    supabaseAdmin
      .from("events")
      .select("id, title, category, event_date, event_time, venue, city, image_url, base_price")
      .eq("organizer_id", org.id)
      .eq("status", "published")
      .gte("event_date", dnes)
      .order("event_date", { ascending: true })
      .limit(60),
    supabaseAdmin
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("organizer_id", org.id)
      .eq("status", "published")
      .lt("event_date", dnes),
  ]);

  return {
    organizer: {
      ...org,
      id: org.id,
      subdomain: org.subdomain,
      display_name: org.display_name ?? org.subdomain,
    },
    links: (links || []).map((l) => ({ platform: l.platform, url: l.url })),
    upcoming: (buduce || []).map((e) => ({
      ...e,
      base_price: e.base_price === null ? null : Number(e.base_price),
    })),
    past_count: minule ?? 0,
  };
}

/** Verejný profil organizátora aj s jeho najbližšími podujatiami. */
export const getPublicOrganizer = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ subdomena: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data }): Promise<PublicOrganizerPage | null> => {
    const subdomena = data.subdomena.trim().toLowerCase();
    // Rovnaká pamäť ako u podujatia: pri spustení predaja sedí na stránke
    // organizátora celý jeho e-mailový zoznam naraz.
    return cachuj(`organizator:${subdomena}`, 30_000, () => nacitaj(subdomena));
  });
