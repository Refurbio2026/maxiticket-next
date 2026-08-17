// Generovanie PDF vstupeniek. Beží výhradne na serveri — klient si PDF vyžiada
// cez `ticket-pdf.functions.ts` a dostane hotový base64. Vďaka tomu je výstup
// všade rovnaký (e-mail aj stiahnutie zo stránky) a jspdf sa nemusí posielať
// do prehliadača.
//
// Spoločný základ (font s diakritikou, farby značky, QR) je v `pdf-base.server.ts`.
import type { jsPDF } from "jspdf";
import {
  newDoc,
  qrPngDataUrl,
  toBase64,
  setText,
  setFill,
  setDraw,
  INK,
  MUTED,
  LINE,
  DARK,
  FLAME,
  AMBER,
  DANGER,
} from "./pdf-base.server";

export type PdfTicket = {
  seat_label: string;
  qr_code: string;
};

export type PdfEventInfo = {
  title: string;
  event_date: string;
  event_time: string;
  venue: string;
  city: string;
};

export type PdfSoldTicket = {
  seat_label: string;
  qr_code: string;
  order_id: string;
  customer_name: string | null;
  customer_email: string | null;
  used_at: string | null;
};

const PAGE_W = 210;
const M = 16; // okraj strany

/** `2026-09-16` → `16. 9. 2026`. Iný tvar necháme tak, ako prišiel. */
function skDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(value + "T00:00:00Z").toLocaleDateString("sk-SK", { timeZone: "UTC" });
}

