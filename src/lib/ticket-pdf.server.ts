// Generovanie PDF vstupeniek — jediné miesto v projekte, kde PDF vzniká.
//
// Beží výhradne na serveri. Klient si PDF vyžiada cez `ticket-pdf.functions.ts`
// a dostane hotový base64. Vďaka tomu je výstup všade rovnaký (e-mail aj
// stiahnutie zo stránky) a jspdf, canvg ani html2canvas sa nemusia posielať
// do prehliadača.
//
// Pomenovaný import zámerne: default export jspdf nie je v Node ESM konštruktor.
import { jsPDF } from "jspdf";
import { DEJAVU_SANS_BASE64 } from "./fonts/dejavu-sans";

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

const FONT = "DejaVuSans";

/**
 * Založí dokument s vloženým DejaVu Sans.
 *
 * Vstavané fonty jsPDF vedia len Latin-1 a mäkčeňové znaky pri zápise ticho
 * zahodia — „Štúdio" sa vytlačilo ako „túdio". DejaVu pokrýva Latin Extended-A.
 * jsPDF font pri zápise subsetuje, takže hotové PDF ostáva okolo 140 kB.
 */
function newDoc(): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", putOnlyUsedFonts: true });
  doc.addFileToVFS("DejaVuSans.ttf", DEJAVU_SANS_BASE64);
  doc.addFont("DejaVuSans.ttf", FONT, "normal");
  doc.setFont(FONT);
  return doc;
}

/** QR ako PNG data URL. Pri výpadku služby vráti null a PDF vysadí rámček s textom. */
async function qrPngDataUrl(value: string, size = 360): Promise<string | null> {
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

function drawFrame(doc: jsPDF, index: number, total: number) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.text("vipky.sk", 14, 18);
  doc.setFontSize(10);
  doc.text(`Vstupenka ${index + 1} z ${total}`, pageW - 14, 18, { align: "right" });
  doc.setTextColor(20, 20, 20);
}

function drawFooter(doc: jsPDF) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setDrawColor(220);
  doc.line(14, 260, pageW - 14, 260);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    "Vstup je platný iba s QR kódom. Pri vstupe ukáž kód z mobilu alebo vytlačenú vstupenku.",
    14,
    268,
  );
  doc.text("Reklamácie: support@vipky.sk · www.vipky.sk", 14, 274);
  doc.setTextColor(20, 20, 20);
}

async function drawQr(doc: jsPDF, value: string) {
  const pageW = doc.internal.pageSize.getWidth();
  const dataUrl = await qrPngDataUrl(value, 360);
  if (dataUrl) {
    doc.addImage(dataUrl, "PNG", pageW - 80, 38, 65, 65);
  } else {
    doc.setDrawColor(180);
    doc.rect(pageW - 80, 38, 65, 65);
    doc.setFontSize(8);
    doc.text("QR kód", pageW - 47, 72, { align: "center" });
  }
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(value, pageW - 47, 108, { align: "center", maxWidth: 70 });
  doc.setTextColor(20, 20, 20);
}

/** Vstupenky jednej objednávky. Base64 — v takom tvare ich chce aj Resend. */
export async function generateTicketsPdfBase64(opts: {
  orderId: string;
  customerEmail?: string | null;
  event: PdfEventInfo | null;
  tickets: PdfTicket[];
}): Promise<string> {
  const { orderId, customerEmail, event, tickets } = opts;
  const doc = newDoc();

  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) doc.addPage();
    const t = tickets[i];
    drawFrame(doc, i, tickets.length);

    doc.setFontSize(20);
    doc.text(event?.title ?? "Podujatie", 14, 46);

    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    if (event) {
      doc.text(`Dátum:   ${event.event_date} · ${event.event_time}`, 14, 56);
      doc.text(`Miesto:  ${event.venue}, ${event.city}`, 14, 63);
    }
    doc.text(`Sektor / sedadlo: ${t.seat_label}`, 14, 70);
    doc.text(`Objednávka: ${orderId.slice(0, 8).toUpperCase()}`, 14, 77);
    if (customerEmail) doc.text(`Email: ${customerEmail}`, 14, 84);
    doc.setTextColor(20, 20, 20);

    await drawQr(doc, t.qr_code);
    drawFooter(doc);
  }

  return Buffer.from(doc.output("arraybuffer")).toString("base64");
}

/** Všetky predané vstupenky jedného podujatia — hromadná tlač pre organizátora. */
export async function generateEventTicketsPdfBase64(opts: {
  event: PdfEventInfo;
  tickets: PdfSoldTicket[];
}): Promise<string> {
  const { event, tickets } = opts;
  const doc = newDoc();

  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) doc.addPage();
    const t = tickets[i];
    drawFrame(doc, i, tickets.length);

    doc.setFontSize(20);
    doc.text(event.title, 14, 46);

    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    doc.text(`Dátum:   ${event.event_date} · ${event.event_time}`, 14, 56);
    doc.text(`Miesto:  ${event.venue}, ${event.city}`, 14, 63);
    doc.text(`Sektor / sedadlo: ${t.seat_label}`, 14, 70);
    doc.text(`Objednávka: ${t.order_id.slice(0, 8).toUpperCase()}`, 14, 77);
    if (t.customer_name) doc.text(`Meno: ${t.customer_name}`, 14, 84);
    if (t.customer_email) doc.text(`Email: ${t.customer_email}`, 14, 91);
    if (t.used_at) {
      doc.setTextColor(180, 60, 60);
      doc.text(`POUŽITÁ: ${new Date(t.used_at).toLocaleString("sk")}`, 14, 98);
    }
    doc.setTextColor(20, 20, 20);

    await drawQr(doc, t.qr_code);
    drawFooter(doc);
  }

  return Buffer.from(doc.output("arraybuffer")).toString("base64");
}
