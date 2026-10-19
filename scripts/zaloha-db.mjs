#!/usr/bin/env node
// Nočná logická záloha našich dát z ostrej Supabase databázy.
//
// Prečo takto a nie `pg_dump`: na tomto stroji nie je nainštalovaný klient
// Postgresu ani Supabase CLI a inštalovať ich na ostrý server pre jednu úlohu
// sa neoplatí. Záloha preto vznikne priamo cez `pg` — tabuľka po tabuľke do
// `.jsonl.gz`, celá v jednej transakcii REPEATABLE READ, takže všetky súbory
// zodpovedajú tomu istému okamihu.
//
// ČO ZÁLOHA OBSAHUJE
//   Všetky tabuľky v `public` okrem dvoch skupín:
//     * zrkadlo starého systému (`om_tickets`, `om_orders`, `om_events`, …) —
//       dá sa kedykoľvek natiahnuť znova syncom, a je to 150 MB z 205;
//     * logy (`job_runs`, `om_reconcile_log`, `rate_limits`) — po obnove
//       nemajú hodnotu.
//   Ľudské rozhodnutia zo starého systému (`om_event_map`, `om_promoter_map`)
//   aj naše skeny starých vstupeniek (`om_ticket_scans`) sa zálohujú —
//   tie sync neobnoví.
//
// ČO ZÁLOHA NEOBSAHUJE (vedome)
//   * Schému. Tá žije v `supabase/migrations` v gite; manifest si preto
//     zapisuje aj poslednú prehranú migráciu, aby bolo jasné, ku ktorému
//     stavu schémy dáta patria.
//   * Účty z `auth.users` (vrátane hashov hesiel). Nechcem mať hashy hesiel
//     v súbore na tom istom disku; obnova účtov stojí na zálohe Supabase.
//     `profiles` aj `user_roles`, teda aplikačná časť, v zálohe sú.
//
// OBNOVA
//   1. prehrať migrácie z gitu na čistú databázu,
//   2. `node scripts/zaloha-db.mjs --obnov <priečinok>` zatiaľ NEEXISTUJE —
//      obnova je vedomý, ručný krok: súbory sú `.jsonl.gz`, jeden riadok =
//      jeden záznam, takže sa dajú vložiť `insert`-om v poradí podľa
//      `manifest.json` (je v ňom poradie rešpektujúce cudzie kľúče).
//
// Spúšťa to cron; pozri `scripts/zaloha-cron.sh`.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import pg from "../node_modules/pg/lib/index.js";

const KAM = process.env.ZALOHA_DIR ?? "/opt/maxiticket/backup";
const KOLKO_NECHAT = Number(process.env.ZALOHA_KEEP ?? 14);
const DAVKA = 2000;

// Zrkadlo starého systému a logy. Všetko ostatné sa zálohuje — vrátane tabuliek,
// ktoré ešte len vzniknú, aby sa na novú tabuľku nezabudlo.
const PRESKOCIT = new Set([
  "om_tickets",
  "om_orders",
  "om_events",
  "om_persons",
  "om_scans",
  "om_seat_history",
  "om_storno_log",
  "om_refunds",
  "om_seat_status",
  "om_reconcile_log",
  "job_runs",
  "rate_limits",
]);

function log(sprava) {
  console.log(`${new Date().toISOString()} [zaloha] ${sprava}`);
}

