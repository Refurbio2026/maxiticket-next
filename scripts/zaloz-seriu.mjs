#!/usr/bin/env node
// Založenie série (turné) a priradenie podujatí.
//
// PREČO: to isté predstavenie vo viacerých mestách sú u nás viaceré
// podujatia — `event_dates` nemá miesto, takže termín je vždy v tej istej
// sále. Séria (`event_groups`) ich drží spolu: v katalógu je z nich jedna
// karta a klik vedie na /seria/<slug> so zoznamom predstavení.
//
// Podujatia sa zadávajú VÝSLOVNE podľa ID, nie podľa názvu. Dva koncerty
// s rovnakým názvom nemusia byť turné a zoskupiť cudzie podujatie do série
// znamená poslať kupujúceho do iného mesta.
//
// POUŽITIE:
//   node scripts/zaloz-seriu.mjs "Richard Müller – komorný recitál 2026" <id> <id> …
//   node scripts/zaloz-seriu.mjs "…" <id> <id> … naostro
import fs from "node:fs";
import pg from "../node_modules/pg/lib/index.js";

const args = process.argv.slice(2);
const NAOSTRO = args[args.length - 1] === "naostro";
const zoznam = NAOSTRO ? args.slice(0, -1) : args;
const nazov = zoznam[0];
const ids = zoznam.slice(1);

if (!nazov || ids.length < 2) {
  console.error('Použitie: node scripts/zaloz-seriu.mjs "<názov série>" <id> <id> … [naostro]');
  console.error("Séria má zmysel od dvoch podujatí.");
  process.exit(1);
}

/** Názov na slug bez diakritiky — rovnako ako to robí admin pri skupinách. */
function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

const slug = slugify(nazov);
console.log(`Séria: „${nazov}"\nSlug:  ${slug}  →  /seria/${slug}\n`);

const { rows: podujatia } = await c.query(
  `select id, title, status, city, venue, event_date::text d, group_id
     from public.events where id = any($1::uuid[]) order by event_date`,
  [ids],
);

const chybajuce = ids.filter((i) => !podujatia.some((p) => p.id === i));
if (chybajuce.length) {
  console.error("Tieto ID sa nenašli:", chybajuce.join(", "));
  await c.end();
  process.exit(1);
}

console.log("Priradia sa tieto podujatia:");
for (const p of podujatia) {
  const uz = p.group_id ? "  (POZOR: už je v inej série)" : "";
  console.log(`  ${p.d}  ${p.status.padEnd(10)} ${p.city.padEnd(18)} ${p.venue.slice(0, 28).padEnd(30)} ${p.title.slice(0, 34)}${uz}`);
}

const vInej = podujatia.filter((p) => p.group_id);
if (vInej.length) {
  console.error(
    `\n${vInej.length} podujatí už patrí do inej série. Prepísať ich by ich vytrhlo z toho turné — najprv to vyrieš ručne.`,
  );
  await c.end();
  process.exit(1);
}

const { rows: uzExistuje } = await c.query(
  "select id, name from public.event_groups where slug = $1",
  [slug],
);
if (uzExistuje.length) {
  console.log(`\nSéria s týmto slugom už existuje („${uzExistuje[0].name}") — podujatia sa do nej len priradia.`);
}

if (!NAOSTRO) {
  console.log("\nNASUCHO — nič sa nezmenilo. Spusť znova s `naostro`.");
  await c.end();
  process.exit(0);
}

await c.query("begin");
try {
  let groupId = uzExistuje[0]?.id;
  if (!groupId) {
    const { rows } = await c.query(
      `insert into public.event_groups (name, slug, active, sort_order)
       values ($1, $2, true, 0) returning id`,
      [nazov, slug],
    );
    groupId = rows[0].id;
    console.log(`\nSéria vytvorená: ${groupId}`);
  }

  const r = await c.query(
    `update public.events set group_id = $1, updated_at = now() where id = any($2::uuid[])`,
    [groupId, ids],
  );
  if (r.rowCount !== ids.length) {
    throw new Error(`priradených ${r.rowCount}, očakávalo sa ${ids.length}`);
  }
  await c.query("commit");
  console.log(`Priradených podujatí: ${r.rowCount}`);
  console.log(`\nHotovo. Séria je na /seria/${slug}`);
} catch (e) {
  await c.query("rollback");
  console.error("\nZLYHALO, vrátené späť:", e.message);
  process.exitCode = 1;
}
await c.end();
