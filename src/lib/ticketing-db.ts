// LocalStorage ticketing layer: orders, tickets, seat inventory.
// SSR-safe (guards via typeof window).

import { uid } from "./local-db";

export type SeatStatus = "available" | "reserved" | "sold";

export type SeatInventoryRow = {
  event_id: string;
  seat_id: string;        // shape.id from layout
  status: SeatStatus;
  price: number;
  reserved_until?: string;
  order_id?: string;
  is_vip?: boolean;
  label?: string;         // e.g. "Rad A · 5"
};

export type OrderStatus = "pending" | "paid" | "cancelled" | "expired";

export type OrderItem = {
  seat_id?: string;       // empty for standing/general
  label: string;
  price: number;
};

export type Order = {
  id: string;
  event_id: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  items: OrderItem[];
  total_amount: number;
  status: OrderStatus;
  expires_at: string;
  created_at: string;
  paid_at?: string;
};

export type IssuedTicket = {
  id: string;
  order_id: string;
  event_id: string;
  seat_label: string;
  qr_code: string;
  issued_at: string;
};

const INV_KEY = "mt_seat_inventory";
const ORDERS_KEY = "mt_orders";
const TICKETS_KEY = "mt_tickets";

export const INV_EVENT = "mt:inventory-change";
export const ORDERS_EVENT = "mt:orders-change";

const isBrowser = () => typeof window !== "undefined";

function read<T>(k: string, f: T): T {
  if (!isBrowser()) return f;
  try {
    const raw = window.localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : f;
  } catch {
    return f;
  }
}
function write<T>(k: string, v: T) {
  if (!isBrowser()) return;
  window.localStorage.setItem(k, JSON.stringify(v));
}
function emit(name: string) {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event(name));
}

// -------- Seat inventory --------

export function getInventory(eventId: string): SeatInventoryRow[] {
  return read<SeatInventoryRow[]>(INV_KEY, []).filter((r) => r.event_id === eventId);
}

function setAllInventory(rows: SeatInventoryRow[]) {
  write(INV_KEY, rows);
  emit(INV_EVENT);
}

export function releaseExpired() {
  const now = new Date().toISOString();
  const all = read<SeatInventoryRow[]>(INV_KEY, []);
  let changed = false;
  for (const r of all) {
    if (r.status === "reserved" && r.reserved_until && r.reserved_until < now) {
      r.status = "available";
      r.reserved_until = undefined;
      r.order_id = undefined;
      changed = true;
    }
  }
  if (changed) setAllInventory(all);
}

/** Reserves seats. Accepts rows already held by the same cart session. Returns false on conflict. */
export function reserveSeats(
  eventId: string,
  seats: Array<{ seat_id: string; price: number; label: string; is_vip?: boolean }>,
  orderId: string,
  minutes = 10,
): boolean {
  releaseExpired();
  const myHoldKey = `hold:${getCartSessionId()}`;
  const all = read<SeatInventoryRow[]>(INV_KEY, []);
  const byKey = new Map(all.map((r) => [`${r.event_id}::${r.seat_id}`, r]));
  // conflict check — allow rows we already hold in this session
  for (const s of seats) {
    const row = byKey.get(`${eventId}::${s.seat_id}`);
    if (!row) continue;
    if (row.status === "available") continue;
    if (row.status === "reserved" && row.order_id === myHoldKey) continue;
    return false;
  }
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  for (const s of seats) {
    const key = `${eventId}::${s.seat_id}`;
    const existing = byKey.get(key);
    const row: SeatInventoryRow = {
      event_id: eventId,
      seat_id: s.seat_id,
      status: "reserved",
      price: s.price,
      reserved_until: until,
      order_id: orderId,
      is_vip: s.is_vip,
      label: s.label,
    };
    if (existing) Object.assign(existing, row);
    else all.push(row);
  }
  setAllInventory(all);
  return true;
}

// -------- Cart-phase soft locks --------
// While a user is selecting seats (before checkout), each picked seat is
// immediately reserved under a synthetic order_id `hold:<sessionId>` so
// concurrent shoppers see it as taken. Hold TTL is short (default 2 min)
// and is refreshed by the page while the cart is open.

const CART_SID_KEY = "mt_cart_sid";

export function getCartSessionId(): string {
  if (!isBrowser()) return "ssr";
  try {
    let sid = window.sessionStorage.getItem(CART_SID_KEY);
    if (!sid) {
      sid = uid();
      window.sessionStorage.setItem(CART_SID_KEY, sid);
    }
    return sid;
  } catch {
    return "anon";
  }
}

function holdKey() {
  return `hold:${getCartSessionId()}`;
}

