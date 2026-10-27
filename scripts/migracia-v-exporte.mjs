#!/usr/bin/env node
// Migrácia „v_exporte" — nasucho alebo naostro.
//
// Nasucho: pustí migráciu v transakcii, vypíše zverejnené podujatia, ktoré by
// išli na portály, a všetko vráti späť cez ROLLBACK.
// Naostro: to isté s COMMIT, plus zápis do schema_migrations.
//
// POUŽITIE:
//   node scripts/migracia-v-exporte.mjs            # nasucho
//   node scripts/migracia-v-exporte.mjs naostro    # zapíše
import fs from "node:fs";
import pg from "../node_modules/pg/lib/index.js";

const SUBOR = "supabase/migrations/20261027103000_podujatie_v_exporte.sql";
const VERZIA = "20261027103000";
const NAOSTRO = process.argv[2] === "naostro";

const env = {};
for (const l of fs.readFileSync("/opt/maxiticket/.env", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const ref = env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\./)[1];
const c = new pg.Client({
  host: env.SUPABASE_DB_HOST ?? "aws-1-eu-west-1.pooler.supabase.com",
  port: Number(env.SUPABASE_DB_PORT ?? 5432),
  user: env.SUPABASE_DB_USER ?? `postgres.${ref}`,
  password: env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

const sql = fs.readFileSync(SUBOR, "utf8");
await c.connect();
c.on("notice", (n) => console.log("  ", n.message));

console.log(NAOSTRO ? "REŽIM: NAOSTRO\n" : "REŽIM: nasucho, vráti sa späť\n");

let ok = false;
try {
  await c.query("begin");
  await c.query(sql);

  const { rows } = await c.query(
    `select title, v_exporte from public.events
      where status = 'published' order by title`,
  );
  console.log(`\nZverejnené podujatia (${rows.length}) a či by išli na portály:`);
  for (const r of rows) {
    console.log(`  ${r.v_exporte ? "áno " : "NIE "} ${r.title.slice(0, 64)}`);
  }

  if (NAOSTRO) {
    await c.query(
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ($1, $2, $3) on conflict (version) do nothing`,
      [VERZIA, "podujatie_v_exporte", [sql]],
    );
    await c.query("commit");
    console.log("\nCOMMIT — stĺpec je v databáze a migrácia zapísaná.");
  } else {
    await c.query("rollback");
    console.log("\nROLLBACK — v databáze sa nič nezmenilo.");
  }
  ok = true;
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("\nZLYHALO, vrátené späť:", e.message);
} finally {
  await c.end();
}
process.exit(ok ? 0 : 1);
