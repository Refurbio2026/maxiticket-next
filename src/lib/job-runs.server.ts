// Obal pravidelnej úlohy: zámok, záznam behu a izolácia chýb.
//
// `system_heartbeats` hovorí len „naposledy zbehlo o…". Tu je každý beh
// zvlášť aj s počtami a chybou, takže sa dá povedať, ktorý beh zlyhal a na čom.
//
// Zámok je riadok v `job_runs` s unikátnym indexom, nie `pg_try_advisory_lock`.
// Cez pooler a PostgREST beží každé volanie v inej transakcii aj na inom
// spojení: sedenie-ový advisory zámok by sa nikdy neuvoľnil a transakčný by
// padol skôr, než by úloha v JavaScripte vôbec začala.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { errorMessage } from "./error-message";

export type VysledokUlohy<T> =
  | { stav: "ok"; vysledok: T }
  | { stav: "preskocene"; dovod: "uz_bezi" }
  | { stav: "zlyhalo"; chyba: string };

/**
 * Spustí úlohu pod zámkom a zapíše jej beh.
 *
 * **Nikdy nevyhodí výnimku.** Cron púšťa niekoľko úloh za sebou a zlyhanie
 * pripomienok nesmie zhodiť dopytovací sken — ten rieši peniaze.
 */
export async function spustiUlohu<T>(
  job: string,
  fn: () => Promise<T>,
  opts?: { ttlMinut?: number },
): Promise<VysledokUlohy<T>> {
  let runId: string | null = null;

  try {
    const { data, error } = await supabaseAdmin.rpc("start_job_run", {
      p_job: job,
      p_ttl_minutes: opts?.ttlMinut ?? 30,
    });
    if (error) throw new Error(error.message);
    runId = data ?? null;
  } catch (e) {
    // Keď sa nedá ani zapísať beh, úlohu radšej nespustíme: bez zámku by
    // dva súbežné behy párovali tie isté platby.
    console.error("Úlohu sa nepodarilo zapísať", job, errorMessage(e));
    return { stav: "zlyhalo", chyba: errorMessage(e) };
  }

  if (!runId) return { stav: "preskocene", dovod: "uz_bezi" };

  try {
    const vysledok = await fn();
    await supabaseAdmin.rpc("finish_job_run", {
      p_id: runId,
      p_status: "ok",
      p_stats: (vysledok ?? null) as Json,
      p_error: null,
    });
    return { stav: "ok", vysledok };
  } catch (e) {
    const chyba = errorMessage(e);
    console.error("Úloha zlyhala", job, chyba);
    await supabaseAdmin.rpc("finish_job_run", {
      p_id: runId,
      p_status: "failed",
      p_stats: null,
      p_error: chyba.slice(0, 1000),
    });
    return { stav: "zlyhalo", chyba };
  }
}

/** Behy pre prehľad prevádzky. */
export async function poslednéBehy(limit = 50) {
  const { data } = await supabaseAdmin
    .from("job_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/**
 * Zmaže staré záznamy prevádzkových logov.
 *
 * Ani `job_runs`, ani `om_reconcile_log` nikto nemazal: k 19. 10. 2026 mali
 * 146 tisíc a 116 tisíc riadkov (56 MB + 61 MB) a rástli o ~5 160 riadkov
 * denne. Databáza stúpla z 205 MB (29. 9.) na 290 MB. Limit je 4 000 MB, takže
 * nehorelo — ale je to rast bez konca a nafukuje zálohy.
 *
 * Lehoty sú krátke zámerne: obe tabuľky sú **prevádzkový log**, nie účtovný
 * záznam. Čo bolo pred dvoma týždňami, nikto nerieši; aktuálny stav vidno
 * v `system_heartbeats` a v súborových logoch.
 *
 * POZOR: mazanie riadkov neuvolní miesto operačnému systému — autovacuum ho
 * nechá na ďalší zápis. Tabuľky teda hneď nezmenšia, len prestanú rásť.
 */
export async function upracLogy(
  dniJobRuns = 14,
  dniOmLog = 7,
): Promise<{ job_runs: number; om_reconcile_log: number }> {
  const hranica = (dni: number) => new Date(Date.now() - dni * 86_400_000).toISOString();

  const { count: jobRuns, error: ch1 } = await supabaseAdmin
    .from("job_runs")
    .delete({ count: "exact" })
    .lt("started_at", hranica(dniJobRuns));
  if (ch1) throw new Error(`job_runs: ${ch1.message}`);

  const { count: omLog, error: ch2 } = await supabaseAdmin
    .from("om_reconcile_log")
    .delete({ count: "exact" })
    .lt("checked_at", hranica(dniOmLog));
  if (ch2) throw new Error(`om_reconcile_log: ${ch2.message}`);

  return { job_runs: jobRuns ?? 0, om_reconcile_log: omLog ?? 0 };
}
