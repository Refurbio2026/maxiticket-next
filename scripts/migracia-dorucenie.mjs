#!/usr/bin/env node
// Migrácia „doručenie poštou" — nasucho alebo naostro.
//
// NASUCHO (predvolene): migráciu pustí v transakcii, nechá dobehnúť jej
// vlastné kontroly, vypíše, čo na objednávkach vznikne, a všetko vráti späť
// cez ROLLBACK. V databáze nezostane nič.
//
// NAOSTRO (`naostro`): to isté, ale s COMMIT, a navyše zapíše migráciu do
// `supabase_migrations.schema_migrations`, aby ju `db push` neskúšal znova.
//
// POUŽITIE:
//   node scripts/migracia-dorucenie.mjs            # nasucho, vráti späť
//   node scripts/migracia-dorucenie.mjs naostro    # zapíše natrvalo
import fs from "node:fs";
import pg from "../node_modules/pg/lib/index.js";

const SUBOR = "supabase/migrations/20261026210000_dorucenie_postou.sql";
const VERZIA = "20261026210000";
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

// Hlášky z `raise notice` chceme vidieť — práve v nich hovoria kontroly
// v migrácii, či prešli.
c.on("notice", (n) => console.log("  pošta:", n.message));

const { rows: pred } = await c.query(
  `select count(*)::int as vsetky,
          count(*) filter (where status = 'paid')::int as zaplatene
     from public.orders`,
);
console.log(`Objednávok v databáze: ${pred[0].vsetky} (z toho zaplatených ${pred[0].zaplatene})`);
console.log(
  NAOSTRO ? "\nREŽIM: NAOSTRO — zmeny zostanú.\n" : "\nREŽIM: nasucho — vráti sa späť.\n",
);

let ok = false;
try {
  await c.query("begin");
  await c.query(sql);

  // Čo migrácia naozaj spravila.
  const { rows: stlpce } = await c.query(
    `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = 'orders'
        and (column_name like 'delivery\\_%' or column_name like 'eph\\_%'
             or column_name = 'posted_at')
      order by column_name`,
  );
  console.log("Nové stĺpce na orders:");
  for (const s of stlpce) {
    console.log(
      `  ${s.column_name.padEnd(18)} ${s.data_type.padEnd(26)}` +
        ` null:${s.is_nullable} default:${s.column_default ?? "—"}`,
    );
  }

  const { rows: kontroly } = await c.query(
    `select conname from pg_constraint
      where conname like 'orders_delivery%' order by conname`,
  );
  console.log("\nKontroly:", kontroly.map((k) => k.conname).join(", ") || "žiadne");

  const { rows: rozdelenie } = await c.query(
    `select delivery_method, count(*)::int as pocet,
            sum(delivery_fee)::numeric as poštovné
       from public.orders group by 1`,
  );
  console.log("\nAko skončia existujúce objednávky:");
  for (const r of rozdelenie) {
    console.log(`  ${r.delivery_method}: ${r.pocet} objednávok, poštovné ${r.poštovné} €`);
  }

  // Kontroly musia naozaj brániť nezmyslom. Skúsime ich obe prelomiť —
  // keď prejdú, migrácia nechráni nič a nemá sa commitnúť.
  for (const [co, dotaz] of [
    ["neznámy spôsob doručenia", "update public.orders set delivery_method = 'kurier'"],
    [
      "pošta bez adresy",
      "update public.orders set delivery_method = 'posta', delivery_name = null",
    ],
    ["záporné poštovné", "update public.orders set delivery_fee = -1"],
  ]) {
    await c.query("savepoint s");
    try {
      await c.query(dotaz);
      throw new Error(`KONTROLA NEDRŽÍ: databáza prijala ${co}`);
    } catch (e) {
      if (String(e.message).startsWith("KONTROLA NEDRŽÍ")) throw e;
      console.log(`  ✓ databáza odmietla: ${co}`);
    }
    await c.query("rollback to savepoint s");
  }

  if (NAOSTRO) {
    await c.query(
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ($1, $2, $3)
       on conflict (version) do nothing`,
      [VERZIA, "dorucenie_postou", [sql]],
    );
    await c.query("commit");
    console.log("\nCOMMIT — migrácia je v databáze a zapísaná v schema_migrations.");
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
