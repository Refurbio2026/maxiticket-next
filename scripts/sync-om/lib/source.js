// Spojenie do starého systému (MariaDB `bt_tickets` na RDS).
//
// **Read-only.** Sync do zdroja nikdy nezapisuje — nemá tam kurzory, outbox
// ani tombstony a produkčný účet (`eticketo_sync`) má len `SELECT`. Každé
// spojenie sa navyše prepne do read-only transakčného režimu, aby to platilo
// aj pri omyle v kóde.
//
// **Kódovanie.** Tabuľky zdroja nie sú v jednom charsete: `seat` a `seat_scan`
// sú `cp1250`, `storno_seat_log` je `utf8mb4`. Spojenie preto beží v
// **utf8mb4**, nie v cp1250 — MariaDB prekóduje cp1250 stĺpce na výstupe sama
// a klient dostane korektné UTF-8 z oboch skupín. Keby spojenie bežalo v
// cp1250, znaky mimo tejto stránky (emoji, typografické apostrofy) uložené
// v utf8mb4 tabuľkách by sa cestou ticho stratili. Normalizuje sa až v cieli,
// späť do zdroja sa nezapisuje nikdy.
//
// **Čas.** OM ukladá `datetime` bez zóny, v lokálnom čase prevádzky. Čítame
// preto ako reťazce (`dateStrings`) a na ISO ich prepočítavame sami podľa
// `OM_DB_TIMEZONE` — mysql2 by pri automatickej konverzii použil zónu procesu
// a v lete by sa všetko posunulo o hodinu.

import mysql from "mysql2/promise";
import { env } from "./env.js";

let pool;

export function zdroj() {
  if (!pool) {
    pool = mysql.createPool({
      host: env.om.host,
      port: env.om.port,
      user: env.om.user,
      password: env.om.password,
      database: env.om.database,
      charset: env.om.charset,
      dateStrings: true,
      // Veľké `bigint` (barcode, id_seat_scan) ako reťazce, nech ich
      // neznehodnotí presnosť čísla v JavaScripte.
      supportBigNumbers: true,
      bigNumberStrings: true,
      connectionLimit: 4,
      waitForConnections: true,
      timezone: "Z",
    });
  }
  return pool;
}

/** Dotaz na zdroj. Beží v read-only transakcii, takže zápis by spadol. */
export async function dotaz(sql, parametre = []) {
  const spojenie = await zdroj().getConnection();
  try {
    await spojenie.query("SET SESSION TRANSACTION READ ONLY");
    const [riadky] = await spojenie.query(sql, parametre);
    return riadky;
  } finally {
    await spojenie.query("SET SESSION TRANSACTION READ WRITE").catch(() => {});
    spojenie.release();
  }
}

export async function zavri() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

// --- Čas -------------------------------------------------------------------

function posunZonyMs(utcMs, zona) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const c = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const akoUtc = Date.UTC(+c.year, +c.month - 1, +c.day, +c.hour % 24, +c.minute, +c.second);
  return akoUtc - utcMs;
}

/**
 * `"2026-09-16 10:00:00"` v zóne zdroja → ISO v UTC.
 *
 * Dve kolá stačia: prvý odhad posunu môže padnúť do nesprávnej strany prechodu
 * na letný čas, druhý ho opraví.
 */
export function naIso(hodnota, zona = env.om.timezone) {
  if (hodnota === null || hodnota === undefined || hodnota === "") return null;
  if (hodnota instanceof Date) return hodnota.toISOString();
  const s = String(hodnota);
  // MariaDB vracia nulový dátum takto; je to „nevyplnené", nie rok nula.
  if (s.startsWith("0000-00-00")) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, Y, M, D, h = "0", mi = "0", se = "0"] = m;
  const naive = Date.UTC(+Y, +M - 1, +D, +h, +mi, +se);
  let utc = naive;
  for (let i = 0; i < 2; i++) utc = naive - posunZonyMs(utc, zona);
  return new Date(utc).toISOString();
}

/** `date` a `time` stĺpce idú do Postgresu tak, ako sú — zónu nemajú. */
export function naDatum(hodnota) {
  if (!hodnota) return null;
  const s = String(hodnota);
  return s.startsWith("0000-00-00") ? null : s.slice(0, 10);
}

export function naCas(hodnota) {
  if (!hodnota) return null;
  return String(hodnota).slice(0, 8);
}

/** `bit(1)` chodí z mysql2 ako Buffer, `tinyint` ako číslo. */
export function naCislo(hodnota) {
  if (hodnota === null || hodnota === undefined) return null;
  if (Buffer.isBuffer(hodnota)) return hodnota[0];
  const n = Number(hodnota);
  return Number.isFinite(n) ? n : null;
}

/**
 * Znaky, ktoré Postgres neprijme.
 *
 * NUL (`U+0000`) nesmie byť **ani v `text`, ani v `jsonb`** — pri zápise skončí
 * na „unsupported Unicode escape sequence". V OM sa vyskytuje (staré importy,
 * orezané reťazce z cp1250) a keďže do `raw` ukladáme celý riadok, stačí jeden
 * taký znak na to, aby padla celá dávka 1000 riadkov.
 *
 * Osamotený surrogát je ten istý problém z druhej strany: `JSON.stringify` z neho
 * urobí `\uD800`, čo jsonb odmietne rovnako. Nahrádza sa `U+FFFD`.
 *
 * Čistí sa **len smerom do cieľa**; do zdroja sa nezapisuje nikdy.
 */
function ocistiText(s) {
  // Rýchla cesta — drvivá väčšina reťazcov je v poriadku.
  if (!/[\u0000\uD800-\uDFFF]/.test(s)) return s;
  return s
    .replace(/\u0000/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "\uFFFD")
    .replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, "$1\uFFFD");
}

export function naText(hodnota) {
  if (hodnota === null || hodnota === undefined) return null;
  if (Buffer.isBuffer(hodnota)) return zBufferu(hodnota);
  return ocistiText(String(hodnota));
}

/**
 * Binárne stĺpce do `raw`.
 *
 * `bit(1)` chodí z mysql2 ako `Buffer` s jediným bajtom, takže `require_access_code`
 * s hodnotou 0 by ako text bol `U+0000` — a to je presne znak, ktorý Postgres
 * neprijme. Nie je to skazený zdroj, vyrába si to klient sám.
 *
 * Riadiace bajty preto nejdú cez UTF-8, ale ako hex (`0x00`). Je to jednoznačné
 * a nič sa nestratí; skutočný text ostáva čitateľný.
 */
function zBufferu(b) {
  const riadiace = b.some((bajt) => bajt < 0x09 || (bajt > 0x0d && bajt < 0x20));
  return riadiace ? "0x" + b.toString("hex") : ocistiText(b.toString("utf8"));
}

/**
 * Opak `naIso` — instant → `"YYYY-MM-DD HH:MM:SS"` v zóne zdroja.
 *
 * Kurzor kanála A sa drží v tvare, akému rozumie zdroj, takže sa do dotazu
 * dosadí bez ďalšieho prepočtu. Slúži aj na odpočítanie prekryvu.
 */
export function naLokalny(instant, zona = env.om.timezone) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zona,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  // `sv-SE` formátuje presne ako `YYYY-MM-DD HH:MM:SS`.
  return f.format(d).replace("T", " ");
}

/** Lokálny čas zdroja mínus `minut`, opäť ako lokálny reťazec. */
export function odpocitajMinuty(lokalny, minut, zona = env.om.timezone) {
  const iso = naIso(lokalny, zona);
  if (!iso) return null;
  return naLokalny(new Date(Date.parse(iso) - minut * 60_000), zona);
}
