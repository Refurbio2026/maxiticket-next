// PDF dokumenty z pokladne: uzávierka a pokladničný doklad.
//
// Uzávierka je A4 dokument do šanónu, doklad je 80 mm pás ako z termotlačiarne
// — to je formát, ktorý zákazník naozaj dostane do ruky a v ktorom ho vie
// pokladňa vytlačiť bez preformátovania.
import {
  newDoc,
  brandHeader,
  pageFooter,
  labelValue,
  eur,
  dateTime,
  plural,
  setText,
  setFill,
  setDraw,
  toBase64,
  INK,
  MUTED,
  LINE,
  DARK,
  FLAME,
  DANGER,
  OK,
} from "./pdf-base.server";

export type ClosingPdfData = {
  id: string;
  organizer_name: string;
  cashier_name: string | null;
  period_from: string;
  period_to: string;
  created_at: string;
  orders_count: number;
  tickets_count: number;
  cash_total: number;
  card_total: number;
  transfer_total: number;
  free_total: number;
  gross_total: number;
  voided_count: number;
  voided_total: number;
  opening_cash: number;
  expected_cash: number;
  counted_cash: number | null;
  cash_difference: number | null;
  note: string | null;
  sales: {
    receipt_number: string;
    created_at: string;
    event_title: string;
    payment_method: string;
    total: number;
    status: string;
  }[];
};

export type ReceiptPdfData = {
  receipt_number: string;
  created_at: string;
  organizer_name: string;
  cashier_name: string | null;
  event_title: string;
  event_date?: string | null;
  payment_method: string;
  subtotal: number;
  discount: number;
  total: number;
  promo_code?: string | null;
  status: string;
  items: { label: string; quantity: number; unit_price: number }[];
  fiscal: {
    ico: string | null;
    dic: string | null;
    ic_dph: string | null;
    cash_register_code: string | null;
    premises_name: string | null;
    premises_address: string | null;
  } | null;
};

const PAY_LABEL: Record<string, string> = {
  cash: "Hotovosť",
  card: "Karta",
  transfer: "Prevod",
  free: "Zdarma / voľná vstupenka",
  voucher: "Poukaz",
};
const payLabel = (m: string) => PAY_LABEL[m] ?? m;

// --- Uzávierka --------------------------------------------------------

