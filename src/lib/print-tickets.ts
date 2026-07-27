import type { PosTicket, PosSale } from "./pos-db";
import type { EventItem } from "./local-db";

function qrUrl(code: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(code)}`;
}

function ticketHtml(t: PosTicket, sale: PosSale, ev?: EventItem, index?: number, total?: number) {
  const date = ev?.event_date || "";
  const time = ev?.event_time || "";
  const venue = ev ? `${ev.venue || ""}${ev.city ? ", " + ev.city : ""}` : "";
  return `
  <section class="ticket">
    <header>
      <div class="brand">vipky.sk</div>
      <div class="seq">${index ?? ""}${total ? " / " + total : ""}</div>
    </header>
    <h1>${escapeHtml(ev?.title || sale.event_title)}</h1>
    <div class="meta">
      <div><span>Dátum</span><strong>${escapeHtml(date)}</strong></div>
      <div><span>Čas</span><strong>${escapeHtml(time)}</strong></div>
      <div><span>Miesto</span><strong>${escapeHtml(venue)}</strong></div>
      <div><span>Typ vstupenky</span><strong>${escapeHtml(t.ticket_type_name)}</strong></div>
      <div><span>Cena</span><strong>€${t.price.toFixed(2)}</strong></div>
      <div><span>Stav</span><strong class="status">${t.status.toUpperCase()}</strong></div>
    </div>
    <div class="qrbox">
      <img src="${qrUrl(t.code)}" alt="QR ${t.code}" />
      <div class="code">${escapeHtml(t.code)}</div>
    </div>
    <footer>
      <div><span>Ticket ID</span><strong>${t.id}</strong></div>
      <div><span>Predaj</span><strong>${escapeHtml(sale.receipt_number)} · ${sale.id}</strong></div>
    </footer>
  </section>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function printTickets(tickets: PosTicket[], sale: PosSale, ev?: EventItem) {
  if (tickets.length === 0) return;
  const w = window.open("", "_blank", "width=820,height=900");
  if (!w) return;
  const body = tickets
    .map((t, i) => ticketHtml(t, sale, ev, i + 1, tickets.length))
    .join("");
  w.document.write(`<!doctype html><html lang="sk"><head><meta charset="utf-8"/><title>Vstupenky · ${escapeHtml(sale.receipt_number)}</title>
  <style>
    @page { size: A5; margin: 12mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #0a0a0a; font-family: -apple-system, "Segoe UI", Roboto, Inter, sans-serif; }
    .ticket { width: 100%; min-height: 100vh; padding: 18mm 14mm; display: flex; flex-direction: column; gap: 14px;
              border: 2px dashed #111; page-break-after: always; break-after: page; }
    .ticket:last-child { page-break-after: auto; break-after: auto; }
    header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #111; padding-bottom: 8px; }
    .brand { font-weight: 800; letter-spacing: 0.12em; font-size: 14px; }
    .seq { font-size: 12px; color: #555; }
    h1 { font-size: 28px; margin: 6px 0 4px; line-height: 1.15; }
    .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 18px; font-size: 12px; }
    .meta > div { display: flex; flex-direction: column; border-bottom: 1px dotted #bbb; padding: 4px 0; }
    .meta span { color: #666; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
    .meta strong { font-size: 14px; }
    .status { color: #0a7d2c; }
    .qrbox { display: flex; flex-direction: column; align-items: center; gap: 6px; margin: 8px 0; }
    .qrbox img { width: 220px; height: 220px; }
    .code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; }
    footer { margin-top: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; font-size: 10px; border-top: 1px solid #111; padding-top: 6px; }
    footer span { color: #666; text-transform: uppercase; letter-spacing: 0.08em; display: block; }
    footer strong { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body>${body}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));</script></body></html>`);
  w.document.close();
}
