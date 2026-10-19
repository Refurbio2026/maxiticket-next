#!/usr/bin/env node
// Markdown → PDF so slovenskou diakritikou.
//
// Vznikol pre sprint plán, ale je zámerne všeobecný: obsah žije v markdowne
// (dá sa upravovať, verzovať, čítať v termináli) a toto ho len vysádza.
//
// Podporuje podmnožinu, ktorú tie dokumenty naozaj používajú:
//   # ## ###  nadpisy      - odrážky      | tabuľky |      **tučné**
// Čokoľvek iné sa vysádza ako odstavec, nie zahodí.
//
// Font: DejaVu Sans z `src/lib/fonts/dejavu-sans.ts` (vstavané fonty jsPDF
// vedia len Latin-1 a mäkčene ticho zahodia — „Štúdio" → „túdio").
//
//   node scripts/md-na-pdf.mjs docs/sprint-261020.md [vystup.pdf]
import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "../node_modules/jspdf/dist/jspdf.node.min.js";

const FONT = "DejaVu";
const STRANA = { w: 210, h: 297 };
const OKRAJ = { l: 18, r: 18, t: 20, b: 18 };
const SIRKA = STRANA.w - OKRAJ.l - OKRAJ.r;

const CIERNA = [23, 23, 23];
const SIVA = [110, 110, 110];
const PLAMEN = [217, 70, 20];
const LINKA = [222, 222, 222];
const PODKLAD = [246, 246, 246];

