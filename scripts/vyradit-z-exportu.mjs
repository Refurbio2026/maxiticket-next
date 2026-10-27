#!/usr/bin/env node
// Vyradenie podujatí z feedov pre cudzie portály.
//
// Vyradí sa to, čo na našom webe byť musí, ale na kultúrnom portáli by bolo
// zle: skúšobné podujatie na test platobnej brány a darčekové poukazy
// (tie majú vymyslený dátum 31. 12. a v cudzom kalendári by sa ukázali ako
// silvestrovské koncerty).
//
// Vyberá sa podľa ID, nie podľa názvu — „podujatie, ktoré má v názve SKÚŠKA"
// je pravidlo, ktoré raz vylúči skutočný koncert. Zoznam sa najprv vypíše
// a ukáže sa, čoho sa to týka.
//
// POUŽITIE:
//   node scripts/vyradit-z-exportu.mjs            # nasucho
//   node scripts/vyradit-z-exportu.mjs naostro    # zapíše
import fs from "node:fs";
import pg from "../node_modules/pg/lib/index.js";

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

await c.connect();

const { rows: maStlpec } = await c.query(
  `select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'v_exporte'`,
);
if (!maStlpec.length) {
  console.error("Chýba stĺpec events.v_exporte — najprv pusť scripts/migracia-v-exporte.mjs.");
  await c.end();
  process.exit(1);
}

// Kandidáti sa NAJPRV nájdu a vypíšu, až potom sa niečo mení. Názov slúži
// len na to, aby bolo vidno, čoho sa to týka — rozhoduje človek pri pohľade
// na zoznam, nie vzorka v názve.
const { rows: kandidati } = await c.query(
  `select id, title, status, v_exporte from public.events
    where status = 'published' and v_exporte is true
      and (title ilike '%SKÚŠKA PLATBY%' or title ilike '%darčekový poukaz%')
    order by title`,
);

if (!kandidati.length) {
  console.log("Niet čo vyradiť — všetko zverejnené patrí na portály.");
  await c.end();
  process.exit(0);
}

console.log(`Z feedov pre portály sa vyradí ${kandidati.length} záznamov:\n`);
for (const k of kandidati) console.log(`  ${k.id.slice(0, 8)}  ${k.title}`);

console.log("\nNa našom webe zostávajú bez zmeny — mení sa len export.");

if (!NAOSTRO) {
  console.log("\nNASUCHO — nič sa nezmenilo. Spusť s `naostro`, keď je zoznam v poriadku.");
  await c.end();
  process.exit(0);
}

await c.query("begin");
try {
  const r = await c.query(
    `update public.events set v_exporte = false, updated_at = now() where id = any($1::uuid[])`,
    [kandidati.map((k) => k.id)],
  );
  if (r.rowCount !== kandidati.length) {
    throw new Error(`upravených ${r.rowCount}, očakávalo sa ${kandidati.length}`);
  }
  await c.query("commit");
  console.log(`\nZAPÍSANÉ — ${r.rowCount} záznamov je mimo exportu.`);
} catch (e) {
  await c.query("rollback");
  console.error("\nZLYHALO, vrátené späť:", e.message);
  process.exitCode = 1;
}
await c.end();
