#!/usr/bin/env node
// Skúška obnovy zo zálohy — dokáže, že záloha sa naozaj dá nahrať.
//
// Prečo nie obnova do vedľajšej databázy: na tomto stroji nie je serverový
// Postgres ani Docker (len klientske binárky v /opt/maxiticket/restore/pg18)
// a databáza je v Supabase, kde si novú databázu nevytvoríme.
//
// Preto sa obnova skúša do DOČASNÝCH tabuliek (`create temp table … like
// public.<t>`) v jednej transakcii, ktorá sa na konci **vráti**. Sú to
// skutočné tabuľky so skutočnými typmi a CHECK podmienkami, takže zlý typ,
// chýbajúci enum alebo NULL v nenullovom stĺpci tu spadnú rovnako ako pri
// ostrej obnove. Po skončení spojenia nezostane nič.
//
// Čo to NEoverí: cudzie kľúče (`like` ich nekopíruje) a `auth.users` (tie
// v zálohe nie sú — pozri docs/zaloha.md).
//
//   node scripts/skuska-obnovy.mjs [priečinok-zálohy]
//
// Bez argumentu si vezme najnovšiu zálohu z /opt/maxiticket/backup.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import pg from "../node_modules/pg/lib/index.js";

const ZALOHY = process.env.ZALOHA_DIR ?? "/opt/maxiticket/backup";

function nacitajEnv(cesta = "/opt/maxiticket/.env") {
  const env = { ...process.env };
  if (!fs.existsSync(cesta)) return env;
  for (const riadok of fs.readFileSync(cesta, "utf8").split("\n")) {
    const m = riadok.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return env;
}

function pristupy(env) {
  const ref = env.SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\./)?.[1];
  if (!ref || !env.SUPABASE_DB_PASSWORD) {
    throw new Error("v /opt/maxiticket/.env chýba SUPABASE_URL alebo SUPABASE_DB_PASSWORD");
  }
  return {
    host: env.SUPABASE_DB_HOST ?? "aws-1-eu-west-1.pooler.supabase.com",
    port: Number(env.SUPABASE_DB_PORT ?? 5432),
    user: env.SUPABASE_DB_USER ?? `postgres.${ref}`,
    password: env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600000,
    // Bez týchto dvoch sa zaseknutý dotaz neohlási nikdy: prvý pokus visel
    // 11 minút na `venue_layouts`, kým som ho nezabil.
    query_timeout: 180000,
    keepAlive: true,
  };
}

function najnovsiaZaloha() {
  const d = fs
    .readdirSync(ZALOHY)
    .filter((x) => /^\d{8}-\d{4}$/.test(x))
    .sort();
  if (!d.length) throw new Error(`v ${ZALOHY} nie je žiadna záloha`);
  return path.join(ZALOHY, d[d.length - 1]);
}

/** Prečíta .jsonl.gz a vráti riadky; neplatný JSON ohlási s číslom riadku. */
function citajJsonl(subor) {
  const text = zlib.gunzipSync(fs.readFileSync(subor)).toString("utf8");
  const riadky = text.split("\n").filter((r) => r.trim() !== "");
  return riadky.map((r, i) => {
    try {
      return JSON.parse(r);
    } catch (e) {
      throw new Error(`${path.basename(subor)}: riadok ${i + 1} nie je platný JSON — ${e.message}`);
    }
  });
}

const zaokruhli = (n) => Math.round(n * 10) / 10;

/** Rozdelí riadky na dávky do ~1,5 MB JSON-u a najviac 200 riadkov. */
function* poDavkach(riadky, maxBajtov = 1_500_000, maxRiadkov = 200) {
  let davka = [];
  let bajtov = 0;
  for (const r of riadky) {
    const velkost = JSON.stringify(r).length;
    if (davka.length > 0 && (bajtov + velkost > maxBajtov || davka.length >= maxRiadkov)) {
      yield davka;
      davka = [];
      bajtov = 0;
    }
    davka.push(r);
    bajtov += velkost;
  }
  if (davka.length) yield davka;
}

