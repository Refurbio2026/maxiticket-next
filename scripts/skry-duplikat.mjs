#!/usr/bin/env node
// Skrytie duplicitného podujatia — prepne ho na `draft`.
//
// NEMAŽE NIČ. Podujatie v stave `draft` zmizne z katalógu, z feedov aj
// z vyhľadávania, ale zostáva v databáze so všetkými vstupenkami a dá sa
// jedným kliknutím vrátiť. Zmazanie by bolo nevratné a pri duplikáte, ktorý
// sa ukáže ako ten správny, by nebolo kam sa vrátiť.
//
// POISTKA: podujatie, ktoré má akúkoľvek objednávku, sa skryť NEDÁ. Pri
// duplicitnej dvojici treba zachovať ten záznam, na ktorom visí predaj —
// skryť ten s vstupenkami by znamenalo, že si kupujúci svoju vstupenku
// nenájde v zozname podujatí.
//
// POUŽITIE:
//   node scripts/skry-duplikat.mjs <id> [<id> …]
//   node scripts/skry-duplikat.mjs <id> [<id> …] naostro
import fs from "node:fs";
import pg from "../node_modules/pg/lib/index.js";

const args = process.argv.slice(2);
const NAOSTRO = args[args.length - 1] === "naostro";
const ids = NAOSTRO ? args.slice(0, -1) : args;

if (!ids.length) {
  console.error("Použitie: node scripts/skry-duplikat.mjs <id> [<id> …] [naostro]");
  process.exit(1);
}

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
  `select e.id, e.title, e.city, e.venue, e.event_date::text d, e.event_time::text t, e.status,
          (select count(*) from public.orders o where o.event_id = e.id)::int objednavok,
          (select count(*) from public.tickets x join public.orders o on o.id = x.order_id
            where o.event_id = e.id)::int vstupeniek
     from public.events e where e.id = any($1::uuid[]) order by e.event_date`,
  [ids],
);

const chybajuce = ids.filter((i) => !rows.some((r) => r.id === i));
if (chybajuce.length) {
  console.error("Tieto ID sa nenašli:", chybajuce.join(", "));
  await c.end();
  process.exit(1);
}

console.log("Skryjú sa (prepnú na draft, NIČ sa nemaže):\n");
for (const r of rows) {
  console.log(
    `  ${r.id.slice(0, 8)}  ${r.status} → draft   ${r.d} ${r.t}  ${r.city}, ${r.venue.slice(0, 26)}` +
      `  objednávok:${r.objednavok} vstupeniek:${r.vstupeniek}  ${r.title.slice(0, 34)}`,
  );
}

const sPredajom = rows.filter((r) => r.objednavok > 0);
if (sPredajom.length) {
  console.error(
    `\nZASTAVENÉ: ${sPredajom.length} z nich má objednávky (${sPredajom
      .map((r) => `${r.id.slice(0, 8)}: ${r.objednavok})`)
      .join(", ")}.`,
  );
  console.error("Na tomto zázname visí predaj — skryť treba ten druhý z dvojice.");
  await c.end();
  process.exit(1);
}

const uzSkryte = rows.filter((r) => r.status !== "published");
if (uzSkryte.length === rows.length) {
  console.log("\nVšetky už sú skryté, niet čo robiť.");
  await c.end();
  process.exit(0);
}

if (!NAOSTRO) {
  console.log("\nNASUCHO — nič sa nezmenilo. Spusť znova s `naostro`.");
  console.log("Vrátenie späť: v admine prepni podujatie zo stavu draft na published.");
  await c.end();
  process.exit(0);
}

await c.query("begin");
try {
  const r = await c.query(
    `update public.events set status = 'draft', updated_at = now()
      where id = any($1::uuid[]) and status = 'published'`,
    [ids],
  );
  await c.query("commit");
  console.log(`\nSKRYTÉ — prepnutých na draft: ${r.rowCount}. Nič sa nezmazalo.`);
} catch (e) {
  await c.query("rollback");
  console.error("\nZLYHALO, vrátené späť:", e.message);
  process.exitCode = 1;
}
await c.end();
