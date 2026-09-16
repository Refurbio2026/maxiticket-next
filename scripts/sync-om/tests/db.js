// Pomocník pre testy, ktoré sa rozhodujú v SQL — poradie skenov, idempotencia
// upsertu, kontrola počtov. Tie sa v JavaScripte overiť nedajú; ich prepis do JS
// by testoval kópiu, nie to, čo naozaj beží.
//
// Každé volanie beží v **samostatnej transakcii ukončenej ROLLBACK**, takže po
// testoch nezostane v databáze nič. Preto musí byť každý blok samostatný —
// medzi volaniami sa stav neprenáša.
//
// Bez prístupu k databáze sa tieto testy **preskočia**, nie „prejdú".

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** psql so skriptom na stdin. `execFile` stdin neprijíma, preto `spawn`. */
function vykonaj(prikaz, argumenty, { env, input = "", timeout = 30_000 } = {}) {
  return new Promise((splnene, zamietnute) => {
    const p = spawn(prikaz, argumenty, { env });
    let stdout = "";
    let stderr = "";
    const hodiny = setTimeout(() => {
      p.kill("SIGKILL");
      zamietnute(new Error(`psql neodpovedal do ${timeout} ms`));
    }, timeout);
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => {
      clearTimeout(hodiny);
      zamietnute(e);
    });
    p.on("close", (kod) => {
      clearTimeout(hodiny);
      if (kod === 0) splnene({ stdout, stderr });
      else zamietnute(new Error(stderr.trim() || `psql skončil s kódom ${kod}`));
    });
    p.stdin.end(input);
  });
}

const PSQL = "/opt/maxiticket/restore/pg18/root/usr/lib/postgresql/18/bin/psql";
const LIB = "/opt/maxiticket/restore/pg18/root/usr/lib/x86_64-linux-gnu";
const HOST = "aws-1-eu-west-1.pooler.supabase.com";
const USER = "postgres.aasraovckzekicoobadx";

let heslo;
function najdiHeslo() {
  if (heslo !== undefined) return heslo;
  heslo = process.env.SUPABASE_DB_PASSWORD ?? null;
  if (!heslo && existsSync("/opt/maxiticket/.env")) {
    const m = readFileSync("/opt/maxiticket/.env", "utf8").match(/^SUPABASE_DB_PASSWORD=(.*)$/m);
    heslo = m ? m[1].trim() : null;
  }
  return heslo;
}

let dostupna;
export async function dostupnaDb() {
  if (dostupna !== undefined) return dostupna;
  if (!existsSync(PSQL) || !najdiHeslo()) {
    console.error("  ⚠ SQL testy preskočené: nie je psql alebo SUPABASE_DB_PASSWORD");
    dostupna = false;
    return dostupna;
  }
  try {
    await vykonaj(
      PSQL,
      ["-q", "-h", HOST, "-p", "5432", "-U", USER, "-d", "postgres", "-c", "select 1"],
      {
        env: { ...process.env, PGPASSWORD: najdiHeslo(), LD_LIBRARY_PATH: LIB },
        timeout: 15_000,
      },
    );
    dostupna = true;
  } catch (e) {
    console.error(`  ⚠ SQL testy preskočené: ${e.message.split("\n")[0]}`);
    dostupna = false;
  }
  return dostupna;
}

/**
 * Posledný `SELECT` v bloku je ten, ktorého riadky sa vrátia. Všetko pred ním
 * je príprava.
 *
 * Výsledok ide cez `COPY … TO STDOUT` ako JSON po riadkoch — psql inak
 * pri viacerých dotazoch zlepí výstupy tak, že sa nedajú rozlíšiť.
 */
export async function sql(blok) {
  const orezany = blok.trim().replace(/;\s*$/, "");
  const i = orezany.search(/(^|\n)\s*select\s(?![\s\S]*\n\s*select\s)/i);
  if (i < 0) throw new Error("Blok musí končiť príkazom SELECT");

  const priprava = orezany.slice(0, i).trim();
  const poslednyDotaz = orezany.slice(i).trim();

  // Prípravné príkazy môžu samy niečo vypísať (napr. `select om_doparuj_skeny()`).
  // Ich výstup ide do /dev/null, aby sa nezlial s riadkami z COPY.
  const skript = [
    "BEGIN;",
    "\\o /dev/null",
    priprava ? priprava.replace(/;?\s*$/, ";") : "",
    "\\o",
    `COPY (SELECT row_to_json(v) FROM (${poslednyDotaz}) v) TO STDOUT;`,
    "ROLLBACK;",
  ].join("\n");

  const { stdout } = await vykonaj(
    PSQL,
    ["-q", "-v", "ON_ERROR_STOP=1", "-h", HOST, "-p", "5432", "-U", USER, "-d", "postgres"],
    {
      env: { ...process.env, PGPASSWORD: najdiHeslo(), LD_LIBRARY_PATH: LIB },
      input: skript,
      timeout: 30_000,
    },
  );

  return stdout
    .split("\n")
    .filter((r) => r.trim())
    .map((r) => JSON.parse(r));
}
