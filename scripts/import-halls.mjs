// Import sál zo starého MaxiTicketu (export `maxiticket-export-hall`).
//
// Starý formát drží každé sedadlo ako bod so súradnicami (rozostup 16 × 17 px,
// sedadlo 13 px), takže rozloženie prenášame 1:1 — sedadlo = jeden tvar.
// Neočíslované sedadlá (n = 0) sú v starom systéme státie: desiatky riadkov
// s tou istou súradnicou. Z tých robíme jeden tvar `standing` s kapacitou,
// inak by sa do plánu nalialo 5 000 neviditeľných bodov na jednom mieste.
//
// Spustenie (kľúče číta z /opt/maxiticket/.env):
//   node scripts/import-halls.mjs <adresár-exportu> [--dry-run] [--limit N]
//                                 [--only 1088,101] [--min-seats N]
//                                 [--owner <uuid>]
//
// Idempotentné: id sály sa odvodzuje z id v starom systéme (UUID v5), takže
// opakovaný beh tú istú sálu prepíše a nezaloží druhú.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ENV_FILE = "/opt/maxiticket/.env";

/** Sedadlo v starom systéme má 13 px a rozostup 16 × 17 — kreslíme rovnako. */
const SEAT_SIZE = 13;

/** Text na pódiu, podľa ktorého spoznáme javisko medzi ostatnými elipsami. */
const STAGE_WORDS =
  /P\s*Ó\s*D\s*I\s*U\s*M|J\s*A\s*V\s*I\s*S\s*K\s*O|J\s*E\s*V\s*I\s*Š\s*T\s*Ě|STAGE/i;

/** Typ sály hádame z názvu — v starom exporte údaj nie je. */
const TYPE_RULES = [
  [/amfi|amfik|open ?air|festival/i, "festival"],
  [/štadi[oó]n|stadion|aréna|arena|zimný/i, "stadion"],
  [/kino|cinema/i, "kino"],
  [/divadl|theat|jevišt|javisk/i, "divadlo"],
  [/klub|club|caf[eé]|pub/i, "klub"],
  [/kultúrn|kulturn|dom kultúry|kd |mkc|osvetov/i, "kulturne-stredisko"],
  [/športov|sportov|telocvič|hala/i, "sportova-hala"],
];

function hallType(name) {
  for (const [re, type] of TYPE_RULES) if (re.test(name)) return type;
  return "koncertna-hala";
}

