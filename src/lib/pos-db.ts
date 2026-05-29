// POS / Pokladňa local storage layer for MAXITICKET.
// Architektúra je pripravená na neskoršie napojenie na reálnu DB,
// ORP / eKasa (fiscal-adapter) a USB platobné terminály (payment-terminal-adapter).


import { uid } from "./local-db";

export type PaymentMethod = "cash" | "card" | "transfer" | "free";

export type PosSaleItem = {
  ticket_id: string;
  ticket_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
};

export type PosSale = {
  id: string;
  receipt_number: string;
  organizer_id: string;
  cashier_id: string;
  cashier_name: string;
  event_id: string;
  event_title: string;
  items: PosSaleItem[];
  subtotal: number;
  discount: number;
  promo_code?: string;
  total: number;
  payment_method: PaymentMethod;
  status: "paid" | "void";
  fiscal_receipt_id?: string;
  terminal_tx_id?: string;
  created_at: string;
  voided_at?: string;
  void_reason?: string;
  qr_codes: string[]; // jeden QR per predaná vstupenku
};

export type PosCashier = {
  id: string;
  organizer_id: string;
  name: string;
  email: string;
  pin: string;
  can_void: boolean;
  created_at: string;
};

export type DeviceType = "terminal" | "printer" | "scanner";
export type DeviceConnection = "USB" | "Bluetooth" | "LAN";
export type DeviceStatus = "active" | "inactive" | "error";

export type PosDevice = {
  id: string;
  organizer_id: string;
  name: string;
  location?: string;
  device_type: DeviceType;
  connection: DeviceConnection;
  status: DeviceStatus;
  last_connected_at?: string;
  terminal_connected: boolean; // legacy / quick flag
  created_at: string;
};

export type PosClosing = {
  id: string;
  organizer_id: string;
  cashier_id?: string;
  date: string;
  cash_total: number;
  card_total: number;
  transfer_total: number;
  free_total: number;
  voided_total: number;
  receipts_count: number;
  tickets_count: number;
  created_at: string;
};

export type PosSession = {
  id: string;
  organizer_id: string;
  cashier_id: string;
  cashier_name: string;
  event_id: string;
  event_title: string;
  opened_at: string;
  closed_at?: string;
  status: "open" | "closed";
};

export type PosTicket = {
  id: string;
  code: string; // QR string
  organizer_id: string;
  event_id: string;
  sale_id: string;
  ticket_type_id: string;
  ticket_type_name: string;
  price: number;
  status: "valid" | "used" | "cancelled";
  created_at: string;
};

export type PaymentTerminalTx = {
  id: string;
  organizer_id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: "approved" | "declined" | "cancelled";
  auth_code?: string;
  card_brand?: string;
  card_last4?: string;
  created_at: string;
};

export type FiscalReceipt = {
  id: string;
  receipt_number: string;
  organizer_id: string;
  sale_id?: string;
  ico: string;
  dkp: string;
  total: number;
  vat_rate: number;
  payment_method: string;
  signature?: string;
  qr_url?: string;
  status: "issued" | "cancelled";
  created_at: string;
  cancelled_at?: string;
};

export type OrpConnectionStatus = "connected" | "disconnected" | "error";

export type FiscalSettings = {
  mode: "mock" | "production";
  provider: "ORP" | "eKasa";
  orp_provider: string;
  api_url: string;
  api_key: string;
  client_id: string;
  client_secret: string;
  ico: string;
  dic: string;
  ic_dph: string;
  pos_code: string;
  premises_code: string;
  premises_name: string;
  premises_address: string;
  connection_status: OrpConnectionStatus;
  last_tested_at?: string;
  last_error?: string;
};

export type AuditLog = {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  entity: string;
  entity_id?: string;
  meta?: Record<string, unknown>;
  created_at: string;
};

const SALES = "mt_pos_sales";
const CASHIERS = "mt_pos_cashiers";
const DEVICES = "mt_pos_devices";
const CLOSINGS = "mt_pos_closings";
const AUDIT = "mt_audit_logs";
const SESSIONS = "mt_pos_sessions";
const TICKETS = "mt_pos_tickets";
const TERMINAL_TX = "mt_payment_terminal_tx";
const FISCAL_RECEIPTS = "mt_fiscal_receipts";
const FISCAL_SETTINGS = "mt_fiscal_settings";

export const POS_EVENT = "mt:pos-change";

const isBrowser = () => typeof window !== "undefined";
function read<T>(k: string, f: T): T {
  if (!isBrowser()) return f;
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) as T : f; } catch { return f; }
}
function write<T>(k: string, v: T) { if (isBrowser()) localStorage.setItem(k, JSON.stringify(v)); }
export function emitPos() { if (isBrowser()) window.dispatchEvent(new Event(POS_EVENT)); }

// ---------- Sales ----------
export function getSales(): PosSale[] { return read<PosSale[]>(SALES, []); }
export function saveSales(s: PosSale[]) { write(SALES, s); }
export function addSale(s: PosSale) { const all = getSales(); all.unshift(s); saveSales(all); emitPos(); }
export function voidSale(id: string, reason: string) {
  const all = getSales();
  const idx = all.findIndex((s) => s.id === id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], status: "void", voided_at: new Date().toISOString(), void_reason: reason };
    saveSales(all);
    // cascade cancel tickets
    const tickets = getTickets().map((t) => t.sale_id === id ? { ...t, status: "cancelled" as const } : t);
    saveTickets(tickets);
    emitPos();
  }
}
export function nextReceiptNumber(): string {
  const year = new Date().getFullYear();
  const n = getSales().length + 1;
  return `${year}-${String(n).padStart(6, "0")}`;
}

