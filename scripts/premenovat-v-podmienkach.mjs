#!/usr/bin/env node
// Starý názov MaxiTicket → eticketo.eu v právnych textoch.
//
// PREČO TO NIE JE „nájdi a nahraď": názov sa v textoch vyskytuje v troch
// rôznych úlohách a jedna z nich sa meniť NESMIE.
//
//  1. OBCHODNÉ MENO SPOLOČNOSTI — „MaxiTicket s.r.o., Drevárska 23,
//     902 01 Pezinok, IČO 53…". To je skutočná zapísaná firma, zmluvná
//     strana. Prepísať ju na „eticketo.eu s.r.o." by znamenalo, že zmluva
//     menuje neexistujúci subjekt. ZOSTÁVA NEDOTKNUTÉ.
//  2. ZAVEDENÁ SKRATKA — podmienky si názov zavádzajú ako „(ďalej len
//     „MaxiTicket")" a potom ho používajú ako označenie strany. Mení sa aj
//     definícia, aj všetky použitia, inak by text používal skratku, ktorú
//     si nikde nezaviedol.
//  3. NÁZOV SYSTÉMU — „systém MaxiTicket". Systém sa už inde v tých istých
//     textoch volá „eticketo" („služby systému eticketo"), takže sa
//     zjednocuje na to.
//
// Navyše je v podmienkach veta o prechode zo starého systému; po premenovaní
// skratky by si protirečila, preto sa prepisuje zvlášť.
//
// POUŽITIE:
//   node scripts/premenovat-v-podmienkach.mjs            # nasucho, ukáže zmeny
//   node scripts/premenovat-v-podmienkach.mjs naostro    # zapíše
import fs from "node:fs";
import pg from "../node_modules/pg/lib/index.js";

const NAOSTRO = process.argv[2] === "naostro";
const STRANKY = ["obchodne-podmienky", "ochrana-osobnych-udajov", "reklamacny-poriadok"];

/** Zástupný znak, pod ktorým je obchodné meno v bezpečí pred zámenami. */
const CHRANENE = "\u0000FIRMA\u0000";

/**
 * Zámeny v poradí, v akom sa vykonávajú. Dlhšie tvary musia ísť prvé —
 * inak by „systém MaxiTicket" skončilo ako „systém eticketo.eu".
 *
 * POZOR NA MEDZERU: v texte je pred názvom miestami NEDELITEĽNÁ medzera
 * (U+00A0), nie obyčajná. Pri porovnávaní na presný reťazec pravidlo
 * nezaberie a názov spadne do všeobecnej zámeny — v bode 1.3 takto vyšlo
 * „využíva systém eticketo.eu" namiesto „systém eticketo". Preto regulárne
 * výrazy s `[\s\u00a0]`.
 */
const ZAMENY = [
  // Názov systému, vo všetkých pádoch, ktoré sa v textoch vyskytujú.
  // Pád zostáva, mení sa len názov.
  [/(Systém|systém|systéme|systému)[\s\u00a0]+MaxiTicket/g, "$1 eticketo"],
  // Zavedenie skratky.
  [/\(ďalej[\s\u00a0]+len[\s\u00a0]+[„"]MaxiTicket[“"]\)/g, "(ďalej len „eticketo.eu“)"],
  // Veta, ktorá vysvetľovala, čo skratka znamená.
  [
    /Tam,[\s\u00a0]+kde[\s\u00a0]+sa[\s\u00a0]+ďalej[\s\u00a0]+hovorí[\s\u00a0]+o[\s\u00a0]+MaxiTicket/g,
    "Tam, kde sa ďalej hovorí o eticketo.eu",
  ],
];

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

function prepis(telo) {
  // 1. Obchodné meno do bezpečia. Berie sa aj tvar s medzerou pred „s.r.o."
  //    a s čiarkou za ním, aby nezostal nechránený žiadny výskyt.
  let t = telo.replace(/MaxiTicket\s+s\.r\.o\./g, CHRANENE);

  // 2. Veta o prechode.
  t = t.replace(
    /Tieto[\s\u00a0]+podmienky[\s\u00a0]+prevzalo[\s\u00a0]+eticketo\.eu[\s\u00a0]+z[\s\u00a0]+predchádzajúceho[\s\u00a0]+systému[\s\u00a0]+MaxiTicket;/g,
    "Tieto podmienky prevzalo eticketo.eu z predchádzajúceho systému;",
  );

  // 3. Zámeny v poradí.
  for (const [od, na] of ZAMENY) t = t.replace(od, na);

  // 4. Všetko ostatné je už len skratka označujúca stranu.
  t = t.split("MaxiTicket").join("eticketo.eu");

  // 5. Obchodné meno späť.
  return t.split(CHRANENE).join("MaxiTicket s.r.o.");
}

