// Cashier / eKasa session layer for vipky.sk POS.
// LocalStorage prototype — pripravené na napojenie na reálnu DB.
//
// Bezpečnosť: PIN sa NIKDY neukladá v plain texte, iba ako SHA-256 hash
// (Web Crypto API).

import { uid } from "./local-db";
import { POS_EVENT, getSales } from "./pos-db";

export type CashierPermission =
  | "sale"
  | "void"
  | "refund"
  | "open_register"
  | "close_register"
  | "view_sales";

export const ALL_PERMISSIONS: { key: CashierPermission; label: string }[] = [
  { key: "sale", label: "Predaj vstupeniek" },
  { key: "void", label: "Storno predaja" },
  { key: "refund", label: "Refundácia" },
  { key: "open_register", label: "Otvorenie pokladne" },
  { key: "close_register", label: "Uzávierka pokladne" },
  { key: "view_sales", label: "Zobrazenie tržieb" },
];

export type CashierStatus = "active" | "inactive";

export type Cashier = {
  id: string;
  organizer_id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  pin_hash: string;
  status: CashierStatus;
  permissions: CashierPermission[];
  created_at: string;
  updated_at: string;
};

export type CashierSession = {
  id: string;
  cashier_id: string;
  cashier_display_name: string;
  organizer_id: string;
  opened_at: string;
  closed_at?: string;
  status: "open" | "closed";
  opening_cash_amount: number;
  closing_cash_amount?: number;
  total_cash_sales: number;
  total_card_sales: number;
  total_sales: number;
  order_count: number;
};

export type CashierClosure = {
  id: string;
  cashier_id: string;
  cashier_display_name: string;
  cashier_session_id: string;
  organizer_id: string;
  closing_cash_amount: number;
  expected_cash_amount: number;
  cash_difference: number;
  total_card_sales: number;
  total_cash_sales: number;
  total_sales: number;
  order_count: number;
  notes?: string;
  created_at: string;
};

const CASHIERS_KEY = "mt_cashiers_v2";
const SESSIONS_KEY = "mt_cashier_sessions";
const CLOSURES_KEY = "mt_cashier_closures";
const ACTIVE_KEY = "mt_pos_active_cashier_session"; // per browser

const isBrowser = () => typeof window !== "undefined";
function read<T>(k: string, f: T): T {
  if (!isBrowser()) return f;
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) as T : f; } catch { return f; }
}
function write<T>(k: string, v: T) { if (isBrowser()) localStorage.setItem(k, JSON.stringify(v)); }
function emit() { if (isBrowser()) window.dispatchEvent(new Event(POS_EVENT)); }

// ---------- PIN hashing ----------
export async function hashPin(pin: string): Promise<string> {
  if (!isBrowser() || !crypto?.subtle) {
    // SSR fallback — never used at runtime for auth
    return `plain:${pin}`;
  }
  const data = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  const candidate = await hashPin(pin);
  return candidate === hash;
}

// ---------- Cashiers ----------
export function getCashiers(): Cashier[] { return read<Cashier[]>(CASHIERS_KEY, []); }
export function getCashiersForOrganizer(organizerId: string): Cashier[] {
  return getCashiers().filter((c) => c.organizer_id === organizerId);
}
export function getActiveCashiersForOrganizer(organizerId: string): Cashier[] {
  return getCashiersForOrganizer(organizerId).filter((c) => c.status === "active");
}
export function saveCashiers(list: Cashier[]) { write(CASHIERS_KEY, list); emit(); }
export function getCashier(id: string): Cashier | undefined {
  return getCashiers().find((c) => c.id === id);
}
export function upsertCashier(c: Cashier) {
  const all = getCashiers();
  const i = all.findIndex((x) => x.id === c.id);
  if (i >= 0) all[i] = c; else all.unshift(c);
  saveCashiers(all);
}
export function deleteCashier(id: string) {
  saveCashiers(getCashiers().filter((c) => c.id !== id));
}
export function setCashierStatus(id: string, status: CashierStatus) {
  const all = getCashiers().map((c) => c.id === id ? { ...c, status, updated_at: new Date().toISOString() } : c);
  saveCashiers(all);
}
export async function resetCashierPin(id: string, newPin: string) {
  const pin_hash = await hashPin(newPin);
  const all = getCashiers().map((c) => c.id === id ? { ...c, pin_hash, updated_at: new Date().toISOString() } : c);
  saveCashiers(all);
}

// ---------- Sessions ----------
export function getSessions(): CashierSession[] { return read<CashierSession[]>(SESSIONS_KEY, []); }
export function saveSessions(s: CashierSession[]) { write(SESSIONS_KEY, s); emit(); }
export function getSession(id: string): CashierSession | undefined {
  return getSessions().find((s) => s.id === id);
}

export function openSession(input: {
  cashier_id: string;
  cashier_display_name: string;
  organizer_id: string;
  opening_cash_amount?: number;
}): CashierSession {
  const s: CashierSession = {
    id: uid(),
    cashier_id: input.cashier_id,
    cashier_display_name: input.cashier_display_name,
    organizer_id: input.organizer_id,
    opened_at: new Date().toISOString(),
    status: "open",
    opening_cash_amount: input.opening_cash_amount ?? 0,
    total_cash_sales: 0,
    total_card_sales: 0,
    total_sales: 0,
    order_count: 0,
  };
  saveSessions([s, ...getSessions()]);
  setActiveSessionId(s.id);
  return s;
}

export function closeSession(id: string, closingCash?: number) {
  const all = getSessions().map((s) => s.id === id
    ? { ...s, status: "closed" as const, closed_at: new Date().toISOString(), closing_cash_amount: closingCash }
    : s);
  saveSessions(all);
  const active = getActiveSessionId();
  if (active === id) setActiveSessionId(null);
}

// Recompute totals from sales bound to this session.
export function computeSessionTotals(sessionId: string) {
  const sales = getSales().filter((s) => s.cashier_session_id === sessionId && s.status === "paid");
  const cash = sales.filter((s) => s.payment_method === "cash").reduce((a, b) => a + b.total, 0);
  const card = sales.filter((s) => s.payment_method === "card").reduce((a, b) => a + b.total, 0);
  const transfer = sales.filter((s) => s.payment_method === "transfer").reduce((a, b) => a + b.total, 0);
  const free = sales.filter((s) => s.payment_method === "free").reduce((a, b) => a + b.total, 0);
  const total = cash + card + transfer + free;
  return {
    total_cash_sales: cash,
    total_card_sales: card,
    total_transfer_sales: transfer,
    total_free_sales: free,
    total_sales: total,
    order_count: sales.length,
    voided_count: getSales().filter((s) => s.cashier_session_id === sessionId && s.status === "void").length,
  };
}

// ---------- Active session (per browser) ----------
export function getActiveSessionId(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(ACTIVE_KEY);
}
export function setActiveSessionId(id: string | null) {
  if (!isBrowser()) return;
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
  emit();
}
export function getActiveSession(): CashierSession | null {
  const id = getActiveSessionId();
  if (!id) return null;
  const s = getSession(id);
  if (!s || s.status !== "open") {
    if (s && s.status !== "open") setActiveSessionId(null);
    return null;
  }
  return s;
}
export function getActiveCashier(): Cashier | null {
  const s = getActiveSession();
  if (!s) return null;
  return getCashier(s.cashier_id) ?? null;
}

// ---------- Closures ----------
export function getClosures(): CashierClosure[] { return read<CashierClosure[]>(CLOSURES_KEY, []); }
export function addClosure(c: CashierClosure) { write(CLOSURES_KEY, [c, ...getClosures()]); emit(); }
