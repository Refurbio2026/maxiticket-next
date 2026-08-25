// Register fakturačných systémov a jediné miesto, kde sa vystavuje faktúra.
//
// Volajúci (doúčtovanie objednávky, vyúčtovanie organizátorom) nevie, ktorý
// systém faktúru vystaví — vyberá sa podľa nastavenia v administrácii.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pripravPristupy } from "../pristupy.server";
import { fakteroSystem } from "./faktero.server";
import { superFakturaSystem } from "./superfaktura.system.server";
import type { FakturacnySystem, InvoicingId } from "./types";

const SYSTEMY: Record<InvoicingId, FakturacnySystem> = {
  superfaktura: superFakturaSystem,
  faktero: fakteroSystem,
};

export function vsetkyFakturacneSystemy(): FakturacnySystem[] {
  return Object.values(SYSTEMY);
}

export function systemPodlaId(id: string): FakturacnySystem {
  const s = SYSTEMY[id as InvoicingId];
  if (!s) throw new Error(`Neznámy fakturačný systém '${id}'`);
  return s;
}

/** Nastavený fakturačný systém. `null`, keď nie je použiteľný ani jeden. */
export async function fakturacnySystem(): Promise<FakturacnySystem | null> {
  await pripravPristupy();
  const { data } = await supabaseAdmin
    .from("payment_settings")
    .select("invoice_provider")
    .eq("id", true)
    .maybeSingle();

  const zvoleny = data?.invoice_provider || process.env.INVOICE_PROVIDER?.trim() || null;
  if (zvoleny) {
    const s = SYSTEMY[zvoleny as InvoicingId];
    // Zvolený systém bez prístupov nemá zmysel obchádzať potichu — inak by sa
    // faktúry ticho vystavovali inde, než si obsluha myslí.
    if (s) return s.isConfigured() ? s : null;
  }
  // Bez voľby: SuperFaktúra, ako to bolo doteraz.
  return vsetkyFakturacneSystemy().find((s) => s.isConfigured()) ?? null;
}

export type { FakturacnySystem, FakturaVstup, FakturaVysledok, InvoicingId } from "./types";