let zmenenych = 0;
const naZapis = [];

for (const slug of STRANKY) {
  const { rows } = await c.query("select body from public.site_pages where slug = $1", [slug]);
  if (!rows.length) {
    console.error(`Stránka ${slug} sa nenašla.`);
    continue;
  }
  const pred = rows[0].body;
  const po = prepis(pred);

  const pocetPred = (pred.match(/MaxiTicket/g) || []).length;
  const pocetPo = (po.match(/MaxiTicket/g) || []).length;
  const firmaPo = (po.match(/MaxiTicket s\.r\.o\./g) || []).length;

  console.log(`\n======== ${slug} ========`);
  console.log(
    `  „MaxiTicket" pred: ${pocetPred}  po: ${pocetPo}  (z toho obchodné meno: ${firmaPo})`,
  );

  // POISTKA 2: systém sa volá „eticketo", stránka „eticketo.eu". Keby
  // v texte vzniklo „systém eticketo.eu", znamená to, že názov systému
  // spadol do všeobecnej zámeny — presne to spôsobila nedeliteľná medzera.
  const zleSystem = [...po.matchAll(/(Systém|systém|systéme|systému)[\s\u00a0]+eticketo\.eu/g)];
  if (zleSystem.length) {
    console.error(
      `  ZASTAVENÉ: ${zleSystem.length}× „${zleSystem[0][0]}" — systém sa volá eticketo, nie eticketo.eu.`,
    );
    await c.end();
    process.exit(1);
  }

  // POISTKA: po zámene smie názov zostať LEN ako obchodné meno. Keby zostal
  // inde, zámena niečo prehliadla a text by miešal dva názvy.
  if (pocetPo !== firmaPo) {
    const zabudnute = [...po.matchAll(/.{0,40}MaxiTicket(?! s\.r\.o\.).{0,30}/g)].map((m) =>
      m[0].replace(/\s+/g, " "),
    );
    console.error("  ZASTAVENÉ: zostal výskyt, ktorý nie je obchodné meno:");
    for (const z of zabudnute) console.error("    …" + z + "…");
    await c.end();
    process.exit(1);
  }

  if (pred === po) {
    console.log("  nič na zmenu");
    continue;
  }

  // Ukážeme riadky, ktoré sa zmenili — nie celý text.
  const rPred = pred.split("\n");
  const rPo = po.split("\n");
  let ukazanych = 0;
  for (let i = 0; i < Math.max(rPred.length, rPo.length); i++) {
    if (rPred[i] === rPo[i]) continue;
    if (ukazanych >= 6) {
      console.log("  … (ďalšie zmenené riadky vynechané)");
      break;
    }
    console.log(`\n  − ${(rPred[i] ?? "").slice(0, 150)}`);
    console.log(`  + ${(rPo[i] ?? "").slice(0, 150)}`);
    ukazanych++;
  }
  zmenenych++;
  naZapis.push([slug, po]);
}

if (!naZapis.length) {
  console.log("\nNič na zmenu.");
  await c.end();
  process.exit(0);
}

if (!NAOSTRO) {
  console.log(
    `\nNASUCHO — ${zmenenych} stránok by sa zmenilo, v databáze nič. Spusť s \`naostro\`.`,
  );
  await c.end();
  process.exit(0);
}

await c.query("begin");
try {
  for (const [slug, telo] of naZapis) {
    const r = await c.query(
      "update public.site_pages set body = $1, updated_at = now() where slug = $2",
      [telo, slug],
    );
    if (r.rowCount !== 1) throw new Error(`${slug}: upravených ${r.rowCount}, očakával sa 1`);
  }
  await c.query("commit");
  console.log(`\nZAPÍSANÉ — stránok: ${naZapis.length}. Obchodné meno zostalo nedotknuté.`);
} catch (e) {
  await c.query("rollback");
  console.error("\nZLYHALO, vrátené späť:", e.message);
  process.exitCode = 1;
}
await c.end();
