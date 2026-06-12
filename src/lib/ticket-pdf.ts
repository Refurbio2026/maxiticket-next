// PDF ticket generator using jsPDF + qrcode (server-rendered SVG inlined as data URL).
// Pure client-side. Generates one A4 page per ticket with QR code + event info.

import jsPDF from "jspdf";
import type { IssuedTicket, Order } from "@/lib/ticketing-db";
import type { EventItem } from "@/lib/local-db";

// Lazy QR generator using a public chart endpoint as PNG image — no extra deps.
// Falls back gracefully if offline (we still render the textual QR payload).
async function qrPngDataUrl(value: string, size = 360): Promise<string | null> {
  try {
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&margin=0`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function generateTicketsPdf(opts: {
  order: Order;
  event: EventItem | undefined;
  tickets: IssuedTicket[];
}): Promise<Blob> {
  const { order, event, tickets } = opts;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const pageW = doc.internal.pageSize.getWidth();

  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) doc.addPage();
    const t = tickets[i];

    // Header band
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 28, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("vstupenky.sk", 14, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Vstupenka #${i + 1} z ${tickets.length}`, pageW - 14, 18, { align: "right" });

    // Event title
    doc.setTextColor(20, 20, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text(event?.title ?? "Podujatie", 14, 46);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(80, 80, 80);
    if (event) {
      doc.text(`Dátum:   ${event.event_date} · ${event.event_time}`, 14, 56);
      doc.text(`Miesto:  ${event.venue}, ${event.city}`, 14, 63);
    }
    doc.text(`Sektor / sedadlo: ${t.seat_label}`, 14, 70);
    doc.text(`Objednávka: ${order.id.slice(0, 8).toUpperCase()}`, 14, 77);
    if (order.customer_email) doc.text(`Email: ${order.customer_email}`, 14, 84);

    // QR
    const dataUrl = await qrPngDataUrl(t.qr_code, 360);
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
    doc.text(t.qr_code, pageW - 47, 108, { align: "center", maxWidth: 70 });

    // Footer
    doc.setDrawColor(220);
    doc.line(14, 260, pageW - 14, 260);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text("Vstup je platný iba s QR kódom. Pri vstupe ukáž kód z mobilu alebo vytlačenú vstupenku.", 14, 268);
    doc.text("Reklamácie: support@vstupenky.sk · www.vstupenky.sk", 14, 274);
  }

  return doc.output("blob");
}

export async function downloadTicketsPdf(opts: {
  order: Order;
  event: EventItem | undefined;
  tickets: IssuedTicket[];
}) {
  const blob = await generateTicketsPdf(opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vstupenky-${opts.order.id.slice(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

// ---------- Bulk: all sold tickets of one event ----------

export type SoldTicketLite = {
  seat_label: string;
  qr_code: string;
  order_id: string;
  customer_name: string | null;
  customer_email: string | null;
  used_at: string | null;
};

export async function generateEventSoldTicketsPdf(opts: {
  event: { title: string; event_date: string; event_time: string; venue: string; city: string };
  tickets: SoldTicketLite[];
}): Promise<Blob> {
  const { event, tickets } = opts;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  for (let i = 0; i < tickets.length; i++) {
    if (i > 0) doc.addPage();
    const t = tickets[i];

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 28, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("vstupenky.sk", 14, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Vstupenka ${i + 1} / ${tickets.length}`, pageW - 14, 18, { align: "right" });

    doc.setTextColor(20, 20, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text(event.title, 14, 46);

    doc.setFont("helvetica", "normal");
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
      doc.setTextColor(80, 80, 80);
    }

    const dataUrl = await qrPngDataUrl(t.qr_code, 360);
    if (dataUrl) {
      doc.addImage(dataUrl, "PNG", pageW - 80, 38, 65, 65);
    } else {
      doc.setDrawColor(180);
      doc.rect(pageW - 80, 38, 65, 65);
    }
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(t.qr_code, pageW - 47, 108, { align: "center", maxWidth: 70 });

    doc.setDrawColor(220);
    doc.line(14, 260, pageW - 14, 260);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text("Vstup je platný iba s QR kódom.", 14, 268);
    doc.text("vstupenky.sk · www.vstupenky.sk", 14, 274);
  }

  return doc.output("blob");
}

export async function downloadEventSoldTicketsPdf(opts: {
  event: { title: string; event_date: string; event_time: string; venue: string; city: string };
  tickets: SoldTicketLite[];
}) {
  const blob = await generateEventSoldTicketsPdf(opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = opts.event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  a.download = `qr-listky-${slug}-${opts.event.event_date}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

