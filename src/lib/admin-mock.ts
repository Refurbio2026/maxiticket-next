// Deterministic mock data factories for admin tables
import type { Column } from "@/components/admin/DataTablePage";

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function eur(n: number) {
  return new Intl.NumberFormat("sk-SK", { style: "currency", currency: "EUR" }).format(n);
}

function date(i: number) {
  const d = new Date(2026, 4, 1 + (i % 28));
  return d.toLocaleDateString("sk-SK");
}

const organizers = [
  "MeloFest s.r.o.",
  "GoLive Production",
  "Pohoda Festival",
  "ŠK Slovan Bratislava",
  "Divadlo Aréna",
  "Stand-up.sk",
  "Nová Scéna",
  "BeFree Events",
  "Národné divadlo",
  "Comic Con SK",
];

const events = [
  "Pohoda 2026",
  "Bažant Pohoda Warm-Up",
  "Hokej Slovan vs Košice",
  "Karol Duchoň Tribute",
  "TEDx Bratislava",
  "Stand-up Night vol. 12",
  "Romeo a Júlia",
  "Hana Zagorová Open Air",
  "Sziget Bratislava",
  "Jazz Festival Košice",
  "Komik Live",
  "Symphonic Cinema",
];

const venues = [
  "Tipos Aréna",
  "Inchebexpo",
  "NTC Bratislava",
  "Letisko Trenčín",
  "Steel Aréna Košice",
  "Stará tržnica",
  "Refinery Gallery",
];

const cities = ["Bratislava", "Košice", "Žilina", "Banská Bystrica", "Trenčín", "Nitra", "Prešov"];
const statuses = ["Aktívne", "Čakajúce", "Ukončené", "Stornované"];

export function buildRows(count: number, kind: string): Record<string, string | number>[] {
  return Array.from({ length: count }).map((_, i) => {
    const base = {
      id: `MX-${String(10000 + i).padStart(5, "0")}`,
      created: date(i),
      organizer: pick(organizers, i),
      event: pick(events, i),
      venue: pick(venues, i),
      city: pick(cities, i),
      status: pick(statuses, i),
      tickets: 50 + ((i * 37) % 950),
      amount: eur(150 + ((i * 217) % 14850)),
      vat: eur(50 + ((i * 41) % 2400)),
      net: eur(120 + ((i * 211) % 13400)),
      type: pick(["Koncert", "Festival", "Šport", "Divadlo", "Konferencia", "Stand-up"], i),
      user: pick(["m.kovac", "j.novak", "l.varga", "p.benko", "z.tothova"], i),
      device: `SCAN-${String((i % 24) + 1).padStart(2, "0")}`,
      kind,
    };
    return base;
  });
}

export const commonColumns = {
  invoice: [
    { key: "id", label: "Číslo", mono: true },
    { key: "created", label: "Dátum" },
    { key: "organizer", label: "Organizátor" },
    { key: "amount", label: "Suma", align: "right" as const },
    { key: "vat", label: "DPH", align: "right" as const },
    {
      key: "status",
      label: "Stav",
      badge: true,
      badgeMap: {
        Aktívne: "success",
        Čakajúce: "accent",
        Ukončené: "muted",
        Stornované: "destructive",
      } as const,
    },
  ] satisfies Column[],
  organizer: [
    { key: "organizer", label: "Názov" },
    { key: "city", label: "Mesto" },
    { key: "tickets", label: "Vstupenky", align: "right" as const },
    { key: "amount", label: "Obrat", align: "right" as const },
    {
      key: "status",
      label: "Stav",
      badge: true,
      badgeMap: {
        Aktívne: "success",
        Čakajúce: "accent",
        Ukončené: "muted",
        Stornované: "destructive",
      } as const,
    },
  ] satisfies Column[],
  event: [
    { key: "event", label: "Podujatie" },
    {
      key: "type",
      label: "Typ",
      badge: true,
      badgeMap: {
        Koncert: "primary",
        Festival: "accent",
        Šport: "success",
        Divadlo: "muted",
        Konferencia: "muted",
        "Stand-up": "primary",
      } as const,
    },
    { key: "venue", label: "Miesto" },
    { key: "city", label: "Mesto" },
    { key: "created", label: "Termín" },
    { key: "tickets", label: "Predaných", align: "right" as const },
  ] satisfies Column[],
  sale: [
    { key: "id", label: "Objednávka", mono: true },
    { key: "created", label: "Dátum" },
    { key: "event", label: "Podujatie" },
    { key: "tickets", label: "Ks", align: "right" as const },
    { key: "amount", label: "Suma", align: "right" as const },
    {
      key: "status",
      label: "Stav",
      badge: true,
      badgeMap: {
        Aktívne: "success",
        Čakajúce: "accent",
        Ukončené: "muted",
        Stornované: "destructive",
      } as const,
    },
  ] satisfies Column[],
  simple: [
    { key: "id", label: "ID", mono: true },
    { key: "event", label: "Názov" },
    { key: "user", label: "Vytvoril" },
    { key: "created", label: "Dátum" },
  ] satisfies Column[],
  device: [
    { key: "device", label: "Zariadenie", mono: true },
    { key: "venue", label: "Miesto" },
    { key: "user", label: "Operátor" },
    { key: "tickets", label: "Skeny", align: "right" as const },
    {
      key: "status",
      label: "Stav",
      badge: true,
      badgeMap: {
        Aktívne: "success",
        Čakajúce: "accent",
        Ukončené: "muted",
        Stornované: "destructive",
      } as const,
    },
  ] satisfies Column[],
  user: [
    { key: "user", label: "Login", mono: true },
    { key: "organizer", label: "Organizácia" },
    {
      key: "type",
      label: "Rola",
      badge: true,
      badgeMap: {
        Koncert: "primary",
        Festival: "accent",
        Šport: "success",
        Divadlo: "muted",
        Konferencia: "muted",
        "Stand-up": "primary",
      } as const,
    },
    { key: "created", label: "Posl. prihlásenie" },
  ] satisfies Column[],
};
