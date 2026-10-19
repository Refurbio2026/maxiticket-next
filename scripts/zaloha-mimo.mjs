#!/usr/bin/env node
// Kópia nočnej zálohy mimo tohto stroja — do súkromného bucketu v Supabase.
//
// PREČO: záloha dosiaľ ležala len v /opt/maxiticket/backup, čiže na tom istom
// serveri. Chránila pred omylom v dátach, nie pred stratou stroja.
//
// ČO TO NEDOKÁŽE: je to ten istý poskytovateľ, kde beží databáza. Chráni pred
// stratou tohto servera, nie pred stratou účtu v Supabase. Na to treba ešte
// tretie miesto (k Patrikovi alebo do iného úložiska) — tento skript je prvý
// krok, nie celé riešenie.
//
// Bucket `zalohy` je súkromný; bez servisného kľúča sa k nemu nikto nedostane.
//
//   node scripts/zaloha-mimo.mjs [priečinok-zálohy]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ZALOHY = process.env.ZALOHA_DIR ?? "/opt/maxiticket/backup";
const BUCKET = process.env.ZALOHA_BUCKET ?? "zalohy";
const KOLKO_NECHAT = Number(process.env.ZALOHA_MIMO_KEEP ?? 14);

function nacitajEnv(cesta = "/opt/maxiticket/.env") {
  const env = { ...process.env };
  if (!fs.existsSync(cesta)) return env;
  for (const riadok of fs.readFileSync(cesta, "utf8").split("\n")) {
    const m = riadok.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return env;
}

const log = (s) => console.log(`${new Date().toISOString()} [zaloha-mimo] ${s}`);

function najnovsia() {
  const d = fs
    .readdirSync(ZALOHY)
    .filter((x) => /^\d{8}-\d{4}$/.test(x))
    .sort();
  if (!d.length) throw new Error(`v ${ZALOHY} nie je žiadna záloha`);
  return d[d.length - 1];
}

async function supabase(env, cesta, moznosti = {}) {
  const url = `${env.SUPABASE_URL}/storage/v1${cesta}`;
  const r = await fetch(url, {
    ...moznosti,
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      ...(moznosti.headers ?? {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${cesta} → HTTP ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function zalozBucket(env) {
  const buckety = await supabase(env, "/bucket");
  if (buckety.some((b) => b.id === BUCKET)) return false;
  await supabase(env, "/bucket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false,
      allowed_mime_types: ["application/gzip"],
      // 50 MB: projekt má nižší globálny strop a vyššia hodnota skončí na 413.
      // Archív má dnes 3,8 MB, takže je to s veľkou rezervou.
      file_size_limit: 52428800,
    }),
  });
  return true;
}

async function main() {
  const env = nacitajEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("v /opt/maxiticket/.env chýba SUPABASE_URL alebo SUPABASE_SERVICE_ROLE_KEY");
  }

  const nazov = process.argv[2] ? path.basename(path.resolve(process.argv[2])) : najnovsia();
  const priecinok = path.join(ZALOHY, nazov);
  if (!fs.existsSync(path.join(priecinok, "manifest.json"))) {
    throw new Error(`${priecinok} nevyzerá ako záloha — chýba manifest.json`);
  }

  if (await zalozBucket(env)) log(`bucket ${BUCKET} vytvorený (súkromný)`);

  // Jeden archív, nie 63 súborov: nahranie je potom buď celé, alebo žiadne.
  const archiv = path.join(os.tmpdir(), `${nazov}.tar.gz`);
  execFileSync("tar", ["-czf", archiv, "-C", ZALOHY, nazov]);
  const data = fs.readFileSync(archiv);
  fs.unlinkSync(archiv);

  const kam = `/object/${BUCKET}/${nazov}.tar.gz`;
  await supabase(env, kam, {
    method: "POST",
    headers: { "Content-Type": "application/gzip", "x-upsert": "true" },
    body: data,
  });
  const mb = (data.length / (1024 * 1024)).toFixed(1);
  log(`nahrané ${nazov}.tar.gz (${mb} MB)`);

  // Overenie, že tam naozaj je a má tú veľkosť — bez toho je to len nádej.
  const zoznam = await supabase(env, `/object/list/${BUCKET}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 1000, sortBy: { column: "name", order: "asc" } }),
  });
  const nahrane = zoznam.find((o) => o.name === `${nazov}.tar.gz`);
  if (!nahrane) throw new Error("nahrané, ale v bucketi sa nenašlo");
  const vzdialenych = nahrane.metadata?.size ?? 0;
  if (vzdialenych !== data.length) {
    throw new Error(`veľkosť nesedí: lokálne ${data.length}, vzdialene ${vzdialenych}`);
  }
  log(`overené: ${vzdialenych} bajtov sedí`);

  // Držať rovnako veľa ako lokálne, nech to nerastie bez stropu.
  const archivy = zoznam
    .filter((o) => /^\d{8}-\d{4}\.tar\.gz$/.test(o.name))
    .map((o) => o.name)
    .sort();
  const navyse = archivy.slice(0, Math.max(0, archivy.length - KOLKO_NECHAT));
  if (navyse.length) {
    await supabase(env, `/object/${BUCKET}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: navyse }),
    });
    log(`zmazané staré: ${navyse.join(", ")}`);
  }
  log(`mimo stroja je ${Math.min(archivy.length, KOLKO_NECHAT)} záloh`);
}

main().catch((e) => {
  console.error(`${new Date().toISOString()} [zaloha-mimo] ZLYHALO: ${e.message}`);
  process.exit(1);
});
