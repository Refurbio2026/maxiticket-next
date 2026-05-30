// LocalStorage store for hall layouts (seating editor).
// Layout = collection of shapes on an SVG canvas.

export type ShapeKind =
  | "sector"
  | "seats"
  | "standing"
  | "vip"
  | "stage"
  | "entrance"
  | "bar"
  | "wc"
  | "tech"
  | "label";

export type Shape = {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  label?: string;
  color?: string;
  // for seats grid
  rows?: number;
  cols?: number;
  seatSize?: number;
  startRow?: number;
  startSeat?: number;
  priceCategory?: string;
  capacity?: number;
  blocked?: boolean;
};

export type HallType =
  | "stadion"
  | "kino"
  | "divadlo"
  | "klub"
  | "festival"
  | "kulturne-stredisko"
  | "koncertna-hala"
  | "sportova-hala";

export const HALL_TYPE_LABEL: Record<HallType, string> = {
  stadion: "Štadión",
  kino: "Kino",
  divadlo: "Divadlo",
  klub: "Klub",
  festival: "Festival",
  "kulturne-stredisko": "Kultúrne stredisko",
  "koncertna-hala": "Koncertná hala",
  "sportova-hala": "Športová hala",
};

export type HallLayout = {
  id: string;
  name: string;
  type: HallType;
  city?: string;
  address?: string;
  capacity?: number;
  note?: string;
  shapes: Shape[];
  created_at: string;
  updated_at: string;
};

const KEY = "mt_hall_layouts";
const isBrowser = () => typeof window !== "undefined";

export const LAYOUTS_EVENT = "mt:layouts-change";

function read(): HallLayout[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HallLayout[]) : [];
  } catch {
    return [];
  }
}

function write(list: HallLayout[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(LAYOUTS_EVENT));
}

export const uid = () =>
  isBrowser() && typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export function listLayouts(): HallLayout[] {
  return read();
}

export function getLayout(id: string): HallLayout | undefined {
  return read().find((l) => l.id === id);
}

export function upsertLayout(l: HallLayout) {
  const list = read();
  const idx = list.findIndex((x) => x.id === l.id);
  l.updated_at = new Date().toISOString();
  if (idx >= 0) list[idx] = l;
  else list.unshift(l);
  write(list);
}

export function deleteLayout(id: string) {
  write(read().filter((l) => l.id !== id));
}

export function duplicateLayout(id: string): HallLayout | undefined {
  const src = getLayout(id);
  if (!src) return;
  const copy: HallLayout = {
    ...src,
    id: uid(),
    name: src.name + " (kópia)",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    shapes: src.shapes.map((s) => ({ ...s, id: uid() })),
  };
  upsertLayout(copy);
  return copy;
}

export function emptyLayout(name = "Nová hala"): HallLayout {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name,
    type: "koncertna-hala",
    shapes: [],
    created_at: now,
    updated_at: now,
  };
}

export function computeCapacity(shapes: Shape[]): number {
  let total = 0;
  for (const s of shapes) {
    if (s.kind === "seats") {
      total += (s.rows ?? 0) * (s.cols ?? 0);
    } else if (s.kind === "standing" || s.kind === "vip") {
      total += s.capacity ?? 0;
    }
  }
  return total;
}
