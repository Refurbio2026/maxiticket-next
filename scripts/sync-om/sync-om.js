#!/usr/bin/env node
//
// Inkrementálny sync vstupeniek zo starého systému (MaxiTicket OM4) do našej
// Supabase. Špecifikácia: `docs/spec-ticket-sync.md`, schéma:
// `supabase/migrations/20260916100000_om_staging_sync.sql`.
//
//   node sync-om.js --channel=A            jeden kanál
//   node sync-om.js --channel=A --dry-run  bez zápisu, kurzor sa neposunie
//   node sync-om.js --channel=all          všetky v poradí
//   node sync-om.js --channel=A --full     prvé naplnenie (backfill) od nuly
//   node sync-om.js --channel=A --full --since=2025-01-01
//                                          backfill len pre podujatia od dátumu
//
// Každý kanál je samostatne spustiteľný a má vlastný kurzor — cron ich púšťa
// s rôznou frekvenciou (README).

import { logger } from "./lib/log.js";
import { env, chybajuce } from "./lib/env.js";
import { zavri } from "./lib/source.js";
import { zavriVelkost, velkostDbMb } from "./lib/velkost.js";
import { zaberUlohu, dokonciUlohu } from "./lib/target.js";
import { nacitajCiselnik } from "./lib/ciselnik.js";

import * as A from "./channels/a-tickets.js";
import * as B from "./channels/b-orders.js";
import { c1, c2, c3 } from "./channels/c-events.js";
import * as D from "./channels/d-scans.js";
import * as E from "./channels/e-events.js";
import * as CODEBOOKS from "./channels/codebooks.js";
import * as COUNTS from "./channels/counts.js";

const KANALY = {
  A,
  B,
  C1: c1,
  C2: c2,
  C3: c3,
  D,
  E,
  codebooks: CODEBOOKS,
  counts: COUNTS,
};

// Poradie pre `--channel=all`: najprv číselník (kanál A ho potrebuje na
// rozhodnutie o odvodenej objednávke), potom podujatia, potom zvyšok.
const PORADIE = ["codebooks", "E", "A", "B", "C1", "C2", "C3", "D", "counts"];

function argumenty(argv) {
  const out = { channel: null, dryRun: false, full: false, since: undefined, maxDavok: Infinity };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--full") out.full = true;
    else if (a.startsWith("--channel=")) out.channel = a.slice("--channel=".length);
    else if (a.startsWith("--since=")) out.since = a.slice("--since=".length);
    else if (a.startsWith("--max-batches="))
      out.maxDavok = Number(a.slice("--max-batches=".length));
    else if (a === "--help" || a === "-h") out.help = true;
    else {
      console.error(`Neznámy prepínač: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function napoveda() {
  console.log(`Kanály:
  A          ${A.popis}
  B          ${B.popis}
  C1         ${c1.popis}
  C2         ${c2.popis}
  C3         ${c3.popis}
  D          ${D.popis}
  E          ${E.popis}
  codebooks  ${CODEBOOKS.popis}
  counts     ${COUNTS.popis}
  all        všetko v poradí ${PORADIE.join(" → ")}

Prepínače:
  --dry-run          číta a mapuje, ale nezapisuje a neposúva kurzor
  --full             od nuly (backfill); bez neho sa pokračuje od kurzora
  --since=YYYY-MM-DD orezanie na podujatia od dátumu (A, B, C2, C3, D, E).
                     Hodnota sa uloží do kurzora, takže inkrementálne behy
                     filtrujú rovnako a prepínač sa už nemusí opakovať.
  --max-batches=N    obmedzí počet dávok`);
}

async function spustiKanal(kluc, volby) {
  const modul = KANALY[kluc];
  const log = logger(kluc);
  const job = `om-sync-${kluc}`;

  // Pri `--dry-run` sa zámok neberie — skúšobný beh nesmie zablokovať ostrý.
  const behId = volby.dryRun ? null : await zaberUlohu(job);
  if (!volby.dryRun && !behId) {
    log.warn("preskočené, kanál už beží");
    return { preskocene: true };
  }

  const zaciatok = Date.now();
  try {
    const vysledok = await modul.spusti({ ...volby, log });
    await dokonciUlohu(behId, "ok", { ...vysledok, trvanie_ms: Date.now() - zaciatok });
    return vysledok;
  } catch (e) {
    log.error("zlyhalo", { chyba: e.message });
    await dokonciUlohu(behId, "failed", { trvanie_ms: Date.now() - zaciatok }, e.message).catch(
      () => {},
    );
    // Kurzor sa pri chybe neposúva — zapíše sa len dôvod.
    const { ulozKurzor } = await import("./lib/target.js");
    await ulozKurzor(kluc, { riadkov: 0, chyba: e.message, dryRun: volby.dryRun }).catch(() => {});
    throw e;
  }
}

async function main() {
  const volby = argumenty(process.argv);
  if (volby.help || !volby.channel) {
    napoveda();
    process.exit(volby.help ? 0 : 2);
  }

  const zoznam = volby.channel === "all" ? PORADIE : [volby.channel];
  for (const k of zoznam) {
    if (!KANALY[k]) {
      console.error(`Neznámy kanál: ${k}`);
      napoveda();
      process.exit(2);
    }
  }

  const ch = chybajuce();
  if (ch.length) {
    console.error(`Chýba konfigurácia: ${ch.join(", ")}`);
    console.error(`Doplň ju do scripts/sync-om/.env (viď README.md).`);
    process.exit(3);
  }

  if (volby.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(volby.since)) {
    console.error(`--since musí byť YYYY-MM-DD, dostal som: ${volby.since}`);
    process.exit(2);
  }

  const hlavny = logger("sync-om");
  hlavny.info("beh", {
    kanaly: zoznam,
    dryRun: volby.dryRun,
    full: volby.full,
    since: volby.since ?? null,
    zdroj: `${env.om.user}@${env.om.host}/${env.om.database}`,
    charset: env.om.charset,
    zona: env.om.timezone,
  });

  // Poistka sa overí hneď na začiatku — nemá zmysel prečítať dávku zo zdroja
  // a až potom zistiť, že sa nedá zapisovať.
  const mbPred = await velkostDbMb();
  hlavny.info("veľkosť cieľovej databázy", { mb: Math.round(mbPred), limit: env.limitMb });
  if (mbPred > env.limitMb) {
    hlavny.error("databáza je nad limitom, sync sa nespustí", {
      mb: Math.round(mbPred),
      limit: env.limitMb,
    });
    await zavriVelkost();
    process.exit(4);
  }

  await nacitajCiselnik();

  const suhrn = {};
  let zlyhalo = false;
  for (const k of zoznam) {
    try {
      suhrn[k] = await spustiKanal(k, volby);
    } catch (e) {
      suhrn[k] = { chyba: e.message };
      zlyhalo = true;
      // Pri `all` sa pokračuje ďalším kanálom — zlyhanie číselníkov nesmie
      // zastaviť vstupenky.
      if (volby.channel !== "all") break;
    }
  }

  const mbPo = await velkostDbMb().catch(() => null);
  hlavny.info("súhrn", suhrn);
  hlavny.info("veľkosť cieľovej databázy", {
    pred_mb: Math.round(mbPred),
    po_mb: mbPo === null ? null : Math.round(mbPo),
    prirastok_mb: mbPo === null ? null : Math.round(mbPo - mbPred),
    limit: env.limitMb,
  });
  await zavri();
  await zavriVelkost();
  process.exit(zlyhalo ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await zavri().catch(() => {});
  await zavriVelkost().catch(() => {});
  process.exit(1);
});
