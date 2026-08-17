// Typy a čisté pomocníky pre rozloženia sál (editor sedenia).
//
// Zámerne bez localStorage a bez závislostí, aby ich mohol importovať aj server
// — `layouts.functions.ts` z nich mapuje riadky z databázy a `payments.functions.ts`
// podľa nich určuje, či je sedadlo VIP.
// Layout = kolekcia tvarov na plátne.

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
  /** Poradie prvého radu bloku (1 = A). Sála s viacerými blokmi ich reťazí. */
  startRow?: number;
  startSeat?: number;
  /** Označovanie radov písmenami alebo číslami. */
  rowLabelMode?: "ABC" | "123";
  priceCategory?: string;
  capacity?: number;
  blocked?: boolean;
  // individual seat metadata (curved rows etc.)
  row?: string;
  seatNumber?: number;
  sectorId?: string;
  priceCategoryId?: string;
  curveGroupId?: string;
  relativeAngle?: number;
  relativeRadius?: number;
  rowLabel?: string;
  radius?: number;
  angle?: number;
  startAngle?: number;
  endAngle?: number;
  rowSpacing?: number;
  seatSpacing?: number;
};

export type CurveGroup = {
  id: string;
  name: string;
  centerX: number;
  centerY: number;
  radius: number;
  startAngle: number;
  endAngle: number;
  rows: number;
  seatsPerRow: number;
  rowSpacing: number;
  seatSpacing: number;
  rotation: number;
  sectorId?: string;
  priceCategoryId?: string;
  color: string;
  rowLabelMode?: "ABC" | "123";
  startSeat?: number;
  seatSize?: number;
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
  curveGroups?: CurveGroup[];
  created_at: string;
  updated_at: string;
};

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export function emptyLayout(name = "Nová hala"): HallLayout {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name,
    type: "koncertna-hala",
    shapes: [],
    curveGroups: [],
    created_at: now,
    updated_at: now,
  };
}

/** Medzera medzi sedadlami a okraje bloku. Editor aj zákaznícka mapa musia kresliť rovnako. */
export const SEAT_GAP = 6;
export const SEAT_PAD_X = 10;
export const SEAT_PAD_Y = 20;

/**
 * Rozmer bloku sedadiel. Je to jediné miesto, kde sa počíta — predtým to bolo
 * rozpísané v editore aj v zákazníckej mape a pri zmene počtu radov sa
 * neprepočítalo vôbec, takže sedadlá pretiekli mimo rámu bloku a zákazníkovi
 * sa pri „zmestiť na obrazovku" odrezali.
 */
export function seatGridSize(rows: number, cols: number, seatSize = 22) {
  return {
    width: Math.max(1, cols) * (seatSize + SEAT_GAP) + 2 * SEAT_PAD_X,
    height: Math.max(1, rows) * (seatSize + SEAT_GAP) + SEAT_PAD_Y + SEAT_PAD_X,
  };
}

/**
 * Označenie radu. `index` je poradie v bloku od nuly, `startRow` poradie prvého
 * radu bloku (1 = A), takže druhý blok môže pokračovať od K.
 * Nad 26 radov prechádza na dvojpísmenové označenie (AA, AB…), aby veľká sála
 * nekončila na znakoch `[`, `\`, `]` ako pri obyčajnom `fromCharCode`.
 */
export function formatRowLabel(index: number, mode: "ABC" | "123" = "ABC", startRow = 1): string {
  const i = index + Math.max(1, startRow) - 1;
  if (mode === "123") return String(i + 1);
  if (i < 26) return String.fromCharCode(65 + i);
  return String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
}

export function computeCapacity(shapes: Shape[]): number {
  let total = 0;
  for (const s of shapes) {
    if (s.kind === "seats") {
      total += Math.max(1, (s.rows ?? 1) * (s.cols ?? 1));
    } else if (s.kind === "standing" || s.kind === "vip") {
      total += s.capacity ?? 0;
    }
  }
  return total;
}