/** Tmavý pás s názvom značky a poradím vstupenky. */
function drawHeader(doc: jsPDF, index: number, total: number) {
  setFill(doc, DARK);
  doc.rect(0, 0, PAGE_W, 34, "F");
  setFill(doc, FLAME);
  doc.rect(0, 34, PAGE_W / 2, 2, "F");
  setFill(doc, AMBER);
  doc.rect(PAGE_W / 2, 34, PAGE_W / 2, 2, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.text("vipky.sk", M, 19);
  doc.setFontSize(9);
  doc.setTextColor(190, 190, 200);
  doc.text("ELEKTRONICKÁ VSTUPENKA", M, 27);
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text(`${index + 1} / ${total}`, PAGE_W - M, 19, { align: "right" });
  setText(doc, INK);
}

/** Riadok „POPIS / hodnota" v ľavom stĺpci. */
function infoRow(doc: jsPDF, label: string, value: string, y: number, maxWidth = 92) {
  doc.setFontSize(7.5);
  setText(doc, MUTED);
  doc.text(label.toUpperCase(), M + 6, y);
  doc.setFontSize(11);
  setText(doc, INK);
  doc.text(value, M + 6, y + 5.5, { maxWidth });
  setDraw(doc, LINE);
  doc.line(M + 6, y + 9.5, M + 6 + maxWidth, y + 9.5);
}

async function drawTicketBody(
  doc: jsPDF,
  opts: {
    index: number;
    total: number;
    title: string;
    event: PdfEventInfo | null;
    seatLabel: string;
    qrCode: string;
    rows: [string, string][];
    stamp?: string | null;
  },
): Promise<void> {
  drawHeader(doc, opts.index, opts.total);

  doc.setFontSize(23);
  setText(doc, INK);
  doc.text(opts.title, M, 52, { maxWidth: PAGE_W - 2 * M });

  const datum = opts.event ? skDate(opts.event.event_date) : "";
  if (opts.event) {
    doc.setFontSize(11);
    setText(doc, MUTED);
    doc.text(
      `${datum} · ${opts.event.event_time} · ${opts.event.venue}, ${opts.event.city}`,
      M,
      60,
      { maxWidth: PAGE_W - 2 * M },
    );
    setText(doc, INK);
  }

  // Ľavý blok s údajmi a pravý s QR majú rovnakú výšku. Minimum držíme preto,
  // aby sa QR nezmenšil na nečitateľnú známku, keď má vstupenka málo riadkov.
  const boxTop = 70;
  const boxH = Math.max(80, 16 + opts.rows.length * 14);
  setDraw(doc, LINE);
  doc.roundedRect(M, boxTop, 104, boxH, 3, 3, "S");
  let y = boxTop + 12;
  for (const [label, value] of opts.rows) {
    infoRow(doc, label, value, y);
    y += 14;
  }

  const qrX = M + 112;
  const qrW = PAGE_W - M - qrX;
  setDraw(doc, LINE);
  doc.roundedRect(qrX, boxTop, qrW, boxH, 3, 3, "S");
  const dataUrl = await qrPngDataUrl(opts.qrCode, 500);
  const qrSize = Math.min(qrW - 14, boxH - 26);
  const qrCx = qrX + qrW / 2;
  if (dataUrl) {
    doc.addImage(dataUrl, "PNG", qrCx - qrSize / 2, boxTop + 8, qrSize, qrSize);
  } else {
    doc.rect(qrCx - qrSize / 2, boxTop + 8, qrSize, qrSize, "S");
    doc.setFontSize(8);
    doc.text("QR kód", qrCx, boxTop + 8 + qrSize / 2, { align: "center" });
  }
  doc.setFontSize(8);
  setText(doc, MUTED);
  doc.text("Naskenuj pri vstupe", qrCx, boxTop + boxH - 6, { align: "center" });
  setText(doc, INK);

  // Kód pod blokmi, cez celú šírku — na dvoch riadkoch v úzkom stĺpci by sa
  // zle prepisoval, keby ho niekto potreboval zadať ručne.
  doc.setFontSize(7.5);
  setText(doc, MUTED);
  doc.text(`Kód vstupenky: ${opts.qrCode}`, M, boxTop + boxH + 7);
  setText(doc, INK);

  if (opts.stamp) {
    setText(doc, DANGER);
    doc.setFontSize(14);
    doc.text(opts.stamp, M, boxTop + boxH + 20);
    setText(doc, INK);
  }

  // Pravidlá — zároveň vypĺňajú stranu medzi údajmi a ústrižkom.
  const rulesY = boxTop + boxH + 28;
  setDraw(doc, LINE);
  doc.roundedRect(M, rulesY, PAGE_W - 2 * M, 34, 3, 3, "S");
  doc.setFontSize(9);
  setText(doc, INK);
  doc.text("Ako to funguje", M + 6, rulesY + 9);
  doc.setFontSize(9);
  setText(doc, MUTED);
  const rules = [
    "Kód ukáž pri vstupe z mobilu alebo vytlačený — netreba nič tlačiť farebne.",
    "Vstupenka platí na jeden vstup na uvedený termín a sedadlo.",
    "Kód nezdieľaj. Vojde ten, kto ho naskenuje prvý.",
  ];
  rules.forEach((r, i) => doc.text(`•  ${r}`, M + 6, rulesY + 17 + i * 6));
  setText(doc, INK);

  // Odtrhávacia časť — to, čo si pri vstupe necháva usporiadateľ.
  const tearY = 224;
  setDraw(doc, LINE);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(M, tearY, PAGE_W - M, tearY);
  doc.setLineDashPattern([], 0);
  doc.setFontSize(7);
  setText(doc, MUTED);
  doc.text("odstrihnúť", PAGE_W / 2, tearY - 2, { align: "center" });

  setText(doc, INK);
  doc.setFontSize(9);
  doc.text("KONTROLNÝ ÚSTRIŽOK", M, tearY + 8);
  doc.setFontSize(13);
  doc.text(opts.title, M, tearY + 16, { maxWidth: 110 });
  doc.setFontSize(10);
  setText(doc, MUTED);
  if (opts.event) {
    doc.text(`${datum} · ${opts.event.event_time}`, M, tearY + 23);
  }
  setText(doc, INK);
  doc.text(opts.seatLabel, M, tearY + 30, { maxWidth: 110 });
  if (dataUrl) {
    doc.addImage(dataUrl, "PNG", PAGE_W - M - 26, tearY + 4, 26, 26);
  }

  // Pätka.
  setDraw(doc, LINE);
  doc.line(M, 272, PAGE_W - M, 272);
  doc.setFontSize(8);
  setText(doc, MUTED);
  doc.text(
    "Vstup je platný iba s QR kódom. Pri vstupe ukáž kód z mobilu alebo vytlačenú vstupenku.",
    M,
    278,
  );
  doc.text("Vstupenka platí na jeden vstup. Kopírovaním nevzniká nárok na ďalší vstup.", M, 282);
  doc.text("Reklamácie: support@vipky.sk · www.vipky.sk", M, 286);
  setText(doc, INK);
}

/** Vstupenky jednej objednávky. Base64 — v takom tvare ich chce aj Resend. */
export async function generateTicketsPdfBase64(opts: {
  orderId: string;
  customerEmail?: string | null;
  event: PdfEventInfo | null;
  tickets: PdfTicket[];
}): Promise<string> {
  const { orderId, customerEmail, event, tickets } = opts;
  const doc = newDoc("a4");

  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) doc.addPage();
    const t = tickets[i];
    const rows: [string, string][] = [
      ["Sektor / sedadlo", t.seat_label],
      ["Objednávka", orderId.slice(0, 8).toUpperCase()],
    ];
    if (customerEmail) rows.push(["Kupujúci", customerEmail]);

    await drawTicketBody(doc, {
      index: i,
      total: tickets.length,
      title: event?.title ?? "Podujatie",
      event,
      seatLabel: t.seat_label,
      qrCode: t.qr_code,
      rows,
    });
  }

  return toBase64(doc);
}

/** Všetky predané vstupenky jedného podujatia — hromadná tlač pre organizátora. */
export async function generateEventTicketsPdfBase64(opts: {
  event: PdfEventInfo;
  tickets: PdfSoldTicket[];
}): Promise<string> {
  const { event, tickets } = opts;
  const doc = newDoc("a4");

  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) doc.addPage();
    const t = tickets[i];
    const rows: [string, string][] = [
      ["Sektor / sedadlo", t.seat_label],
      ["Objednávka", t.order_id.slice(0, 8).toUpperCase()],
    ];
    if (t.customer_name) rows.push(["Meno", t.customer_name]);
    if (t.customer_email) rows.push(["Email", t.customer_email]);

    await drawTicketBody(doc, {
      index: i,
      total: tickets.length,
      title: event.title,
      event,
      seatLabel: t.seat_label,
      qrCode: t.qr_code,
      rows,
      stamp: t.used_at ? `POUŽITÁ ${new Date(t.used_at).toLocaleString("sk-SK")}` : null,
    });
  }

  return toBase64(doc);
}
