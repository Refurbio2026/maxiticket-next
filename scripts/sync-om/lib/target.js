// Zápis do cieľa (naša Supabase). Service key obchádza RLS — tabuľky `om_*`
// iné práva nemajú, politiku žiadnu.

import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";
import { overLimit } from "./velkost.js";

export const DAVKA = 1000;

let klient;

export function ciel() {
  if (!klient) {
    klient = createClient(env.supabase.url, env.supabase.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return klient;
}

/**
 * Idempotentný upsert po dávkach 1000.
 *
 * Každá dávka musí byť opakovateľná bez následkov — kurzory majú prekryv
 * a pri reštarte sa časť riadkov načíta znovu. Kľúč je vždy prirodzené OM id.
 */
export async function upsert(tabulka, riadky, konflikt, { dryRun = false, log } = {}) {
  if (!riadky.length) return 0;
  if (dryRun) return riadky.length;

  let zapisane = 0;
  for (let i = 0; i < riadky.length; i += DAVKA) {
    // Poistka pred **každou** dávkou. Je to jediné miesto, cez ktoré tečie
    // všetko, čo sync zapisuje, takže sa nedá obísť pridaním kanála.
    await overLimit(log);
    const davka = riadky.slice(i, i + DAVKA);
    const { error } = await ciel()
      .from(tabulka)
      .upsert(davka, { onConflict: konflikt, defaultToNull: false });
    if (error) {
      log?.error(`Zápis do ${tabulka} zlyhal`, {
        davka: `${i}–${i + davka.length}`,
        chyba: error.message,
      });
      throw new Error(`${tabulka}: ${error.message}`);
    }
    zapisane += davka.length;
  }
  return zapisane;
}

// --- Kurzory ---------------------------------------------------------------

export async function nacitajKurzor(kanal) {
  const { data, error } = await ciel()
    .from("om_sync_cursor")
    .select("cursor_value")
    .eq("channel", kanal)
    .maybeSingle();
  if (error) throw new Error(`Kurzor ${kanal}: ${error.message}`);
  return data?.cursor_value ?? {};
}

/**
 * Kurzor sa posúva **až po** úspešnom zapísaní celej dávky. Pri `--dry-run`
 * sa neposúva vôbec, inak by skúšobný beh preskočil dáta ostrému.
 */
export async function ulozKurzor(kanal, { hodnota, riadkov, chyba, dryRun = false }) {
  if (dryRun) return;
  const zmena = {
    last_run_at: new Date().toISOString(),
    last_error: chyba ?? null,
    rows_processed: riadkov ?? 0,
  };
  if (!chyba) {
    zmena.last_success_at = zmena.last_run_at;
    if (hodnota !== undefined) zmena.cursor_value = hodnota;
  }
  const { error } = await ciel().from("om_sync_cursor").update(zmena).eq("channel", kanal);
  if (error) throw new Error(`Uloženie kurzora ${kanal}: ${error.message}`);
}

// --- Zámok proti súbehu ----------------------------------------------------
// Používa sa `job_runs` a jeho unique index `job_runs_jeden_beziaci`, ktorý
// v projekte už existuje. Advisory zámok by cez pooler nefungoval.

export async function zaberUlohu(job, ttlMinut = 30) {
  const { data, error } = await ciel().rpc("start_job_run", {
    p_job: job,
    p_ttl_minutes: ttlMinut,
  });
  if (error) throw new Error(`Zabratie úlohy ${job}: ${error.message}`);
  return data ?? null;
}

export async function dokonciUlohu(id, status, stats, chyba) {
  if (!id) return;
  const { error } = await ciel().rpc("finish_job_run", {
    p_id: id,
    p_status: status,
    p_stats: stats ?? null,
    p_error: chyba ?? null,
  });
  if (error) throw new Error(`Dokončenie úlohy: ${error.message}`);
}
