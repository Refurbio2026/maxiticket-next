// Verejná stránka série (turné).
//
// Vracia sériu podľa slugu a jej predstavenia v poradí, v akom sa hrajú —
// každé s miestom, mestom, časom a cenou, aby si kupujúci vybral mesto
// a klikol priamo na to svoje. Tak to robí aj Ticketportal; u nás je každé
// predstavenie vlastné podujatie, lebo `event_dates` nemá miesto.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PredstavenieSerie = {
  event_id: string;
  title: string;
  /** Dátum predstavenia — termín v predaji, inak dátum podujatia. */
  datum: string;
  cas: string | null;
  venue: string;
  city: string;
  cenaOd: number | null;
  /** Je na tomto predstavení otvorený predaj? */
  vPredaji: boolean;
};

export type SerieDetail = {
  id: string;
  slug: string;
  nazov: string;
  popis: string | null;
  obrazok: string | null;
  kategoria: string | null;
  predstavenia: PredstavenieSerie[];
};

export const serieBySlug = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ slug: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }): Promise<SerieDetail | null> => {
    const { data: skupina, error } = await supabaseAdmin
      .from("event_groups")
      .select("id, name, slug, description, image_url, active")
      .eq("slug", data.slug)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // Vypnutá séria sa verejne nezobrazuje — rovnako ako nezverejnené podujatie.
    if (!skupina || !skupina.active) return null;

    const { data: podujatia, error: chyba } = await supabaseAdmin
      .from("events")
      .select(
        "id, title, category, venue, city, event_date, event_time, base_price, status, event_dates(event_date, event_time, status), ticket_types(price)",
      )
      .eq("group_id", skupina.id)
      .eq("status", "published");
    if (chyba) throw new Error(chyba.message);

    const dnes = new Date().toISOString().slice(0, 10);
    const predstavenia: PredstavenieSerie[] = (podujatia || []).map((e) => {
      const terminy = (
        (e.event_dates as Array<{
          event_date: string;
          event_time: string | null;
          status: string | null;
        }> | null) || []
      )
        .filter((d) => d.status === "on_sale" && d.event_date >= dnes)
        .sort((a, b) => a.event_date.localeCompare(b.event_date));

      const typy = (e.ticket_types as Array<{ price: number | null }> | null) || [];
      const ceny = typy.map((t) => Number(t.price)).filter((c) => Number.isFinite(c) && c > 0);
      const zaklad = Number(e.base_price ?? 0);

      return {
        event_id: e.id,
        title: e.title,
        datum: terminy[0]?.event_date ?? e.event_date,
        cas: terminy[0]?.event_time ?? e.event_time,
        venue: e.venue,
        city: e.city,
        cenaOd: ceny.length ? Math.min(...ceny) : zaklad > 0 ? zaklad : null,
        vPredaji: terminy.length > 0,
      };
    });

    // Chronologicky. Predstavenia bez otvoreného predaja zostávajú v zozname —
    // kupujúci má vidieť celé turné, len bez tlačidla Kúpiť.
    predstavenia.sort((a, b) =>
      `${a.datum}T${a.cas ?? ""}`.localeCompare(`${b.datum}T${b.cas ?? ""}`),
    );

    return {
      id: skupina.id,
      slug: skupina.slug,
      nazov: skupina.name,
      popis: skupina.description,
      obrazok: skupina.image_url,
      kategoria: (podujatia || [])[0]?.category ?? null,
      predstavenia,
    };
  });