/** Vytiahne base64 fontu z .ts modulu — čistý node .ts neimportuje. */
function nacitajFont() {
  const cesta = path.join(import.meta.dirname, "..", "src", "lib", "fonts", "dejavu-sans.ts");
  const text = fs.readFileSync(cesta, "utf8");
  const m = text.match(/=\s*["'`]([A-Za-z0-9+/=\s]{10000,})["'`]/);
  if (!m) throw new Error(`v ${cesta} sa nenašiel base64 fontu`);
  return m[1].replace(/\s+/g, "");
}

/** Rozpadne markdown na bloky, s ktorými sa už dá sádzať. */
function naBloky(md) {
  const riadky = md.split("\n");
  const bloky = [];
  let i = 0;

  while (i < riadky.length) {
    const r = riadky[i];

    if (r.trim() === "") {
      i += 1;
      continue;
    }

    const nadpis = r.match(/^(#{1,3})\s+(.*)$/);
    if (nadpis) {
      bloky.push({ typ: `h${nadpis[1].length}`, text: nadpis[2].trim() });
      i += 1;
      continue;
    }

    // Tabuľka: hlavička, oddeľovač |---|, potom riadky.
    if (r.trim().startsWith("|") && (riadky[i + 1] ?? "").includes("---")) {
      const bunky = (x) =>
        x
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const hlavicka = bunky(r);
      i += 2;
      const telo = [];
      while (i < riadky.length && riadky[i].trim().startsWith("|")) {
        telo.push(bunky(riadky[i]));
        i += 1;
      }
      bloky.push({ typ: "tabulka", hlavicka, telo });
      continue;
    }

    if (/^[-*]\s+/.test(r.trim())) {
      const body = [];
      while (i < riadky.length && /^[-*]\s+/.test(riadky[i].trim())) {
        body.push(riadky[i].trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      bloky.push({ typ: "odrazky", body });
      continue;
    }

    const odstavec = [];
    while (
      i < riadky.length &&
      riadky[i].trim() !== "" &&
      !/^#{1,3}\s/.test(riadky[i]) &&
      !riadky[i].trim().startsWith("|") &&
      !/^[-*]\s+/.test(riadky[i].trim())
    ) {
      odstavec.push(riadky[i].trim());
      i += 1;
    }
    bloky.push({ typ: "odstavec", text: odstavec.join(" ") });
  }

  return bloky;
}

/** Rozdelí text na úseky podľa **tučného**, aby sa dali sádzať rôznym rezom. */
function useky(text) {
  const out = [];
  for (const cast of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (!cast) continue;
    out.push(
      cast.startsWith("**") && cast.endsWith("**")
        ? { text: cast.slice(2, -2), tucne: true }
        : { text: cast, tucne: false },
    );
  }
  return out;
}

export function vysad(md, nazovSuboru) {
  const doc = new jsPDF({ unit: "mm", format: "a4", putOnlyUsedFonts: true, compress: true });
  doc.addFileToVFS("DejaVuSans.ttf", nacitajFont());
  doc.addFont("DejaVuSans.ttf", FONT, "normal");
  doc.setFont(FONT);

  let y = OKRAJ.t;
  let strana = 1;

  const pataStrany = () => {
    doc.setFontSize(7.5);
    doc.setTextColor(...SIVA);
    doc.text("eticketo.eu · MaxiTicket s.r.o.", OKRAJ.l, STRANA.h - 10);
    doc.text(`${strana}`, STRANA.w - OKRAJ.r, STRANA.h - 10, { align: "right" });
  };

  const novaStrana = () => {
    pataStrany();
    doc.addPage();
    strana += 1;
    y = OKRAJ.t;
  };

  const miesto = (treba) => {
    if (y + treba > STRANA.h - OKRAJ.b) novaStrana();
  };

  /** Vysádza text s **tučnými** úsekmi a zalomením; vráti novú `y`. */
  const text = (obsah, { size = 10, farba = CIERNA, odsadenie = 0, riadkovanie = 1.45 } = {}) => {
    doc.setFontSize(size);
    const sirka = SIRKA - odsadenie;
    const vyskaRiadku = (size * riadkovanie) / 2.835;

    // Zalomenie si robíme sami, aby tučné úseky nerozbili tok riadku.
    let rx = OKRAJ.l + odsadenie;
    let prvy = true;
    for (const u of useky(obsah)) {
      for (const slovo of u.text.split(/(\s+)/)) {
        if (slovo === "") continue;
        const w = doc.getTextWidth(slovo);
        if (!prvy && rx + w > OKRAJ.l + odsadenie + sirka && slovo.trim() !== "") {
          y += vyskaRiadku;
          miesto(vyskaRiadku);
          rx = OKRAJ.l + odsadenie;
          if (/^\s+$/.test(slovo)) continue;
        }
        doc.setTextColor(...farba);
        // Tučné sa fejkuje obtiahnutím — DejaVu máme vložený len v jednom reze.
        if (u.tucne) {
          // Šírku obtiahnutia treba nastaviť PRED vykreslením, inak prvé tučné
          // slovo zdedí hrúbku z predchádzajúcej kresby.
          doc.setLineWidth(0.12);
          doc.setTextColor(...CIERNA);
          doc.text(slovo, rx, y, { renderingMode: "fillThenStroke" });
        } else {
          doc.text(slovo, rx, y);
        }
        rx += w;
        prvy = false;
      }
    }
    y += vyskaRiadku;
    return y;
  };

  const bloky = naBloky(md);

  for (const b of bloky) {
    if (b.typ === "h1") {
      miesto(18);
      doc.setFontSize(21);
      doc.setTextColor(...CIERNA);
      doc.text(b.text, OKRAJ.l, y + 4);
      y += 9;
      doc.setDrawColor(...PLAMEN);
      doc.setLineWidth(1.2);
      doc.line(OKRAJ.l, y, OKRAJ.l + 26, y);
      y += 8;
      continue;
    }

    if (b.typ === "h2") {
      miesto(16);
      y += 4;
      doc.setFontSize(13.5);
      doc.setTextColor(...PLAMEN);
      doc.text(b.text, OKRAJ.l, y + 3);
      y += 8.5;
      continue;
    }

    if (b.typ === "h3") {
      miesto(12);
      y += 2.5;
      doc.setFontSize(11);
      doc.setTextColor(...CIERNA);
      doc.text(b.text, OKRAJ.l, y + 2);
      y += 7;
      continue;
    }

    if (b.typ === "odstavec") {
      miesto(6);
      text(b.text, { size: 9.6 });
      y += 2.2;
      continue;
    }

    if (b.typ === "odrazky") {
      for (const o of b.body) {
        miesto(6);
        doc.setFontSize(9.6);
        doc.setTextColor(...PLAMEN);
        doc.text("•", OKRAJ.l + 1.5, y);
        text(o, { size: 9.6, odsadenie: 5.5 });
        y += 0.8;
      }
      y += 2;
      continue;
    }

    if (b.typ === "tabulka") {
      const stlpcov = b.hlavicka.length;
      // Prvý stĺpec širší: zvyčajne v ňom je veta, v ostatných číslo.
      const sirky =
        stlpcov === 2
          ? [SIRKA * 0.62, SIRKA * 0.38]
          : [SIRKA * 0.08, SIRKA * 0.56, SIRKA * 0.2, SIRKA * 0.16].slice(0, stlpcov);
      const sumar = sirky.reduce((a, b2) => a + b2, 0);
      const w = sirky.map((s) => (s / sumar) * SIRKA);

      const riadok = (bunky, { hlavicka = false } = {}) => {
        doc.setFontSize(8.8);
        // Najvyššia bunka určuje výšku riadku.
        const rozpady = bunky.map((c, idx) =>
          doc.splitTextToSize(c.replace(/\*\*/g, ""), w[idx] - 3),
        );
        const vyska = Math.max(...rozpady.map((r) => r.length)) * 4.1 + 2.6;
        miesto(vyska + 2);

        if (hlavicka) {
          doc.setFillColor(...PODKLAD);
          doc.rect(OKRAJ.l, y - 3.4, SIRKA, vyska, "F");
        }
        let x = OKRAJ.l;
        rozpady.forEach((r, idx) => {
          doc.setTextColor(...(hlavicka ? CIERNA : SIVA));
          if (idx === 0 && !hlavicka) doc.setTextColor(...CIERNA);
          r.forEach((linka, li) => doc.text(linka, x + 1.5, y + li * 4.1));
          x += w[idx];
        });
        y += vyska;
        doc.setDrawColor(...LINKA);
        doc.setLineWidth(0.15);
        doc.line(OKRAJ.l, y - 2.6, OKRAJ.l + SIRKA, y - 2.6);
      };

      y += 2;
      riadok(b.hlavicka, { hlavicka: true });
      for (const r of b.telo) riadok(r);
      y += 4;
      continue;
    }
  }

  pataStrany();
  const kam = nazovSuboru ?? "vystup.pdf";
  fs.writeFileSync(kam, Buffer.from(doc.output("arraybuffer")));
  return { kam, stran: strana };
}

if (process.argv[1] && process.argv[1].endsWith("md-na-pdf.mjs")) {
  const vstup = process.argv[2];
  if (!vstup) {
    console.error("použitie: node scripts/md-na-pdf.mjs <subor.md> [vystup.pdf]");
    process.exit(1);
  }
  const vystup = process.argv[3] ?? vstup.replace(/\.md$/, ".pdf");
  const md = fs.readFileSync(vstup, "utf8");
  const { kam, stran } = vysad(md, vystup);
  const kb = Math.round(fs.statSync(kam).size / 1024);
  console.log(`  ${kam} — ${stran} strán, ${kb} kB`);
}
