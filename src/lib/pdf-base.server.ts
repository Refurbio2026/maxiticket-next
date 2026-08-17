// Spoločný základ pre všetky PDF, ktoré projekt generuje — vstupenky,
// pokladničné doklady aj uzávierky. Beží výhradne na serveri.
//
// Dôvod, prečo je to na jednom mieste: font s diakritikou treba vložiť do
// každého dokumentu zvlášť a farby značky musia byť všade rovnaké. Keď to
// bolo rozsypané, „Štúdio" sa v jednom doklade vytlačilo správne a v druhom
// ako „túdio".
//
// Pomenovaný import zámerne: default export jspdf nie je v Node ESM konštruktor.
import { jsPDF } from "jspdf";
import { DEJAVU_SANS_BASE64 } from "./fonts/dejavu-sans";

export const FONT = "DejaVuSans";

/** Farby značky. Zodpovedajú `--primary` a tmavému podkladu z `styles.css`. */
export const INK = { r: 20, g: 20, b: 20 };
export const MUTED = { r: 120, g: 120, b: 120 };
export const LINE = { r: 220, g: 220, b: 220 };
export const DARK = { r: 15, g: 23, b: 42 };
export const FLAME = { r: 242, g: 100, b: 25 };
export const AMBER = { r: 240, g: 160, b: 32 };
export const DANGER = { r: 190, g: 60, b: 60 };
export const OK = { r: 22, g: 128, b: 74 };

type Rgb = { r: number; g: number; b: number };

/**
 * Založí dokument s vloženým DejaVu Sans.
 *
 * Vstavané fonty jsPDF vedia len Latin-1 a mäkčeňové znaky pri zápise ticho
 * zahodia. DejaVu pokrýva Latin Extended-A a jsPDF ho pri zápise subsetuje,
 * takže hotové PDF ostáva v desiatkach kB.
 */
export function newDoc(format: "a4" | [number, number] = "a4"): jsPDF {
  // `compress` je tu kvôli tomu, že doklady sa ukladajú do databázy. Font tvorí
  // väčšinu súboru a deflate ho zrazí na zlomok — bez toho by mal každý
  // pokladničný doklad cez 150 kB.
  const doc = new jsPDF({ unit: "mm", format, putOnlyUsedFonts: true, compress: true });
  doc.addFileToVFS("DejaVuSans.ttf", DEJAVU_SANS_BASE64);
  doc.addFont("DejaVuSans.ttf", FONT, "normal");
  doc.setFont(FONT);
  return doc;
}

export const setText = (doc: jsPDF, c: Rgb) => doc.setTextColor(c.r, c.g, c.b);
export const setFill = (doc: jsPDF, c: Rgb) => doc.setFillColor(c.r, c.g, c.b);
export const setDraw = (doc: jsPDF, c: Rgb) => doc.setDrawColor(c.r, c.g, c.b);

/** Suma v tvare, aký čaká účtovníčka: `1 234,50 €`. */
export function eur(n: number): string {
  return `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/**
 * Slovenské množné číslo: 1 doklad, 2–4 doklady, 5+ dokladov.
 * Bez toho by v doklade stálo „3 dokladov", čo je hrubá chyba na papieri,
 * ktorý ide účtovníčke.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return `${n} ${one}`;
  if (n >= 2 && n <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("sk-SK", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Tmavá hlavička s názvom značky a plamienkovým prúžkom pod ňou.
 * Vracia y-ovú súradnicu, od ktorej môže pokračovať obsah.
 */
export function brandHeader(
  doc: jsPDF,
  opts: { title: string; right?: string; subtitle?: string },
): number {
  const pageW = doc.internal.pageSize.getWidth();
  setFill(doc, DARK);
  doc.rect(0, 0, pageW, 30, "F");
  // Prúžok v gradiente sa v PDF nedá spraviť lacno, tak ho poskladáme z dvoch polí.
  setFill(doc, FLAME);
  doc.rect(0, 30, pageW / 2, 1.6, "F");
  setFill(doc, AMBER);
  doc.rect(pageW / 2, 30, pageW / 2, 1.6, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.text("vipky.sk", 14, 16);
  doc.setFontSize(11);
  doc.text(opts.title, 14, 24);
  if (opts.right) {
    doc.setFontSize(10);
    doc.text(opts.right, pageW - 14, 16, { align: "right" });
  }
  if (opts.subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(190, 190, 200);
    doc.text(opts.subtitle, pageW - 14, 24, { align: "right" });
  }
  setText(doc, INK);
  return 44;
}

/** Pätka s drobným písmom. `lines` sa vysádzajú pod čiaru na spodku strany. */
export function pageFooter(doc: jsPDF, lines: string[], y = 278) {
  const pageW = doc.internal.pageSize.getWidth();
  setDraw(doc, LINE);
  doc.line(14, y - 6, pageW - 14, y - 6);
  doc.setFontSize(8);
  setText(doc, MUTED);
  lines.forEach((l, i) => doc.text(l, 14, y + i * 4));
  setText(doc, INK);
}

/** Riadok „názov ..... hodnota" so zarovnaním hodnoty doprava. */
export function labelValue(
  doc: jsPDF,
  label: string,
  value: string,
  y: number,
  opts: { x?: number; right?: number; size?: number; bold?: boolean } = {},
) {
  const pageW = doc.internal.pageSize.getWidth();
  const x = opts.x ?? 14;
  const right = opts.right ?? pageW - 14;
  doc.setFontSize(opts.size ?? 10);
  setText(doc, opts.bold ? INK : MUTED);
  doc.text(label, x, y);
  setText(doc, INK);
  doc.text(value, right, y, { align: "right" });
}

/** QR ako PNG data URL. Pri výpadku služby vráti null a volajúci vysadí rámček. */
export async function qrPngDataUrl(value: string, size = 360): Promise<string | null> {
  try {
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&margin=0`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export function toBase64(doc: jsPDF): string {
  return Buffer.from(doc.output("arraybuffer")).toString("base64");
}
