#!/usr/bin/env node
// Doplnenie bodov o doručení poštou do obchodných podmienok.
//
// PREČO: pri čistení podmienok (keď sme poštou nedoručovali) z nich vypadol
// bod 4.1.1 — doručenie poštou — a tiež 4.2.1 o zodpovednosti za oneskorenie
// zavinené poštou. Zostala po nich diera: bod 4.1 sľubuje výber spôsobu
// dodania, ale uvedený je len jeden, a body 4.2.2 a 4.2.3 sa odvolávajú na
// poštovú adresu a dodacie podmienky pošty, ktoré v podmienkach nikde nie sú.
//
// Teraz poštou doručujeme, takže sa body vracajú. Text vychádza z pôvodného
// znenia, ale hovorí, čo naozaj robíme: doporučene Slovenskou poštou, len na
// slovenské adresy, poštovné vidí zákazník v košíku pred zaplatením.
//
// POUŽITIE:
//   node scripts/podmienky-dorucenie.mjs            # nasucho, vypíše zmenu
//   node scripts/podmienky-dorucenie.mjs naostro    # zapíše
import fs from "node:fs";
import pg from "../node_modules/pg/lib/index.js";

const NAOSTRO = process.argv[2] === "naostro";

const BOD_411 =
  "4.1.1 poštou doporučene na adresu uvedenú pri nákupe vstupeniek, a to len na adresy " +
  "na území Slovenskej republiky. Poštovné je účtované v plnej výške majiteľovi vstupenky; " +
  "jeho aktuálna výška je uvedená v nákupnom košíku pri výbere spôsobu dodania, ešte pred " +
  "zaplatením objednávky. Vstupenky budú podané na poštu v lehote do 2 pracovných dní od " +
  "realizácie platby. Majiteľ vstupenky zároveň dostane vstupenky aj elektronicky podľa " +
  "bodu 4.1.2, aby sa na podujatie dostal aj v prípade, že zásielka nedorazí včas.";

const BOD_421 =
  "4.2.1 za oneskorené dodanie objednaných vstupeniek zavinené poštou, resp. expresnou " +
  "zásielkovou službou,";

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
const { rows } = await c.query(
  "select body from public.site_pages where slug = 'obchodne-podmienky'",
);
if (!rows.length) {
  console.error("Stránka obchodne-podmienky sa nenašla.");
  await c.end();
  process.exit(1);
}

let telo = rows[0].body;
const zmeny = [];

// Vkladá sa PRED existujúci bod, nie na pevný riadok — pevné číslo riadku by
// pri akejkoľvek inej úprave podmienok vložilo text na nesprávne miesto.
function vlozPred(znacka, text, popis) {
  if (telo.includes(text.slice(0, 40))) {
    console.log(`  — ${popis}: už tam je, preskakujem`);
    return;
  }
  const i = telo.indexOf(znacka);
  if (i < 0) throw new Error(`V podmienkach sa nenašlo „${znacka}" — nič sa nemení.`);
  telo = telo.slice(0, i) + text + "\n\n" + telo.slice(i);
  zmeny.push(popis);
  console.log(`  ✓ ${popis}`);
}

console.log("Zmeny v obchodných podmienkach:");
vlozPred("4.1.2 internetové doručenie", BOD_411, "bod 4.1.1 — doručenie poštou");
vlozPred("4.2.2 za oneskorené dodanie", BOD_421, "bod 4.2.1 — oneskorenie zavinené poštou");

if (!zmeny.length) {
  console.log("\nNič na zmenu.");
  await c.end();
  process.exit(0);
}

console.log(`\nDĺžka textu: ${rows[0].body.length} → ${telo.length} znakov`);
console.log("\nVložené znenie:\n");
for (const r of telo.split("\n")) {
  if (r.startsWith("4.1.1") || r.startsWith("4.2.1")) console.log("  " + r + "\n");
}

if (!NAOSTRO) {
  console.log("NASUCHO — v databáze sa nič nezmenilo. Spusť s `naostro`, keď je text v poriadku.");
  await c.end();
  process.exit(0);
}

await c.query("begin");
try {
  const r = await c.query(
    "update public.site_pages set body = $1, updated_at = now() where slug = 'obchodne-podmienky'",
    [telo],
  );
  if (r.rowCount !== 1) throw new Error(`upravených riadkov: ${r.rowCount}, očakával sa 1`);
  await c.query("commit");
  console.log("ZAPÍSANÉ.");
} catch (e) {
  await c.query("rollback");
  console.error("ZLYHALO, vrátené späť:", e.message);
  process.exitCode = 1;
}
await c.end();
