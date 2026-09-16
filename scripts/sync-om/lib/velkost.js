// Poistka proti zaplneniu disku Supabase.
//
// Vzniklo to z reálneho incidentu 16. 9. 2026: backfill dev dát naplnil
// produkčnú databázu z 29 MB na 982 MB, Postgres prepol do read-only a jeden
// backend spadol. Aplikácia v tom čase nestihla prísť o objednávku, ale pokus
// o nákup by zlyhal.
//
// Preto sa **pred každou dávkou** prečíta `pg_database_size()` a nad limitom
// sa kanál zastaví s chybou do `om_sync_cursor`. Limit je povinný — bez
// `OM_DB_SIZE_LIMIT_MB` worker odmietne bežať, aby sa na poistku nedalo
// zabudnúť.
//
// Veľkosť sa nedá prečítať cez PostgREST (nie je na to funkcia a schému
// meniť nechceme), preto sa ide priamo na Postgres cez pooler.

import pg from "pg";
import { env } from "./env.js";

let klient;
let pripajanie;

async function spojenie() {
  if (klient) return klient;
  if (!pripajanie) {
    const c = new pg.Client({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      database: env.db.database,
      ssl: { rejectUnauthorized: false },
      // Poistka nesmie zdržať sync viac než na okamih.
      connectionTimeoutMillis: 10_000,
      query_timeout: 10_000,
    });
    pripajanie = c.connect().then(() => {
      klient = c;
      return c;
    });
  }
  return pripajanie;
}

/** Veľkosť cieľovej databázy v MB. */
export async function velkostDbMb() {
  const c = await spojenie();
  const { rows } = await c.query("select pg_database_size(current_database()) as b");
  return Number(rows[0].b) / (1024 * 1024);
}

export async function zavriVelkost() {
  if (klient) {
    await klient.end().catch(() => {});
    klient = undefined;
    pripajanie = undefined;
  }
}

export class PrekrocenyLimit extends Error {
  constructor(mb, limit) {
    super(
      `Cieľová databáza má ${mb.toFixed(0)} MB, limit je ${limit} MB. ` +
        `Sync zastavený, aby nezaplnil disk. Zväčši disk alebo zníž objem (--since), ` +
        `potom nastav OM_DB_SIZE_LIMIT_MB v scripts/sync-om/.env.`,
    );
    this.name = "PrekrocenyLimit";
    this.mb = mb;
    this.limit = limit;
  }
}

/**
 * Zastaví beh, keď je databáza nad limitom. Volá sa pred každou dávkou —
 * `pg_database_size` je lacné (číta veľkosti súborov) a pri ~900 dávkach
 * to spolu robí sekundy.
 */
export async function overLimit(log, citaj = velkostDbMb) {
  const limit = env.limitMb;
  const mb = await citaj();
  if (mb > limit) {
    log?.error("limit veľkosti databázy prekročený", { mb: Math.round(mb), limit });
    throw new PrekrocenyLimit(mb, limit);
  }
  return mb;
}