function pristupy() {
  const env = {};
  for (const line of fs.readFileSync("/opt/maxiticket/.env", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
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
  };
}

/** Tabuľky v poradí, v ktorom sa dajú vkladať bez narazenia na cudzí kľúč. */
async function poradieTabuliek(c) {
  // `string_agg` a nie `array_agg`: s `coalesce(..., '{}')` vracia ovládač
  // pole ako text a `.filter` nad ním potom padne.
  const { rows } = await c.query(`
    select c.relname as tabulka,
           coalesce(string_agg(distinct f.relname, ',') filter (where f.relname is not null and f.relname <> c.relname), '') as zavisi_na
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_constraint con on con.conrelid = c.oid and con.contype = 'f'
    left join pg_class f on f.oid = con.confrelid
    where n.nspname = 'public' and c.relkind = 'r'
    group by c.relname
    order by c.relname`);

  const zavislosti = new Map(
    rows.map((r) => [r.tabulka, r.zavisi_na ? String(r.zavisi_na).split(",") : []]),
  );
  const vsetky = rows.map((r) => r.tabulka).filter((t) => !PRESKOCIT.has(t));
  const hotove = [];
  const vlozene = new Set();

  // Jednoduché topologické radenie. Kruh (dve tabuľky na seba) by zacyklil,
  // preto je tam strop na počet prechodov a zvyšok sa pridá tak, ako je.
  for (let prechod = 0; prechod < 20 && vlozene.size < vsetky.length; prechod++) {
    for (const t of vsetky) {
      if (vlozene.has(t)) continue;
      const nesplnene = (zavislosti.get(t) ?? []).filter(
        (z) => vsetky.includes(z) && !vlozene.has(z),
      );
      if (nesplnene.length === 0) {
        hotove.push(t);
        vlozene.add(t);
      }
    }
  }
  for (const t of vsetky) if (!vlozene.has(t)) hotove.push(t);
  return hotove;
}

async function zalohujTabulku(c, tabulka, kam) {
  const { rows: pocet } = await c.query(`select count(*)::int as n from public."${tabulka}"`);
  const n = pocet[0].n;
  const cesta = path.join(kam, `${tabulka}.jsonl.gz`);

  const gzip = zlib.createGzip({ level: 6 });
  const zapis = fs.createWriteStream(cesta, { mode: 0o600 });
  const hotovo = pipeline(gzip, zapis);

  let vypisanych = 0;
  // Stránkuje sa podľa `ctid`, ktorý je v rámci jednej REPEATABLE READ
  // transakcie stabilný a nepotrebuje primárny kľúč — niektoré tabuľky
  // (napr. nastavenia s jedným riadkom) ho majú zvláštny.
  let posledny = "(0,0)";
  for (;;) {
    const { rows } = await c.query(
      `select ctid::text as _ctid, t.* from public."${tabulka}" t
       where ctid > $1::tid order by ctid limit ${DAVKA}`,
      [posledny],
    );
    if (rows.length === 0) break;
    posledny = rows[rows.length - 1]._ctid;
    for (const r of rows) {
      delete r._ctid;
      if (!gzip.write(`${JSON.stringify(r)}\n`)) {
        await new Promise((res) => gzip.once("drain", res));
      }
      vypisanych++;
    }
  }
  gzip.end();
  await hotovo;

  const velkost = fs.statSync(cesta).size;
  if (vypisanych !== n) {
    log(`POZOR ${tabulka}: count hlási ${n}, vypísaných ${vypisanych}`);
  }
  return { tabulka, riadkov: vypisanych, bajtov: velkost };
}

/**
 * Metadáta účtov z `auth.users` — zámerne BEZ hashov hesiel a bez tokenov.
 *
 * Doteraz v zálohe nebolo o účtoch nič, takže po strate projektu by sa
 * nevedelo ani to, kto účet mal. Takto sa účty dajú znova vytvoriť cez
 * Admin API a ľudia si heslo nastavia resetom. Hashy tu nechceme — to bol
 * pôvodný dôvod, prečo sa `auth.users` nezálohovala vôbec.
 */
async function zalohujUcty(c, kam) {
  const STLPCE = [
    "id",
    "aud",
    "role",
    "email",
    "phone",
    "email_confirmed_at",
    "phone_confirmed_at",
    "confirmed_at",
    "invited_at",
    "last_sign_in_at",
    "banned_until",
    "deleted_at",
    "is_sso_user",
    "is_anonymous",
    "raw_app_meta_data",
    "raw_user_meta_data",
    "created_at",
    "updated_at",
  ];
  const cesta = path.join(kam, "auth_users_metadata.jsonl.gz");
  const { rows } = await c.query(
    `select ${STLPCE.map((x) => `"${x}"`).join(", ")} from auth.users order by created_at`,
  );

  const gzip = zlib.createGzip({ level: 6 });
  const hotovo = pipeline(gzip, fs.createWriteStream(cesta, { mode: 0o600 }));
  for (const r of rows) {
    if (!gzip.write(`${JSON.stringify(r)}\n`)) {
      await new Promise((res) => gzip.once("drain", res));
    }
  }
  gzip.end();
  await hotovo;

  return { tabulka: "auth.users (metadáta)", riadkov: rows.length, bajtov: fs.statSync(cesta).size };
}

function uprav(kam) {
  const behy = fs
    .readdirSync(kam, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{8}-\d{4}$/.test(e.name))
    .map((e) => e.name)
    .sort();
  const navyse = behy.slice(0, Math.max(0, behy.length - KOLKO_NECHAT));
  for (const b of navyse) {
    fs.rmSync(path.join(kam, b), { recursive: true, force: true });
    log(`zmazaná stará záloha ${b}`);
  }
  return navyse.length;
}

const zacatok = Date.now();
const c = new pg.Client(pristupy());
await c.connect();

let kam;
try {
  const teraz = new Date();
  const znacka =
    teraz.toISOString().slice(0, 10).replace(/-/g, "") +
    "-" +
    teraz.toISOString().slice(11, 16).replace(":", "");
  fs.mkdirSync(KAM, { recursive: true, mode: 0o700 });
  kam = path.join(KAM, znacka);
  fs.mkdirSync(kam, { mode: 0o700 });

  // Jedna transakcia = jeden konzistentný obraz databázy.
  await c.query("begin transaction isolation level repeatable read read only");

  const tabulky = await poradieTabuliek(c);
  log(`zálohujem ${tabulky.length} tabuliek do ${kam}`);

  const vysledky = [];
  for (const t of tabulky) vysledky.push(await zalohujTabulku(c, t, kam));

  // V tej istej transakcii, nech účty zodpovedajú tomu istému okamihu.
  const ucty = await zalohujUcty(c, kam);
  log(`účty: ${ucty.riadkov} metadát (bez hashov hesiel)`);

  const { rows: migracie } = await c.query(
    "select version from supabase_migrations.schema_migrations order by version desc limit 1",
  );
  const { rows: velkost } = await c.query(
    "select pg_database_size(current_database())::bigint as b",
  );
  await c.query("commit");

  const manifest = {
    vzniklo: teraz.toISOString(),
    posledna_migracia: migracie[0]?.version ?? null,
    velkost_databazy_mb: Math.round(Number(velkost[0].b) / (1024 * 1024)),
    preskocene_tabulky: [...PRESKOCIT],
    neobsahuje: [
      "schému (je v git: supabase/migrations)",
      "hashe hesiel z auth.users — účty sa obnovia cez Admin API a reset hesla",
    ],
    ucty: ucty,
    poradie_vkladania: vysledky.map((v) => v.tabulka),
    tabulky: vysledky,
    riadkov_spolu: vysledky.reduce((s, v) => s + v.riadkov, 0),
    bajtov_spolu: vysledky.reduce((s, v) => s + v.bajtov, 0) + ucty.bajtov,
    trvalo_s: Math.round((Date.now() - zacatok) / 1000),
  };
  fs.writeFileSync(path.join(kam, "manifest.json"), JSON.stringify(manifest, null, 1), {
    mode: 0o600,
  });

  const mb = (manifest.bajtov_spolu / (1024 * 1024)).toFixed(1);
  log(
    `hotovo: ${manifest.riadkov_spolu} riadkov, ${mb} MB, ${manifest.trvalo_s} s, migrácia ${manifest.posledna_migracia}`,
  );
  const zmazanych = uprav(KAM);
  log(`nechávam ${KOLKO_NECHAT} najnovších záloh (teraz zmazaných ${zmazanych})`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  log(`ZLYHALO: ${e.message}`);
  // Nedokončená záloha je horšia než žiadna — nech po sebe nezostane.
  if (kam && fs.existsSync(kam)) {
    fs.rmSync(kam, { recursive: true, force: true });
    log("rozrobená záloha zmazaná");
  }
  process.exitCode = 1;
} finally {
  await c.end();
}
