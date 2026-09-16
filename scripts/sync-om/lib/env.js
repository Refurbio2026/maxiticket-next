// Načítanie konfigurácie. Poradie zdrojov: prostredie procesu → `scripts/sync-om/.env`
// → `/opt/maxiticket/.env`.
//
// Prístupy k Supabase sa zámerne **nekopírujú** do `scripts/sync-om/.env` —
// service key už na serveri je a druhá kópia je druhé miesto, odkiaľ môže
// uniknúť. V lokálnom `.env` sú len prístupy k starému systému.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const koren = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimálny parser `.env` — bez závislosti, bez interpolácie. */
function precitaj(cesta) {
  if (!existsSync(cesta)) return {};
  const out = {};
  for (const riadok of readFileSync(cesta, "utf8").split("\n")) {
    const t = riadok.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const kluc = t.slice(0, i).trim();
    let hodnota = t.slice(i + 1).trim();
    if (
      (hodnota.startsWith('"') && hodnota.endsWith('"')) ||
      (hodnota.startsWith("'") && hodnota.endsWith("'"))
    ) {
      hodnota = hodnota.slice(1, -1);
    }
    out[kluc] = hodnota;
  }
  return out;
}

const lokalne = precitaj(resolve(koren, ".env"));
const serverove = precitaj("/opt/maxiticket/.env");

function vezmi(...kluce) {
  for (const k of kluce) {
    const v = process.env[k] ?? lokalne[k] ?? serverove[k];
    if (v) return v;
  }
  return undefined;
}

export const env = {
  om: {
    host: vezmi("OM_DB_HOST"),
    user: vezmi("OM_DB_USER"),
    password: vezmi("OM_DB_PASS", "OM_DB_PASSWORD"),
    database: vezmi("OM_DB_NAME") ?? "bt_tickets",
    port: Number(vezmi("OM_DB_PORT") ?? 3306),
    // Spojenie beží v utf8mb4, nie v cp1250 — vysvetlenie v lib/source.js.
    charset: vezmi("OM_DB_CHARSET") ?? "UTF8MB4_UNICODE_CI",
    // OM ukladá `datetime` bez zóny, v lokálnom čase prevádzky.
    timezone: vezmi("OM_DB_TIMEZONE") ?? "Europe/Bratislava",
  },
  supabase: {
    url: vezmi("SUPABASE_URL", "VITE_SUPABASE_URL"),
    serviceKey: vezmi("SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
  },
  // Priame spojenie na Postgres — len na `pg_database_size()` pre poistku.
  // PostgREST veľkosť databázy neponúka a schému kvôli tomu meniť nechceme.
  db: {
    host: vezmi("SUPABASE_DB_HOST") ?? "aws-1-eu-west-1.pooler.supabase.com",
    port: Number(vezmi("SUPABASE_DB_PORT") ?? 5432),
    user: vezmi("SUPABASE_DB_USER") ?? (refProjektu() ? `postgres.${refProjektu()}` : undefined),
    password: vezmi("SUPABASE_DB_PASSWORD"),
    database: vezmi("SUPABASE_DB_NAME") ?? "postgres",
  },
  // Strop veľkosti cieľovej databázy. Povinný — pozri lib/velkost.js.
  limitMb: vezmi("OM_DB_SIZE_LIMIT_MB") ? Number(vezmi("OM_DB_SIZE_LIMIT_MB")) : null,
};

/** Ref projektu z `SUPABASE_URL` (https://<ref>.supabase.co). */
function refProjektu() {
  const url = vezmi("SUPABASE_URL", "VITE_SUPABASE_URL");
  return url?.match(/https:\/\/([a-z0-9]+)\.supabase\./)?.[1];
}

/** Zoznam chýbajúcich premenných — prázdny znamená, že sa dá bežať. */
export function chybajuce({ potrebujeZdroj = true, potrebujeCiel = true } = {}) {
  const ch = [];
  if (potrebujeZdroj) {
    if (!env.om.host) ch.push("OM_DB_HOST");
    if (!env.om.user) ch.push("OM_DB_USER");
    if (!env.om.password) ch.push("OM_DB_PASS");
  }
  if (potrebujeCiel) {
    if (!env.supabase.url) ch.push("SUPABASE_URL");
    if (!env.supabase.serviceKey) ch.push("SUPABASE_SERVICE_KEY");
    // Poistka proti zaplneniu disku je povinná — bez nej sa nesmie bežať.
    // Backfill 16. 9. 2026 bez nej naplnil produkčnú databázu a prepol ju do
    // read-only; nech sa na ňu nedá zabudnúť.
    if (!env.limitMb || !Number.isFinite(env.limitMb) || env.limitMb <= 0) {
      ch.push("OM_DB_SIZE_LIMIT_MB (strop veľkosti cieľovej databázy v MB)");
    }
    if (!env.db.password) ch.push("SUPABASE_DB_PASSWORD (na čítanie pg_database_size)");
    if (!env.db.user) ch.push("SUPABASE_DB_USER");
  }
  // Zástupný text z prvého nastavenia je horší než chýbajúca hodnota:
  // pripojenie by zlyhalo na hesle a vyzeralo by to ako problém so sieťou.
  if (potrebujeZdroj && env.om.password && /^<.*>$/.test(env.om.password)) {
    ch.push("OM_DB_PASS (je tam zástupný text `" + env.om.password + "`)");
  }
  return ch;
}