async function main() {
  const priecinok = process.argv[2] ? path.resolve(process.argv[2]) : najnovsiaZaloha();
  const manifest = JSON.parse(fs.readFileSync(path.join(priecinok, "manifest.json"), "utf8"));
  const ocakavane = new Map(manifest.tabulky.map((t) => [t.tabulka, t.riadkov]));

  console.log(`Záloha:        ${priecinok}`);
  console.log(`Vznikla:       ${manifest.vzniklo}`);
  console.log(`Migrácia:      ${manifest.posledna_migracia}`);
  console.log(`Hlási:         ${manifest.tabulky.length} tabuliek, ${manifest.riadkov_spolu} riadkov\n`);

  const env = nacitajEnv();
  const c = new pg.Client(pristupy(env));
  await c.connect();

  const nesulady = [];
  let vlozenych = 0;
  let tabuliek = 0;
  const zaciatok = Date.now();

  try {
    await c.query("begin");
    // Dočasné tabuľky aj tak zmiznú, ale nech je to v kóde vidieť.
    await c.query("set local statement_timeout = '600s'");

    for (const tabulka of manifest.poradie_vkladania) {
      const subor = path.join(priecinok, `${tabulka}.jsonl.gz`);
      if (!fs.existsSync(subor)) {
        nesulady.push(`${tabulka}: súbor v zálohe chýba`);
        continue;
      }

      const riadky = citajJsonl(subor);
      const docasna = `o_${tabulka}`.slice(0, 63);
      // Vypísať pred vkladaním: keby to zamrzlo, nech je vidieť na čom.
      process.stdout.write(`  ${tabulka.padEnd(26)} `);

      await c.query(
        `create temp table "${docasna}" (like public."${tabulka}" including defaults including constraints) on commit drop`,
      );
      // Po dávkach, nie všetko naraz: `venue_layouts` má 518 riadkov, ale
      // po rozbalení 48 MB (mapy sedadiel ~93 KB na riadok) a jeden taký
      // dotaz spojenie cez pooler utopí.
      for (const davka of poDavkach(riadky)) {
        // json_populate_recordset použije typ ostrej tabuľky, takže zlý typ,
        // neznámy enum či NULL v nenullovom stĺpci spadnú presne tu.
        await c.query(
          `insert into "${docasna}" select * from json_populate_recordset(null::public."${tabulka}", $1::json)`,
          [JSON.stringify(davka)],
        );
      }

      const { rows: po } = await c.query(`select count(*)::int as n from "${docasna}"`);
      const { rows: zivo } = await c.query(`select count(*)::int as n from public."${tabulka}"`);

      const vSubore = riadky.length;
      const vManifeste = ocakavane.get(tabulka);
      const obnovenych = po[0].n;
      const naZivo = zivo[0].n;

      if (vManifeste !== undefined && vManifeste !== vSubore) {
        nesulady.push(`${tabulka}: manifest hlási ${vManifeste}, v súbore je ${vSubore}`);
      }
      if (obnovenych !== vSubore) {
        nesulady.push(`${tabulka}: v súbore ${vSubore}, obnovilo sa ${obnovenych}`);
      }

      // Rozdiel proti živej databáze nie je chyba: od 3:20 sa mohlo pridať.
      const posun = naZivo - vSubore;
      const znacka = posun === 0 ? "=" : posun > 0 ? `+${posun} od zálohy` : `${posun} oproti zálohe`;
      console.log(
        `obnovené ${String(obnovenych).padStart(5)}   živé ${String(naZivo).padStart(5)}   ${znacka}`,
      );

      vlozenych += obnovenych;
      tabuliek += 1;
    }

    // Vzorka po poliach: jeden skutočný záznam z každej kľúčovej tabuľky.
    console.log("\nKontrola vzorky po poliach:");
    for (const tabulka of ["orders", "tickets", "profiles", "events"]) {
      const docasna = `o_${tabulka}`;
      const { rows: vzorka } = await c.query(`select * from "${docasna}" limit 1`);
      if (!vzorka.length) {
        console.log(`  ${tabulka.padEnd(12)} v zálohe nie je ani jeden riadok`);
        continue;
      }
      const zaznam = vzorka[0];
      const { rows: zivy } = await c.query(`select * from public."${tabulka}" where id = $1`, [
        zaznam.id,
      ]);
      if (!zivy.length) {
        nesulady.push(`${tabulka}: záznam ${zaznam.id} zo zálohy v živej databáze nie je`);
        continue;
      }
      const rozdiely = Object.keys(zaznam).filter(
        (k) => JSON.stringify(zaznam[k]) !== JSON.stringify(zivy[0][k]),
      );
      console.log(
        rozdiely.length === 0
          ? `  ${tabulka.padEnd(12)} ${Object.keys(zaznam).length} polí sedí (${zaznam.id})`
          : `  ${tabulka.padEnd(12)} ROZDIEL v poliach: ${rozdiely.join(", ")}`,
      );
      if (rozdiely.length) {
        // Zmena po 3:20 je legitímna; preto to hlásime, ale nepočítame za chybu.
        console.log(`    (mohlo sa zmeniť po vzniku zálohy — porovnaj ručne)`);
      }
    }

    await c.query("rollback");
  } finally {
    await c.end();
  }

  const trvalo = zaokruhli((Date.now() - zaciatok) / 1000);
  console.log(`\nObnovené: ${vlozenych} riadkov v ${tabuliek} tabuľkách za ${trvalo} s`);
  console.log("Transakcia vrátená — v ostrej databáze nezostalo nič.");

  if (nesulady.length) {
    console.log(`\nNESÚLADY (${nesulady.length}):`);
    for (const n of nesulady) console.log(`  - ${n}`);
    process.exit(1);
  }
  console.log("\nVÝSLEDOK: záloha je obnoviteľná, nula nesúladov.");
}

main().catch((e) => {
  console.error("SKÚŠKA OBNOVY ZLYHALA:", e.message);
  process.exit(1);
});
