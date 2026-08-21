// Upratovanie obrázkov podujatí v Supabase Storage.
//
// Nahrávanie dáva každému súboru náhodné meno, takže výmena obrázka starý súbor
// neprepíše — ostal by v úložisku navždy a nikto by o ňom nevedel. Rovnako pri
// zmazaní podujatia.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const EVENT_IMAGES_BUCKET = "event-images";

const MARKER = `/storage/v1/object/public/${EVENT_IMAGES_BUCKET}/`;

/**
 * Cesta súboru v našom buckete, ak URL ukazuje doň. Pri odkaze na cudzí web
 * vráti `null` — taký obrázok nám nepatrí a mazať ho nesmieme.
 */
export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf(MARKER);
  if (i === -1) return null;
  // Podpis ani `?t=` do cesty nepatria.
  const cesta = url.slice(i + MARKER.length).split(/[?#]/)[0];
  if (!cesta) return null;
  try {
    return decodeURIComponent(cesta);
  } catch {
    // Pokazené percentové kódovanie — radšej nič nezmažeme.
    return null;
  }
}

/**
 * Zmaže obrázok, ak je náš a už ho žiadne podujatie nepoužíva.
 *
 * Volaj až PO zápise podujatia — kontrola sa pozerá na aktuálny stav tabuľky.
 * Zlyhanie mazania sa len zaloguje: osirený súbor je nepríjemnosť, ale
 * neuložené podujatie je chyba, ktorú vidí organizátor.
 */
export async function deleteEventImageIfUnused(url: string | null | undefined): Promise<void> {
  const cesta = storagePathFromUrl(url);
  if (!cesta) return;
  try {
    const { data: stale } = await supabaseAdmin
      .from("events")
      .select("id")
      .eq("image_url", url as string)
      .limit(1);
    if (stale && stale.length > 0) return; // ešte ho niekto používa
    const { error } = await supabaseAdmin.storage.from(EVENT_IMAGES_BUCKET).remove([cesta]);
    if (error) console.error("Starý obrázok podujatia sa nepodarilo zmazať:", cesta, error.message);
  } catch (e) {
    console.error("Upratovanie obrázka podujatia zlyhalo:", cesta, e);
  }
}