export function generateClosingPdfBase64(d: ClosingPdfData): string {
  const doc = newDoc("a4");
  const pageW = doc.internal.pageSize.getWidth();
  const obdobie = `${dateTime(d.period_from)} — ${dateTime(d.period_to)}`;

  let y = brandHeader(doc, {
    title: "Uzávierka pokladne",
    right: `č. ${d.id.slice(0, 8).toUpperCase()}`,
    subtitle: `Vystavená ${dateTime(d.created_at)}`,
  });

  // Hlavička dokumentu — kto, za koho a za aké obdobie.
  doc.setFontSize(9);
  setText(doc, MUTED);
  doc.text("OBDOBIE", 14, y);
  doc.text("ORGANIZÁTOR", 90, y);
  doc.text("POKLADNÍK", 150, y);
  setText(doc, INK);
  doc.setFontSize(10);
  doc.text(obdobie, 14, y + 5.5, { maxWidth: 72 });
  doc.text(d.organizer_name, 90, y + 5.5, { maxWidth: 56 });
  doc.text(d.cashier_name || "celý deň", 150, y + 5.5, { maxWidth: 46 });
  y += 16;

  // Veľké číslo, kvôli ktorému dokument existuje.
  setFill(doc, DARK);
  doc.roundedRect(14, y, pageW - 28, 24, 2, 2, "F");
  doc.setTextColor(190, 190, 200);
  doc.setFontSize(9);
  doc.text("TRŽBA SPOLU", 20, y + 9);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.text(eur(d.gross_total), pageW - 20, y + 15, { align: "right" });
  doc.setFontSize(9);
  doc.setTextColor(190, 190, 200);
  doc.text(
    `${plural(d.orders_count, "doklad", "doklady", "dokladov")} · ${plural(
      d.tickets_count,
      "vstupenka",
      "vstupenky",
      "vstupeniek",
    )}`,
    20,
    y + 17,
  );
  setText(doc, INK);
  y += 34;

  y = sectionTitle(doc, "Tržby podľa spôsobu platby", y);
  const payRows: [string, number][] = [
    ["Hotovosť", d.cash_total],
    ["Karta", d.card_total],
    ["Prevod", d.transfer_total],
    ["Zdarma / voľné vstupenky", d.free_total],
  ];
  for (const [label, value] of payRows) {
    labelValue(doc, label, eur(value), y);
    y += 6.5;
  }
  setDraw(doc, LINE);
  doc.line(14, y - 2, pageW - 14, y - 2);
  y += 3;
  labelValue(doc, "Spolu", eur(d.gross_total), y, { bold: true, size: 11 });
  y += 12;

  y = sectionTitle(doc, "Hotovosť v zásuvke", y);
  labelValue(doc, "Počiatočná hotovosť", eur(d.opening_cash), y);
  y += 6.5;
  labelValue(doc, "Očakávaná hotovosť", eur(d.expected_cash), y);
  y += 6.5;
  labelValue(
    doc,
    "Spočítaná hotovosť",
    d.counted_cash === null ? "nespočítaná" : eur(d.counted_cash),
    y,
  );
  y += 6.5;
  if (d.cash_difference !== null) {
    const diff = d.cash_difference;
    doc.setFontSize(11);
    setText(doc, MUTED);
    doc.text("Rozdiel", 14, y);
    setText(doc, diff === 0 ? OK : DANGER);
    doc.text(`${diff > 0 ? "+" : ""}${eur(diff)}`, pageW - 14, y, { align: "right" });
    setText(doc, INK);
    y += 8;
  }

  if (d.voided_count > 0) {
    y += 4;
    y = sectionTitle(doc, "Stornované doklady", y);
    labelValue(doc, `Počet: ${d.voided_count}`, eur(d.voided_total), y);
    y += 10;
  }

  if (d.note) {
    y += 2;
    y = sectionTitle(doc, "Poznámka", y);
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(d.note, pageW - 28) as string[];
    doc.text(lines, 14, y);
    y += lines.length * 5 + 6;
  }

  // Zoznam dokladov. Dlhý deň sa nezmestí na stranu, tak sa stránkuje.
  if (d.sales.length > 0) {
    if (y > 220) {
      doc.addPage();
      y = 24;
    }
    y = sectionTitle(doc, `Doklady v období (${d.sales.length})`, y);
    doc.setFontSize(8);
    setText(doc, MUTED);
    doc.text("DOKLAD", 14, y);
    doc.text("ČAS", 48, y);
    doc.text("PODUJATIE", 68, y);
    doc.text("PLATBA", 138, y);
    doc.text("SUMA", pageW - 14, y, { align: "right" });
    setDraw(doc, LINE);
    doc.line(14, y + 1.5, pageW - 14, y + 1.5);
    y += 6;

    setText(doc, INK);
    doc.setFontSize(8.5);
    for (const s of d.sales) {
      if (y > 268) {
        doc.addPage();
        y = 24;
      }
      const cas = new Date(s.created_at).toLocaleTimeString("sk-SK", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const storno = s.status !== "paid";
      if (storno) setText(doc, DANGER);
      doc.text(s.receipt_number, 14, y);
      doc.text(cas, 48, y);
      doc.text(trim(doc, s.event_title, 66), 68, y);
      doc.text(payLabel(s.payment_method), 138, y);
      doc.text(storno ? `− ${eur(s.total)}` : eur(s.total), pageW - 14, y, { align: "right" });
      setText(doc, INK);
      y += 5;
    }
  }

  // Podpisy na poslednú stranu.
  const pageH = doc.internal.pageSize.getHeight();
  if (y > pageH - 62) {
    doc.addPage();
    y = 24;
  }
  const signY = Math.max(y + 16, pageH - 56);
  setDraw(doc, LINE);
  doc.line(20, signY, 90, signY);
  doc.line(pageW - 90, signY, pageW - 20, signY);
  doc.setFontSize(8);
  setText(doc, MUTED);
  doc.text("Pokladník", 20, signY + 4.5);
  doc.text("Prevzal", pageW - 90, signY + 4.5);
  setText(doc, INK);

  pageFooter(doc, [
    "Uzávierka je zmrazený doklad — neskorší predaj ani storno ju už nemenia.",
    "vipky.sk · support@vipky.sk",
  ]);

  return toBase64(doc);
}

function sectionTitle(doc: ReturnType<typeof newDoc>, text: string, y: number): number {
  setFill(doc, FLAME);
  doc.rect(14, y - 3.2, 2.5, 4, "F");
  doc.setFontSize(10);
  setText(doc, INK);
  doc.text(text, 19.5, y);
  return y + 8;
}

/** Skráti text tak, aby sa zmestil do šírky v mm. */
function trim(doc: ReturnType<typeof newDoc>, text: string, maxMm: number): string {
  if (doc.getTextWidth(text) <= maxMm) return text;
  let out = text;
  while (out.length > 1 && doc.getTextWidth(out + "…") > maxMm) out = out.slice(0, -1);
  return out + "…";
}

// --- Pokladničný doklad -----------------------------------------------

/**
 * Doklad na 80 mm pás. Výšku počítame dopredu z počtu položiek — jsPDF vie
 * formát zadať len pri zakladaní dokumentu, dodatočne sa strana nedá natiahnuť.
 */
export function generateReceiptPdfBase64(d: ReceiptPdfData): string {
  const W = 80;
  const M = 5; // okraj
  const inner = W - 2 * M;
  const fiscalLines = [
    d.fiscal?.ico && `IČO: ${d.fiscal.ico}`,
    d.fiscal?.dic && `DIČ: ${d.fiscal.dic}`,
    d.fiscal?.ic_dph && `IČ DPH: ${d.fiscal.ic_dph}`,
    d.fiscal?.premises_name,
    d.fiscal?.premises_address,
  ].filter(Boolean) as string[];

  const height =
    64 +
    fiscalLines.length * 4 +
    d.items.length * 9 +
    (d.discount > 0 ? 6 : 0) +
    (d.promo_code ? 5 : 0) +
    (d.fiscal?.cash_register_code ? 10 : 0) +
    (d.status !== "paid" ? 10 : 0) +
    30;

  const doc = newDoc([W, height]);
  let y = 10;

  doc.setFontSize(15);
  setText(doc, INK);
  doc.text("vipky.sk", W / 2, y, { align: "center" });
  y += 5;
  doc.setFontSize(8);
  setText(doc, MUTED);
  doc.text(d.organizer_name, W / 2, y, { align: "center", maxWidth: inner });
  y += 4;
  for (const line of fiscalLines) {
    doc.text(line, W / 2, y, { align: "center", maxWidth: inner });
    y += 4;
  }
  y += 2;

  dashed(doc, y, M, W - M);
  y += 4;

  doc.setFontSize(11);
  setText(doc, INK);
  doc.text("POKLADNIČNÝ DOKLAD", W / 2, y, { align: "center" });
  y += 5;
  doc.setFontSize(9);
  doc.text(d.receipt_number, W / 2, y, { align: "center" });
  y += 4.5;
  doc.setFontSize(8);
  setText(doc, MUTED);
  doc.text(dateTime(d.created_at), W / 2, y, { align: "center" });
  y += 4;
  if (d.cashier_name) {
    doc.text(`Pokladník: ${d.cashier_name}`, W / 2, y, { align: "center" });
    y += 4;
  }
  y += 1;

  dashed(doc, y, M, W - M);
  y += 5;

  setText(doc, INK);
  doc.setFontSize(9);
  doc.text(trim(doc, d.event_title, inner), M, y);
  y += 4;
  if (d.event_date) {
    doc.setFontSize(8);
    setText(doc, MUTED);
    doc.text(d.event_date, M, y);
    y += 4;
  }
  y += 2;

  // Položky: názov na vlastnom riadku, pod ním „2 × 25,00 €" a suma vpravo.
  for (const it of d.items) {
    setText(doc, INK);
    doc.setFontSize(9);
    doc.text(trim(doc, it.label, inner), M, y);
    y += 4;
    doc.setFontSize(8);
    setText(doc, MUTED);
    doc.text(`${it.quantity} × ${eur(it.unit_price)}`, M, y);
    setText(doc, INK);
    doc.text(eur(it.quantity * it.unit_price), W - M, y, { align: "right" });
    y += 5;
  }

  y += 1;
  dashed(doc, y, M, W - M);
  y += 5;

  doc.setFontSize(9);
  if (d.discount > 0) {
    setText(doc, MUTED);
    doc.text("Medzisúčet", M, y);
    setText(doc, INK);
    doc.text(eur(d.subtotal), W - M, y, { align: "right" });
    y += 5;
    setText(doc, MUTED);
    doc.text("Zľava", M, y);
    setText(doc, INK);
    doc.text(`− ${eur(d.discount)}`, W - M, y, { align: "right" });
    y += 5;
  }
  if (d.promo_code) {
    doc.setFontSize(8);
    setText(doc, MUTED);
    doc.text(`Kupón: ${d.promo_code}`, M, y);
    y += 5;
  }

  doc.setFontSize(13);
  setText(doc, INK);
  doc.text("SPOLU", M, y + 1);
  doc.text(eur(d.total), W - M, y + 1, { align: "right" });
  y += 7;

  doc.setFontSize(8);
  setText(doc, MUTED);
  doc.text(`Platba: ${payLabel(d.payment_method)}`, M, y);
  y += 5;

  if (d.status !== "paid") {
    setText(doc, DANGER);
    doc.setFontSize(11);
    doc.text("STORNOVANÝ DOKLAD", W / 2, y + 2, { align: "center" });
    setText(doc, INK);
    y += 9;
  }

  if (d.fiscal?.cash_register_code) {
    dashed(doc, y, M, W - M);
    y += 4;
    doc.setFontSize(7.5);
    setText(doc, MUTED);
    doc.text(`DKP: ${d.fiscal.cash_register_code}`, W / 2, y, { align: "center" });
    y += 5;
  }

  y += 2;
  dashed(doc, y, M, W - M);
  y += 5;
  doc.setFontSize(8);
  setText(doc, MUTED);
  doc.text("Ďakujeme za návštevu!", W / 2, y, { align: "center" });
  y += 4;
  doc.text("www.vipky.sk", W / 2, y, { align: "center" });

  return toBase64(doc);
}

/** Prerušovaná čiara — na doklade oddeľuje bloky ako na páse z pokladne. */
function dashed(doc: ReturnType<typeof newDoc>, y: number, x1: number, x2: number) {
  setDraw(doc, LINE);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(x1, y, x2, y);
  doc.setLineDashPattern([], 0);
}
