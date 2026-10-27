// Načítanie podujatí pre feedy portálov.
//
// Ukazuje presne to, čo verejný katalóg: zverejnené podujatia a ich termíny
// v predaji, od dneška dopredu. Zámerne nie vlastný filter — keby feed
// ukazoval viac než web, portál by posielal ľudí na stránky, ktoré neexistujú;
// keby menej, organizátor by nechápal, prečo mu podujatie na portáli chýba.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TerminFeed } from "./feed";

/** Koľko termínov sa vydá naraz. Portály čítajú celý zoznam, nie po stránkach. */
const STROP = 500;

export async function terminyNaExport(limit = STROP): Promise<TerminFeed[]> {
  const dnes = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from("events")
    .select(
      "id, title, description, image_url, venue, address, city, category, base_price, status, v_exporte, event_dates(event_date, event_time, status), ticket_types(price)",
    )
    .eq("status", "published")
    // Skúšobné podujatia a darčekové poukazy na webe byť musia, na cudzom
    // kultúrnom portáli nie. Poukaz má vymyslený dátum (31. 12. o 22:00),
    // takže by sa v cudzom kalendári ukázal ako silvestrovský koncert.
    .eq("v_exporte", true)
    .limit(200);
  if (error) throw new Error(error.message);

  const terminy: TerminFeed[] = [];
  for (const e of data || []) {
    const typy = (e.ticket_types as Array<{ price: number | null }> | null) || [];
    // Cena „od" je najnižšia cena typu vstupenky; keď typy nie sú, základná
    // cena podujatia. Nula znamená, že cena nie je určená — vtedy sa
    // v popise nespomenie vôbec, lepšie nič než „od 0 €".
    const ceny = typy.map((t) => Number(t.price)).filter((c) => Number.isFinite(c) && c > 0);
    const zaklad = Number(e.base_price ?? 0);
    const cenaOd = ceny.length ? Math.min(...ceny) : zaklad > 0 ? zaklad : null;

    const datumy =
      (e.event_dates as Array<{
        event_date: string;
        event_time: string | null;
        status: string | null;
      }> | null) || [];

    for (const d of datumy) {
      if (d.status !== "on_sale") continue;
      if (d.event_date < dnes) continue;
      terminy.push({
        podujatieId: e.id,
        nazov: e.title,
        popis: e.description,
        obrazok: e.image_url,
        miesto: e.venue,
        adresa: e.address,
        mesto: e.city,
        kategoria: e.category,
        cenaOd,
        datum: d.event_date,
        cas: d.event_time,
      });
    }
  }

  // Najbližšie termíny ako prvé — tak to portál aj čítačka zobrazí.
  terminy.sort((a, b) => `${a.datum}T${a.cas ?? ""}`.localeCompare(`${b.datum}T${b.cas ?? ""}`));
  return terminy.slice(0, limit);
}