/** Soft-lock a single seat for the current cart session. Returns false on conflict. */
export function holdSeat(
  eventId: string,
  seat: { seat_id: string; price: number; label: string; is_vip?: boolean },
  minutes = 2,
): boolean {
  return reserveSeats(eventId, [seat], holdKey(), minutes);
}

/** Release a single held seat (only if held by this session). */
export function releaseHeldSeat(eventId: string, seatId: string) {
  const mine = holdKey();
  const all = read<SeatInventoryRow[]>(INV_KEY, []);
  let changed = false;
  for (const r of all) {
    if (
      r.event_id === eventId &&
      r.seat_id === seatId &&
      r.order_id === mine &&
      r.status === "reserved"
    ) {
      r.status = "available";
      r.reserved_until = undefined;
      r.order_id = undefined;
      changed = true;
    }
  }
  if (changed) setAllInventory(all);
}

/** Extend reservation deadline on all seats currently held by this session. */
export function extendHolds(eventId: string, minutes = 2) {
  const mine = holdKey();
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  const all = read<SeatInventoryRow[]>(INV_KEY, []);
  let changed = false;
  for (const r of all) {
    if (r.event_id === eventId && r.order_id === mine && r.status === "reserved") {
      r.reserved_until = until;
      changed = true;
    }
  }
  if (changed) setAllInventory(all);
}

/** Release every seat currently held by this session for the given event. */
export function releaseAllHolds(eventId: string) {
  const mine = holdKey();
  const all = read<SeatInventoryRow[]>(INV_KEY, []);
  let changed = false;
  for (const r of all) {
    if (r.event_id === eventId && r.order_id === mine && r.status === "reserved") {
      r.status = "available";
      r.reserved_until = undefined;
      r.order_id = undefined;
      changed = true;
    }
  }
  if (changed) setAllInventory(all);
}


export function markSold(eventId: string, orderId: string) {
  const all = read<SeatInventoryRow[]>(INV_KEY, []);
  for (const r of all) {
    if (r.event_id === eventId && r.order_id === orderId) {
      r.status = "sold";
      r.reserved_until = undefined;
    }
  }
  setAllInventory(all);
}

export function releaseOrder(orderId: string) {
  const all = read<SeatInventoryRow[]>(INV_KEY, []);
  for (const r of all) {
    if (r.order_id === orderId && r.status === "reserved") {
      r.status = "available";
      r.reserved_until = undefined;
      r.order_id = undefined;
    }
  }
  setAllInventory(all);
}

// -------- Orders --------

export function getOrders(): Order[] {
  return read<Order[]>(ORDERS_KEY, []);
}
export function getOrder(id: string): Order | undefined {
  return getOrders().find((o) => o.id === id);
}
export function upsertOrder(o: Order) {
  const list = getOrders();
  const i = list.findIndex((x) => x.id === o.id);
  if (i >= 0) list[i] = o;
  else list.unshift(o);
  write(ORDERS_KEY, list);
  emit(ORDERS_EVENT);
}

export function createOrder(input: {
  event_id: string;
  items: OrderItem[];
  total_amount: number;
}): Order {
  const order: Order = {
    id: uid(),
    event_id: input.event_id,
    items: input.items,
    total_amount: input.total_amount,
    status: "pending",
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    created_at: new Date().toISOString(),
  };
  upsertOrder(order);
  return order;
}

// -------- Tickets --------

export function getTickets(): IssuedTicket[] {
  return read<IssuedTicket[]>(TICKETS_KEY, []);
}
export function getTicketsForOrder(orderId: string): IssuedTicket[] {
  return getTickets().filter((t) => t.order_id === orderId);
}
export function issueTicketsForOrder(order: Order): IssuedTicket[] {
  const existing = getTicketsForOrder(order.id);
  if (existing.length) return existing;
  const tix: IssuedTicket[] = order.items.map((it) => ({
    id: uid(),
    order_id: order.id,
    event_id: order.event_id,
    seat_label: it.label,
    qr_code: `MAXI-${order.id.slice(0, 8)}-${uid().slice(0, 12)}`.toUpperCase(),
    issued_at: new Date().toISOString(),
  }));
  const all = [...getTickets(), ...tix];
  write(TICKETS_KEY, all);
  return tix;
}

// -------- Payment simulation --------

export function simulatePayment(orderId: string): Order | undefined {
  const order = getOrder(orderId);
  if (!order) return;
  order.status = "paid";
  order.paid_at = new Date().toISOString();
  upsertOrder(order);
  markSold(order.event_id, order.id);
  issueTicketsForOrder(order);
  return order;
}