// ---------- Cashiers ----------
export function getCashiers(): PosCashier[] { return read<PosCashier[]>(CASHIERS, []); }
export function saveCashiers(c: PosCashier[]) { write(CASHIERS, c); }
export function upsertCashier(c: PosCashier) {
  const all = getCashiers();
  const i = all.findIndex((x) => x.id === c.id);
  if (i >= 0) all[i] = c; else all.unshift(c);
  saveCashiers(all); emitPos();
}
export function deleteCashier(id: string) { saveCashiers(getCashiers().filter((c) => c.id !== id)); emitPos(); }

// ---------- Devices ----------
export function getDevices(): PosDevice[] { return read<PosDevice[]>(DEVICES, []); }
export function saveDevices(d: PosDevice[]) { write(DEVICES, d); }

// ---------- Closings ----------
export function getClosings(): PosClosing[] { return read<PosClosing[]>(CLOSINGS, []); }
export function addClosing(c: PosClosing) { const all = getClosings(); all.unshift(c); write(CLOSINGS, all); emitPos(); }

// ---------- Sessions ----------
export function getSessions(): PosSession[] { return read<PosSession[]>(SESSIONS, []); }
export function addSession(s: PosSession) { const all = getSessions(); all.unshift(s); write(SESSIONS, all); emitPos(); }
export function closeSession(id: string) {
  const all = getSessions().map((s) => s.id === id ? { ...s, status: "closed" as const, closed_at: new Date().toISOString() } : s);
  write(SESSIONS, all); emitPos();
}

// ---------- Tickets (POS-issued) ----------
export function getTickets(): PosTicket[] { return read<PosTicket[]>(TICKETS, []); }
export function saveTickets(t: PosTicket[]) { write(TICKETS, t); }
export function addTickets(t: PosTicket[]) { const all = getTickets(); saveTickets([...t, ...all]); emitPos(); }

// ---------- Terminal Transactions ----------
export function getTerminalTx(): PaymentTerminalTx[] { return read<PaymentTerminalTx[]>(TERMINAL_TX, []); }
export function addTerminalTx(t: PaymentTerminalTx) { const all = getTerminalTx(); all.unshift(t); write(TERMINAL_TX, all); emitPos(); }
export function updateTerminalTx(id: string, patch: Partial<PaymentTerminalTx>) {
  const all = getTerminalTx().map((t) => t.id === id ? { ...t, ...patch } : t);
  write(TERMINAL_TX, all); emitPos();
}

// ---------- Fiscal Receipts ----------
export function getFiscalReceipts(): FiscalReceipt[] { return read<FiscalReceipt[]>(FISCAL_RECEIPTS, []); }
export function addFiscalReceipt(r: FiscalReceipt) { const all = getFiscalReceipts(); all.unshift(r); write(FISCAL_RECEIPTS, all); emitPos(); }
export function cancelFiscalReceiptInStore(id: string) {
  const all = getFiscalReceipts().map((r) => r.id === id ? { ...r, status: "cancelled" as const, cancelled_at: new Date().toISOString() } : r);
  write(FISCAL_RECEIPTS, all); emitPos();
}

// ---------- Fiscal Settings ----------
const DEFAULT_FISCAL_SETTINGS: FiscalSettings = {
  mode: "mock",
  provider: "VRP2",
  api_url: "",
  api_key: "",
  dic: "",
  ic_dph: "",
  pos_code: "0000",
  premises: "",
  connected: false,
};
export function getFiscalSettings(): FiscalSettings { return read<FiscalSettings>(FISCAL_SETTINGS, DEFAULT_FISCAL_SETTINGS); }
export function saveFiscalSettings(s: FiscalSettings) { write(FISCAL_SETTINGS, s); emitPos(); }

// ---------- Audit ----------
export function getAuditLogs(): AuditLog[] { return read<AuditLog[]>(AUDIT, []); }
export function logAudit(entry: Omit<AuditLog, "id" | "created_at">) {
  const all = getAuditLogs();
  all.unshift({ ...entry, id: uid(), created_at: new Date().toISOString() });
  write(AUDIT, all.slice(0, 500));
}

// ---------- Reporting ----------
export function computeClosing(
  organizerId: string,
  date: string,
): Omit<PosClosing, "id" | "created_at" | "organizer_id" | "cashier_id" | "date"> {
  const sales = getSales().filter(
    (s) => s.organizer_id === organizerId && s.created_at.startsWith(date),
  );
  const acc = { cash_total: 0, card_total: 0, transfer_total: 0, free_total: 0, voided_total: 0, receipts_count: 0, tickets_count: 0 };
  for (const s of sales) {
    if (s.status === "void") { acc.voided_total += s.total; continue; }
    acc.receipts_count += 1;
    acc.tickets_count += s.items.reduce((a, b) => a + b.quantity, 0);
    if (s.payment_method === "cash") acc.cash_total += s.total;
    if (s.payment_method === "card") acc.card_total += s.total;
    if (s.payment_method === "transfer") acc.transfer_total += s.total;
    if (s.payment_method === "free") acc.free_total += s.total;
  }
  return acc;
}
