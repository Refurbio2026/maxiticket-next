// Adresné štítky na obálky.
//
// PREČO SI ICH ROBÍME SAMI: SOAP rozhranie ePodacieho hárku štítky negeneruje
// — vráti číslo hárku a nič viac. Web ePH ich vie, ale do nášho podaja by to
// znamenalo prepisovať adresy ručne. Tu sa z objednávok vysádza strana, ktorá
// sa vytlačí, rozstrihá a nalepí.
//
// ROZMER: A4 rozdelená na 2 × 4 rovnaké polia, teda 105 × 74,25 mm. Zámerne
// to nie je rozmer konkrétnych samolepiek — nevieme, aké má kto doma. Na
// obyčajný papier sa to vytlačí a rozstrihá podľa vodiacich čiar.
import { newDoc, FONT, INK, MUTED, LINE, setDraw, setText, toBase64 } from "@/lib/pdf-base.server";
import type { AdresaEph } from "./eph-soap";

export type StitokZasielky = {
  adresat: { meno: string; ulica: string; mesto: string; psc: string };
  /** Naše označenie — to isté, čo ide do hárku. Pomôže pri reklamácii. */
  oznacenie: string;
  /** Podacie číslo, ak ho už pošta pridelila. */
  podacieCislo?: string | null;
};

const STRANA = { sirka: 210, vyska: 297 };
const MRIEZKA = { stlpce: 2, riadky: 4 };
const POLE = {
  sirka: STRANA.sirka / MRIEZKA.stlpce,
  vyska: STRANA.vyska / MRIEZKA.riadky,
};
/** Vnútorný okraj, aby text nekončil na hrane strihu. */
const OKRAJ = 8;

/**
 * Štítky ako PDF v base64.
 *
 * `odosielatel` sa tlačí malým písmom nahor — pošta ho na zásielke vyžaduje
 * a bez neho sa nedoručiteľná obálka nemá kam vrátiť.
 */
export function stitkyPdf(
  zasielky: StitokZasielky[],
  odosielatel: AdresaEph & { odosielatelId?: string },
): string {
  const doc = newDoc("a4");

  zasielky.forEach((z, i) => {
    const naStrane = i % (MRIEZKA.stlpce * MRIEZKA.riadky);
    if (i > 0 && naStrane === 0) doc.addPage();

    const stlpec = naStrane % MRIEZKA.stlpce;
    const riadok = Math.floor(naStrane / MRIEZKA.stlpce);
    const x0 = stlpec * POLE.sirka;
    const y0 = riadok * POLE.vyska;

    // Vodiace čiary na strih. Svetlé, aby sa nepýtali o pozornosť.
    setDraw(doc, LINE);
    doc.rect(x0 + 1, y0 + 1, POLE.sirka - 2, POLE.vyska - 2);

    let y = y0 + OKRAJ + 2;

    // Odosielateľ
    doc.setFont(FONT);
    doc.setFontSize(7.5);
    setText(doc, MUTED);
    doc.text("Odosielateľ", x0 + OKRAJ, y);
    y += 3.6;
    const odRiadky = [
      odosielatel.organizacia || odosielatel.meno || "",
      odosielatel.ulica,
      `${odosielatel.psc} ${odosielatel.mesto}`,
    ].filter(Boolean);
    doc.setFontSize(8);
    for (const r of odRiadky) {
      doc.text(r, x0 + OKRAJ, y);
      y += 3.6;
    }

    // Adresát — výrazne, to je to, čo doručovateľ čita.
    y = y0 + POLE.vyska / 2 - 10;
    doc.setFontSize(8);
    setText(doc, MUTED);
    doc.text("Adresát", x0 + OKRAJ + 12, y);
    y += 6;
    setText(doc, INK);
    doc.setFontSize(13);
    doc.text(z.adresat.meno, x0 + OKRAJ + 12, y);
    y += 6.5;
    doc.setFontSize(12);
    doc.text(z.adresat.ulica, x0 + OKRAJ + 12, y);
    y += 6.5;
    doc.text(`${z.adresat.psc}  ${z.adresat.mesto}`, x0 + OKRAJ + 12, y);

    // Dole: naše označenie a podacie číslo. Podľa nich sa obálka priradí
    // k objednávke, keď sa niečo rozsype.
    doc.setFontSize(7.5);
    setText(doc, MUTED);
    const dole = y0 + POLE.vyska - OKRAJ;
    doc.text(`Obj. ${z.oznacenie}`, x0 + OKRAJ, dole);
    if (z.podacieCislo) {
      doc.text(z.podacieCislo, x0 + POLE.sirka - OKRAJ, dole, { align: "right" });
    }
    setText(doc, INK);
  });

  return toBase64(doc);
}
