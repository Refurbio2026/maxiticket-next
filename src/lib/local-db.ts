// LocalStorage "database" for vipky.sk demo mode.
// All reads/writes are SSR-safe (guarded by typeof window).

export type Role = "user" | "organizer" | "admin";

export type StoredUser = {
  id: string;
  email: string;
  password: string;
  role: Role;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  // Organizer fields
  company_name?: string;
  ico?: string;
  dic?: string;
  ic_dph?: string;
  billing_address?: string;
  phone?: string;
  created_at: string;
};

export type Ticket = {
  id: string;
  name: string;
  price: number;
  quantity: number;
};

export type SaleType = "standing" | "seating" | "seating_map";

export type EventItem = {
  id: string;
  organizer_id: string;
  organizer_name?: string;
  title: string;
  category: string;
  event_date: string;
  event_time: string;
  venue: string;
  city: string;
  address?: string;
  description?: string;
  image_url?: string;
  status: "draft" | "published";
  created_at: string;
  tickets: Ticket[];
  // ticketing extensions
  sale_type?: SaleType;
  venue_layout_id?: string;
  base_price?: number;
  total_tickets?: number;
  vip_price?: number;
};

const USERS_KEY = "mt_users";
const CURRENT_KEY = "mt_current_user_id";
const EVENTS_KEY = "mt_events";
const CATEGORIES_KEY = "mt_categories";

export type EventCategory = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  created_at: string;
};

const DEFAULT_CATEGORIES_NAMES = [
  "Koncert",
  "Festival",
  "Šport",
  "Konferencia",
  "Divadlo",
  "Stand-up",
  "Kultúra",
];

const isBrowser = () => typeof window !== "undefined";

function read<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export const uid = () =>
  isBrowser() && typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------- Users ----------

const DEMO_USERS: StoredUser[] = [
  {
    id: "demo-admin",
    email: "admin@vipky.sk",
    password: "admin123",
    role: "admin",
    full_name: "Admin vipky.sk",
    created_at: new Date().toISOString(),
  },
  {
    id: "demo-organizer",
    email: "organizer@vipky.sk",
    password: "organizer123",
    role: "organizer",
    full_name: "Demo Organizátor",
    company_name: "Demo Events s.r.o.",
    created_at: new Date().toISOString(),
  },
  {
    id: "demo-user",
    email: "user@vipky.sk",
    password: "user123",
    role: "user",
    full_name: "Demo Používateľ",
    created_at: new Date().toISOString(),
  },
];

export function ensureSeed() {
  if (!isBrowser()) return;
  const users = read<StoredUser[]>(USERS_KEY, []);
  if (users.length === 0) {
    write(USERS_KEY, DEMO_USERS);
  } else {
    const byEmail = new Map(users.map((u) => [u.email, u]));
    let changed = false;
    for (const d of DEMO_USERS) {
      if (!byEmail.has(d.email)) {
        users.push(d);
        changed = true;
      }
    }
    if (changed) write(USERS_KEY, users);
  }
  const cats = read<EventCategory[]>(CATEGORIES_KEY, []);
  if (cats.length === 0) {
    const seeded: EventCategory[] = DEFAULT_CATEGORIES_NAMES.map((n) => ({
      id: uid(),
      name: n,
      slug: n.toLowerCase().replace(/\s+/g, "-"),
      created_at: new Date().toISOString(),
    }));
    write(CATEGORIES_KEY, seeded);
  }
  // Podujatia sa už neseedujú do localStorage — katalóg beží na Supabase
  // (viď @/hooks/use-events). Demo podujatia zakladaj cez admin rozhranie.
}

export function getUsers(): StoredUser[] {
  return read<StoredUser[]>(USERS_KEY, []);
}

export function saveUsers(users: StoredUser[]) {
  write(USERS_KEY, users);
}

export function findUserByEmail(email: string): StoredUser | undefined {
  return getUsers().find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export function getCurrentUser(): StoredUser | null {
  if (!isBrowser()) return null;
  const id = window.localStorage.getItem(CURRENT_KEY);
  if (!id) return null;
  return getUsers().find((u) => u.id === id) ?? null;
}

export function setCurrentUserId(id: string | null) {
  if (!isBrowser()) return;
  if (id) window.localStorage.setItem(CURRENT_KEY, id);
  else window.localStorage.removeItem(CURRENT_KEY);
}

// ---------- Events ----------
//
// ZASTARANÉ (fáza 2). Katalóg podujatí žije v Supabase — čítaj a zapisuj ho
// cez `@/hooks/use-events` (useEvents / useEvent / useUpsertEvent /
// useDeleteEvent), ktoré volajú server funkcie v `@/lib/events.functions`.
// Tieto funkcie už nikto nepoužíva; ostávajú len pre typ `EventItem`, na
// ktorom stoja staršie POS a marketing moduly. Nepridávaj na ne nové volania —
// podujatie zapísané sem sa v katalógu nezobrazí a checkout ho neuvidí.

/** @deprecated Použi `useEvents()` z `@/hooks/use-events`. */
export function getEvents(): EventItem[] {
  return read<EventItem[]>(EVENTS_KEY, []);
}

export function saveEvents(events: EventItem[]) {
  write(EVENTS_KEY, events);
}

/** @deprecated Použi `useEvent(id)` z `@/hooks/use-events`. */
export function getEvent(id: string): EventItem | undefined {
  return getEvents().find((e) => e.id === id);
}

/** @deprecated Použi `useUpsertEvent()` z `@/hooks/use-events`. */
export function upsertEvent(event: EventItem) {
  const events = getEvents();
  const idx = events.findIndex((e) => e.id === event.id);
  if (idx >= 0) events[idx] = event;
  else events.unshift(event);
  saveEvents(events);
}

/** @deprecated Použi `useDeleteEvent()` z `@/hooks/use-events`. */
export function deleteEvent(id: string) {
  saveEvents(getEvents().filter((e) => e.id !== id));
}

// ---------- Categories ----------

export function getCategories(): EventCategory[] {
  return read<EventCategory[]>(CATEGORIES_KEY, []);
}

export function saveCategories(cats: EventCategory[]) {
  write(CATEGORIES_KEY, cats);
}

export function getCategory(id: string): EventCategory | undefined {
  return getCategories().find((c) => c.id === id);
}

export function upsertCategory(cat: EventCategory) {
  const cats = getCategories();
  const idx = cats.findIndex((c) => c.id === cat.id);
  if (idx >= 0) cats[idx] = cat;
  else cats.unshift(cat);
  saveCategories(cats);
}

export function deleteCategory(id: string) {
  saveCategories(getCategories().filter((c) => c.id !== id));
}

// Notify listeners (within tab) of localStorage changes.
export const AUTH_EVENT = "mt:auth-change";
export const EVENTS_EVENT = "mt:events-change";
export const CATEGORIES_EVENT = "mt:categories-change";

export function emit(name: string) {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event(name));
}
