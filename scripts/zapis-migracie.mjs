#!/usr/bin/env node
// Doplnenie záznamov o migráciách, ktoré v databáze bežia, ale nie sú zapísané.
//
// PREČO: `supabase_migrations.schema_migrations` má 63 záznamov, v repozitári
// je 83 súborov. Nástroj teda o dvadsiatich nevie a pri ďalšom `db push` by
// sa ich mohol pokúsiť pustiť znova.
//
// ČO SA OVERILO (24. 10. 2026) — nezapisuje sa naslepo, pri každej migrácii
// som skontroloval, či jej objekty v databáze naozaj existujú:
//   • enumy: `payment_provider` má gpwebpay aj tatrapayplus, `event_status`
//     má cancelled,
//   • indexy z `indexy_logov` existujú všetky tri,
//   • `premenovanie_eticketo`: predvolené hodnoty vo `wallet_settings` sú
//     'eticketo.eu',
//   • `payment_credentials`: tabuľka pod týmto menom neexistuje, lebo ju
//     neskoršia migrácia `fakturacia` premenovala na `integration_credentials`
//     — tá existuje, čiže migrácia prebehla,
//   • ostatné podľa tabuliek, funkcií a stĺpcov, ktoré zakladajú.
//
// ČO SA ZÁMERNE NEZAPISUJE: `20261020150000_stripe_connect.sql`. Tá v databáze
// NEBEŽALA (chýbajú `profiles.stripe_account_id`, `orders.application_fee_cents`
// aj `payment_settings.stripe_enabled`) a zapísať ju by znamenalo zaklamať
// nástroju — pri ďalšom push by ju preskočil a Stripe by nikdy nevznikol.
//
// POUŽITIE:
//   node scripts/zapis-migracie.mjs          # len vypíše
//   node scripts/zapis-migracie.mjs zapis    # zapíše
import fs from "node:fs";
import pg from "../node_modules/pg/lib/index.js";

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
const ZAPISAT = process.argv[2] === "zapis";

/** Migrácia, ktorá v databáze nebežala — zapísať ju by bola lož. */
const NEZAPISOVAT = new Set(["20261020150000"]);

await c.connect();
const { rows } = await c.query("select version from supabase_migrations.schema_migrations");
const zapisane = new Set(rows.map((r) => r.version));

const subory = fs
  .readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => !zapisane.has(f.slice(0, 14)));

const naZapis = subory.filter((f) => !NEZAPISOVAT.has(f.slice(0, 14)));
const vynechane = subory.filter((f) => NEZAPISOVAT.has(f.slice(0, 14)));

console.log(`zapísaných: ${zapisane.size} · súborov bez záznamu: ${subory.length}\n`);
console.log(`DOPLNÍ SA ${naZapis.length}:`);
for (const f of naZapis) console.log("  " + f);
if (vynechane.length) {
  console.log(`\nVYNECHÁ SA ${vynechane.length} (v databáze nebežala):`);
  for (const f of vynechane) console.log("  " + f);
}

if (!ZAPISAT) {
  console.log("\n(náhľad — nič sa nezapísalo)");
  await c.end();
  process.exit(0);
}

let ok = 0;
for (const f of naZapis) {
  const version = f.slice(0, 14);
  const name = f.replace(/^\d+_/, "").replace(/\.sql$/, "");
  try {
    await c.query(
      "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing",
      [version, name],
    );
    ok++;
  } catch (e) {
    console.log(`  CHYBA ${f}: ${e.message}`);
  }
}
const { rows: po } = await c.query(
  "select count(*)::int n from supabase_migrations.schema_migrations",
);
console.log(`\ndoplnených ${ok}, záznamov spolu ${po[0].n}`);
await c.end();