/** UUID v5 (namespace DNS) — to isté id sály pri každom behu. */
function stableUuid(seed) {
  const ns = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const h = createHash("sha1").update(ns).update(seed).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const s = b.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Krátke id tvaru — 160 tisíc sedadiel s plným UUID by plán zbytočne nafúklo. */
function shortId(prefix, i) {
  return `${prefix}${i.toString(36)}`;
}

function nonEmpty(v) {
  const s = (v ?? "").toString().trim();
  return s.length > 0 ? s : undefined;
}

/** Prevedie jeden `hall.json` na náš `HallLayout`. */
export function convertHall(src) {
  const hall = src.hall ?? {};
  const layout = src.layout ?? {};
  const categories = src.categories ?? {};
  const loc1 = src.loc1 ?? {};
  const seats = src.seats ?? [];
  const elements = src.elements ?? [];

  const catName = (id) => nonEmpty(categories[id]?.name);
  const catColor = (id) => nonEmpty(categories[id]?.color);
  const secName = (id) => nonEmpty(loc1[id]?.name);

  const shapes = [];
  let n = 0;

  // --- javisko, popisky a dekorácie ---------------------------------------
  for (const e of elements) {
    const text = nonEmpty(e.text);
    const common = {
      x: e.x ?? 0,
      y: e.y ?? 0,
      width: Math.max(1, e.w ?? 1),
      height: Math.max(1, e.h ?? 1),
      rotation: e.ang || undefined,
      label: text,
    };
    if (e.t === "E") {
      shapes.push({
        id: shortId("e", n++),
        kind: text && STAGE_WORDS.test(text) ? "stage" : "sector",
        ...common,
        color: nonEmpty(e.bc),
      });
    } else if (e.t === "T" || e.t === "R") {
      // `R` je v starom systéme číslo radu po stranách bloku a nesie rozmer
      // 1 × 1; náš editor kreslí text do rámu tvaru, takže by sa orezal na nulu.
      // Preto rám dorovnáme na to, čo sa do neho pri 16 px reálne zmestí.
      if (!text) continue;
      shapes.push({
        id: shortId("e", n++),
        kind: "label",
        ...common,
        width: Math.max(common.width, text.length * 9),
        height: Math.max(common.height, 20),
        color: nonEmpty(e.fc),
      });
    } else {
      // W (stena), I (šikmá stena), C (kruh), D (stôl) — obyčajné plochy.
      shapes.push({
        id: shortId("e", n++),
        kind: "sector",
        ...common,
        color: nonEmpty(e.bc) ?? nonEmpty(e.fc),
      });
    }
  }

  // --- sedadlá -------------------------------------------------------------
  // Očíslované idú 1:1. Neočíslované sú státie: zlúčime ich podľa miesta,
  // kategórie a sektora do jedného tvaru s kapacitou.
  const standing = new Map();
  let seatIndex = 0;
  let numbered = 0;
  let standingTotal = 0;

  for (const s of seats) {
    const num = Number(s.n) || 0;
    if (num > 0) {
      numbered++;
      shapes.push({
        id: shortId("s", seatIndex++),
        kind: "seats",
        x: s.x ?? 0,
        y: s.y ?? 0,
        width: SEAT_SIZE,
        height: SEAT_SIZE,
        row: String(s.l2 ?? ""),
        seatNumber: num,
        label: secName(s.l1),
        priceCategory: catName(s.c),
        color: catColor(s.c),
      });
    } else {
      standingTotal++;
      const key = `${s.x}|${s.y}|${s.c}|${s.l1}`;
      const cur = standing.get(key);
      if (cur) cur.capacity++;
      else
        standing.set(key, {
          x: s.x ?? 0,
          y: s.y ?? 0,
          capacity: 1,
          label: secName(s.l1) ?? catName(s.c),
          priceCategory: catName(s.c),
          color: catColor(s.c),
        });
    }
  }

  for (const b of standing.values()) {
    // Plocha na státie nemá v starom exporte rozmer, len bod. Dáme jej štvorec
    // úmerný kapacite, nech je v pláne vidieť, koľko ľudí sa do nej zmestí.
    const side = Math.max(40, Math.round(Math.sqrt(b.capacity) * 14));
    shapes.push({
      id: shortId("p", n++),
      kind: "standing",
      x: b.x,
      y: b.y,
      width: side,
      height: side,
      capacity: b.capacity,
      label: b.label,
      priceCategory: b.priceCategory,
      color: b.color,
    });
  }

  const name =
    [nonEmpty(hall.name), nonEmpty(layout.name)]
      .filter((v, i, a) => v && a.indexOf(v) === i)
      .join(" — ") || `Sála ${src.id_hall_desc ?? src.id_hall ?? ""}`.trim();

  const address = [nonEmpty(hall.street), nonEmpty(hall.zip)].filter(Boolean).join(", ");

  return {
    id: stableUuid(`maxiticket-hall:${src.id_hall_desc}:${src.id_hall}`),
    name,
    type: hallType(name),
    city: nonEmpty(hall.city) ?? null,
    address: nonEmpty(address) ?? null,
    note: `Import zo starého systému (id_hall_desc=${src.id_hall_desc}, id_hall=${src.id_hall}, ${src.timestamp ?? "?"}).`,
    capacity: numbered + standingTotal,
    shapes,
    curve_groups: [],
    stats: { numbered, standing: standingTotal, elements: elements.length, shapes: shapes.length },
  };
}

// --- beh ------------------------------------------------------------------

function loadEnv() {
  const out = {};
  if (!existsSync(ENV_FILE)) return out;
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Použitie: node scripts/import-halls.mjs <adresár-exportu> [--dry-run] …");
    process.exit(1);
  }
  const dryRun = has("dry-run");
  const limit = Number(arg("limit", 0)) || 0;
  const minSeats = Number(arg("min-seats", 0)) || 0;
  const only = (arg("only", "") || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const env = loadEnv();
  const owner = arg("owner", null);
  let db = null;
  if (!dryRun) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error(`Chýbajú SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY v ${ENV_FILE}`);
      process.exit(1);
    }
    db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }

  let dirs = readdirSync(dir).filter((d) => existsSync(join(dir, d, "hall.json")));
  if (only.length) dirs = dirs.filter((d) => only.includes(d));
  dirs.sort((a, b) => Number(a) - Number(b));

  let done = 0;
  let skipped = 0;
  const failures = [];
  for (const d of dirs) {
    let converted;
    try {
      converted = convertHall(JSON.parse(readFileSync(join(dir, d, "hall.json"), "utf8")));
    } catch (err) {
      failures.push(`${d}: ${err.message}`);
      continue;
    }
    if (converted.capacity < minSeats) {
      skipped++;
      continue;
    }
    const { stats, ...row } = converted;
    console.log(
      `${d}\t${row.name.slice(0, 54).padEnd(54)}\tmiest ${String(converted.capacity).padStart(6)}` +
        `\t(sedadlá ${stats.numbered}, státie ${stats.standing}, tvarov ${stats.shapes})`,
    );
    if (!dryRun) {
      const { error } = await db
        .from("venue_layouts")
        .upsert({ ...row, owner_id: owner ?? null }, { onConflict: "id" });
      if (error) {
        failures.push(`${d}: ${error.message}`);
        continue;
      }
    }
    done++;
    if (limit && done >= limit) break;
  }

  console.log(
    `\nHotovo: ${done} sál${dryRun ? " (nasucho, nič sa neuložilo)" : " uložených"}` +
      (skipped ? `, ${skipped} preskočených cez --min-seats` : "") +
      (failures.length ? `, ${failures.length} chýb` : ""),
  );
  for (const f of failures) console.error("  CHYBA", f);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
