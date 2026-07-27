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
  "Koncert", "Festival", "Šport", "Konferencia", "Divadlo", "Stand-up", "Kultúra",
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
  (isBrowser() && typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36));

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
  // Seed demo events once so the public flow (events list, detail, checkout) is testable.
  const events = read<EventItem[]>(EVENTS_KEY, []);
  if (events.length === 0) {
    const now = new Date();
    const addDays = (d: number) => {
      const x = new Date(now);
      x.setDate(x.getDate() + d);
      return x.toISOString().slice(0, 10);
    };
    const demo: EventItem[] = [
      {
        id: uid(),
        organizer_id: "demo-organizer",
        organizer_name: "Demo Events s.r.o.",
        title: "Letný Open Air Festival",
        category: "Festival",
        event_date: addDays(21),
        event_time: "18:00",
        venue: "Amfiteáter Bratislava",
        city: "Bratislava",
        address: "Tyršovo nábrežie 1, Bratislava",
        description: "Najväčší letný open air festival roka s headlinermi zo Slovenska aj zahraničia.",
        image_url: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&q=80",
        status: "published",
        created_at: now.toISOString(),
        sale_type: "standing",
        base_price: 39,
        total_tickets: 5000,
        tickets: [
          { id: uid(), name: "General Admission", price: 39, quantity: 4500 },
          { id: uid(), name: "VIP", price: 89, quantity: 500 },
        ],
      },
      {
        id: uid(),
        organizer_id: "demo-organizer",
        organizer_name: "Demo Events s.r.o.",
        title: "Symfonický koncert: Beethoven",
        category: "Koncert",
        event_date: addDays(35),
        event_time: "19:30",
        venue: "Slovenská filharmónia",
        city: "Bratislava",
        address: "Námestie E. Suchoňa 1",
        description: "Beethovenova 9. symfónia v podaní Slovenskej filharmónie.",
        image_url: "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=1200&q=80",
        status: "published",
        created_at: now.toISOString(),
        sale_type: "seating",
        base_price: 29,
        total_tickets: 800,
        tickets: [
          { id: uid(), name: "Parter", price: 49, quantity: 400 },
          { id: uid(), name: "Balkón", price: 29, quantity: 400 },
        ],
      },
      {
        id: uid(),
        organizer_id: "demo-organizer",
        organizer_name: "Demo Events s.r.o.",
        title: "Stand-up: Komediálna noc",
        category: "Stand-up",
        event_date: addDays(10),
        event_time: "20:00",
        venue: "Štúdio L+S",
        city: "Bratislava",
        description: "Najlepší slovenskí komici na jednom pódiu.",
        image_url: "https://images.unsplash.com/photo-1527224538127-2104bb71c51b?w=1200&q=80",
        status: "published",
        created_at: now.toISOString(),
        sale_type: "standing",
        base_price: 19,
        total_tickets: 300,
        tickets: [
          { id: uid(), name: "Vstupenka", price: 19, quantity: 300 },
        ],
      },
      {
        id: uid(),
        organizer_id: "demo-organizer",
        organizer_name: "Demo Events s.r.o.",
        title: "Slovan vs. Trnava — derby",
        category: "Šport",
        event_date: addDays(14),
        event_time: "17:00",
        venue: "Tehelné pole",
        city: "Bratislava",
        description: "Najsledovanejšie derby slovenskej ligy.",
        image_url: "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=1200&q=80",
        status: "published",
        created_at: now.toISOString(),
        sale_type: "seating_map",
        base_price: 15,
        total_tickets: 22000,
        tickets: [
          { id: uid(), name: "Sektor A", price: 25, quantity: 5000 },
          { id: uid(), name: "Sektor B", price: 15, quantity: 17000 },
        ],
      },
    ];
    write(EVENTS_KEY, demo);
  }
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

export function getEvents(): EventItem[] {
  return read<EventItem[]>(EVENTS_KEY, []);
}

export function saveEvents(events: EventItem[]) {
  write(EVENTS_KEY, events);
}

export function getEvent(id: string): EventItem | undefined {
  return getEvents().find((e) => e.id === id);
}

export function upsertEvent(event: EventItem) {
  const events = getEvents();
  const idx = events.findIndex((e) => e.id === event.id);
  if (idx >= 0) events[idx] = event;
  else events.unshift(event);
  saveEvents(events);
}

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

