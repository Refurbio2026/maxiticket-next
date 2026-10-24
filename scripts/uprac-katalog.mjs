#!/usr/bin/env node
// Jednorazové upratanie katalógu + oprava bodu 3.3 obchodných podmienok.
//
// PREČO: vo verejnej ponuke boli položky, ktoré sa nepredávajú — 18 variantov
// „Y4Trade", predplatné Herogame a štyri skúšobné podujatia. Pri schvaľovaní
// platby kartou sa na obchod pozerá človek z ComGate a toto je prvé, čo uvidí.
// Zároveň bod 3.3 podmienok uvádzal platbu cez Cardpay a Tatrabanku, teda
// bránu, ktorú nepoužívame.
//
// ČO ROBÍ: podujatia LEN prepne na koncept (`status = draft`), nemaže ich —
// dajú sa kedykoľvek vrátiť do predaja. Pôvodné znenie podmienok sa pred
// zápisom odloží do súboru.
//
// POUŽITIE:
//   node scripts/uprac-katalog.mjs          # len vypíše, čo by spravil
//   node scripts/uprac-katalog.mjs zapis    # vykoná zmeny
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const l of fs.readFileSync("/opt/maxiticket/.env", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const ZAPISAT = process.argv[2] === "zapis";

// ---------- A. Katalóg ----------
// Bez spojenia na profily — vzťah sa cez PostgREST nedá pomenovať a dotaz
// by vrátil prázdno. Organizátora si dotiahneme zvlášť.
const { data: vsetky, error: chybaE } = await db
  .from("events")
  .select("id, title, status, event_date, organizer_id")
  .eq("status", "published");
if (chybaE) {
  console.log("CHYBA pri čítaní podujatí:", chybaE.message);
  process.exit(1);
}
const { data: profily } = await db.from("profiles").select("id, full_name, company_name");
const kto = (id) => {
  const p = (profily ?? []).find((x) => x.id === id);
  return p?.company_name || p?.full_name || "?";
};

const schovat = (vsetky ?? []).filter((e) => {
  const organizator = kto(e.organizer_id);
  return (
    e.title.startsWith("Y4Trade") ||
    e.title.startsWith("Herogame") ||
    e.title.startsWith("TEST – nekupovať") ||
    e.title.startsWith("SKÚŠKA predaja") ||
    organizator === "y4"
  );
});

console.log(`\n=== A. KATALÓG: ${schovat.length} podujatí na prepnutie do konceptu ===`);
for (const e of schovat) {
  console.log(` - ${e.event_date.slice(0, 10)}  ${e.title}  (organizátor: ${kto(e.organizer_id)})`);
}
const zostanu = (vsetky ?? []).filter((e) => !schovat.includes(e));
console.log(`\nV ponuke zostane ${zostanu.length}:`);
for (const e of zostanu)
  console.log(` + ${e.event_date.slice(0, 10)}  ${e.title}  (${kto(e.organizer_id)})`);

// ---------- B. Obchodné podmienky ----------
const { data: stranka } = await db
  .from("site_pages")
  .select("id, body")
  .eq("slug", "obchodne-podmienky")
  .maybeSingle();
const STARE =
  "3.3 V prípade internetového nákupu je možné konečnú, resp. výslednú cenu vybraných vstupeniek uhradiť platobnou kartou prostredníctvom služby Cardpay (platba cez virtuálny POS terminál Tatrabanky). Platbu je možné realizovať platobnou kartou VISA alebo EUROCARD/MASTERCARD, vydanou ktoroukoľvek bankovou inštitúciou.";
const NOVE =
  "3.3 V prípade internetového nákupu je možné konečnú, resp. výslednú cenu vybraných vstupeniek uhradiť platobnou kartou alebo bankovým prevodom prostredníctvom platobnej brány spoločnosti Comgate a.s., IČO 27924505, so sídlom Gočárova třída 1754/48b, 500 02 Hradec Králové – Pražské Předměstí, Česká republika, zapísanej v obchodnom registri Krajského súdu v Hradci Králové, oddiel B, vložka 3755, ktorá je platobnou inštitúciou s povolením Českej národnej banky. Platbu je možné realizovať platobnou kartou VISA alebo MASTERCARD vydanou ktoroukoľvek bankovou inštitúciou. Platobné údaje zadáva Zákazník priamo na stránke platobnej brány; MaxiTicket k nim nemá prístup. Pri platbe bankovým prevodom je Vstupenka vydaná až po pripísaní sumy na účet.";

console.log("\n=== B. OBCHODNÉ PODMIENKY, BOD 3.3 ===");
if (!stranka?.body?.includes(STARE)) {
  console.log("POZOR: pôvodný text sa v stránke nenašiel — nemením nič.");
} else {
  console.log("PÔVODNÉ:\n" + STARE + "\n\nNOVÉ:\n" + NOVE);
}

if (!ZAPISAT) {
  console.log("\n(náhľad — nič sa nezapísalo)");
  process.exit(0);
}

// ---------- zápis ----------
let chyby = 0;
for (const e of schovat) {
  const { error } = await db.from("events").update({ status: "draft" }).eq("id", e.id);
  if (error) {
    console.log(`CHYBA ${e.title}: ${error.message}`);
    chyby++;
  }
}
console.log(
  `\nprepnutých do konceptu: ${schovat.length - chyby}${chyby ? `, chýb: ${chyby}` : ""}`,
);

if (stranka?.body?.includes(STARE)) {
  const zaloha = `/opt/maxiticket/backup/obchodne-podmienky-pred-opravou-${new Date().toISOString().slice(0, 10)}.md`;
  fs.writeFileSync(zaloha, stranka.body);
  console.log(`pôvodné znenie odložené: ${zaloha}`);
  const { error } = await db
    .from("site_pages")
    .update({ body: stranka.body.replace(STARE, NOVE), updated_at: new Date().toISOString() })
    .eq("id", stranka.id);
  console.log(error ? `CHYBA pri podmienkach: ${error.message}` : "bod 3.3 opravený");
}
