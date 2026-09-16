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
