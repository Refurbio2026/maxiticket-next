// Sadzba DPH pre fakturáciu.
//
// Od 1. 1. 2025 je na Slovensku základná sadzba 23 %. Na vstupné ale neplatí
// jedna sadzba — príloha 7a zákona o DPH dáva 5 % na vstup na divadelné
// predstavenia, do múzeí a na športové podujatia, kým **hudobné koncerty
// zostávajú v základnej sadzbe**. Preto sa sadzba nedá odvodiť z kódu a musí
// sa dať nastaviť na podujatí.
//
// Zaradenie konkrétneho podujatia je na obchodníkovi a jeho účtovníčke; tu je
// len mechanizmus a bezpečná predvoľba.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ZAKLADNA_SADZBA } from "./dph";

export { ZAKLADNA_SADZBA, POVOLENE_SADZBY, jePovolenaSadzba, POPIS_SADZIEB } from "./dph";

let cache: { sadzba: number; nacitane: number } | null = null;
const PLATNOST_MS = 60_000;

/** Predvolená sadzba platformy. */
export async function predvolenaSadzba(): Promise<number> {
  if (cache && Date.now() - cache.nacitane < PLATNOST_MS) return cache.sadzba;
  try {
    const { data } = await supabaseAdmin
      .from("platform_settings")
      .select("default_vat_rate")
      .eq("id", true)
      .maybeSingle();
    const sadzba = Number(data?.default_vat_rate);
    cache = {
      sadzba: Number.isFinite(sadzba) && sadzba >= 0 ? sadzba : ZAKLADNA_SADZBA,
      nacitane: Date.now(),
    };
  } catch (e) {
    // Výpadok nastavení nesmie zastaviť fakturáciu — použijeme základnú.
    console.error("Predvolenú sadzbu DPH sa nepodarilo načítať", e);
    cache = { sadzba: ZAKLADNA_SADZBA, nacitane: Date.now() };
  }
  return cache.sadzba;
}

export function zabudniSadzbu(): void {
  cache = null;
}

/**
 * Sadzba pre vstupné na dané podujatie: vlastná sadzba podujatia, inak
 * predvolená sadzba platformy.
 */
export async function sadzbaPodujatia(eventId: string | null | undefined): Promise<number> {
  const predvolena = await predvolenaSadzba();
  if (!eventId) return predvolena;
  try {
    const { data } = await supabaseAdmin
      .from("events")
      .select("vat_rate")
      .eq("id", eventId)
      .maybeSingle();
    const vlastna = data?.vat_rate;
    if (vlastna === null || vlastna === undefined) return predvolena;
    const cislo = Number(vlastna);
    return Number.isFinite(cislo) && cislo >= 0 ? cislo : predvolena;
  } catch (e) {
    console.error("Sadzbu DPH podujatia sa nepodarilo načítať", eventId, e);
    return predvolena;
  }
}
