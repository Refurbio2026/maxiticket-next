// Server funkcie pre termíny podujatí (jedno podujatie = viac dátumov).
// Drž tento súbor tenký: len createServerFn deklarácie a mapovanie riadkov.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EventDateRecord = {
  id: string;
  event_id: string;
  event_date: string;
  event_time: string;
  status: "on_sale" | "cancelled";
  total_tickets?: number;
  note?: string;
  /** Vydané vstupenky na tento termín. */
  sold: number;
  /** Sedadlá, ktoré práve drží nedoplatená objednávka. */
  reserved: number;
};

export type EventDateWithEvent = EventDateRecord & {
  event_title: string;
  venue: string;
  city: string;
  event_status: "draft" | "published";
  sale_type: string | null;
  revenue: number;
};

type DateRow = {
  id: string;
  event_id: string;
  event_date: string;
  event_time: string;
  status: string;
  total_tickets: number | null;
  note: string | null;
};

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

/**
 * Koľko je na termínoch predané a koľko rozpredané.
 * `sold` počítame z vydaných vstupeniek, nie z objednávok — vstupenka vzniká až
 * po zaplatení, takže sa do štatistiky nedostane rozpracovaný nákup.
 */
async function loadCounts(dateIds: string[]) {
  const sold = new Map<string, number>();
  const reserved = new Map<string, number>();
  if (dateIds.length === 0) return { sold, reserved };

  const [{ data: tickets }, { data: seats }] = await Promise.all([
    // Refundovaná vstupenka nie je predaná — držiteľa už pri dverách nepustia.
    supabaseAdmin
      .from("tickets")
      .select("event_date_id")
      .in("event_date_id", dateIds)
      .is("refunded_at", null),
    supabaseAdmin
      .from("seat_inventory")
      .select("event_date_id, status, reserved_until")
      .in("event_date_id", dateIds)
      .eq("status", "reserved"),
  ]);

  for (const t of tickets || []) {
    const key = t.event_date_id as string;
    sold.set(key, (sold.get(key) || 0) + 1);
  }
  const now = Date.now();
  for (const s of seats || []) {
    const until = s.reserved_until ? new Date(s.reserved_until).getTime() : Infinity;
    if (until <= now) continue; // vypršaná rezervácia sa neráta, cron ju čoskoro uvoľní
    const key = s.event_date_id as string;
    reserved.set(key, (reserved.get(key) || 0) + 1);
  }
  return { sold, reserved };
}

function mapDate(row: DateRow, sold: number, reserved: number): EventDateRecord {
  return {
    id: row.id,
    event_id: row.event_id,
    event_date: row.event_date,
    event_time: (row.event_time || "").slice(0, 5),
    status: row.status === "cancelled" ? "cancelled" : "on_sale",
    total_tickets: row.total_tickets ?? undefined,
    note: row.note ?? undefined,
    sold,
    reserved,
  };
}

/** Termíny jedného podujatia. Koncept vidí len vlastník alebo admin. */
export const listEventDates = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ event_id: z.string().uuid(), viewer_id: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data }): Promise<EventDateRecord[]> => {
    const { data: event } = await supabaseAdmin
      .from("events")
      .select("id, status, organizer_id")
      .eq("id", data.event_id)
      .maybeSingle();
    if (!event) return [];
    if (event.status !== "published") {
      const viewer = data.viewer_id;
      const allowed = !!viewer && (viewer === event.organizer_id || (await isAdmin(viewer)));
      if (!allowed) return [];
    }

    const { data: rows } = await supabaseAdmin
      .from("event_dates")
      .select("id, event_id, event_date, event_time, status, total_tickets, note")
      .eq("event_id", data.event_id)
      .order("event_date", { ascending: true })
      .order("event_time", { ascending: true });

    const list = (rows || []) as DateRow[];
    const { sold, reserved } = await loadCounts(list.map((r) => r.id));
    return list.map((r) => mapDate(r, sold.get(r.id) || 0, reserved.get(r.id) || 0));
  });

/**
 * Prehľad termínov naprieč podujatiami pre admin stránku.
 * Organizátor vidí len svoje, admin všetky.
 */
export const listAllEventDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        search: z.string().max(200).optional(),
        when: z.enum(["upcoming", "past", "all"]).default("upcoming"),
        limit: z.number().int().positive().max(1000).default(300),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<EventDateWithEvent[]> => {
    const admin = await isAdmin(context.userId);

    let eventQuery = supabaseAdmin
      .from("events")
      .select("id, title, venue, city, status, sale_type, total_tickets");
    if (!admin) eventQuery = eventQuery.eq("organizer_id", context.userId);
    const { data: events } = await eventQuery;
    const eventById = new Map((events || []).map((e) => [e.id, e]));
    if (eventById.size === 0) return [];

    let q = supabaseAdmin
      .from("event_dates")
      .select("id, event_id, event_date, event_time, status, total_tickets, note")
      .in("event_id", [...eventById.keys()])
      .limit(data.limit);

    const today = new Date().toISOString().slice(0, 10);
    if (data.when === "upcoming") q = q.gte("event_date", today);
    if (data.when === "past") q = q.lt("event_date", today);

    const { data: rows, error } = await q
      .order("event_date", { ascending: data.when !== "past" })
      .order("event_time", { ascending: true });
    if (error) throw new Error(error.message);

    let list = (rows || []) as DateRow[];
    const needle = data.search?.trim().toLowerCase();
    if (needle) {
      list = list.filter((r) => {
        const e = eventById.get(r.event_id);
        return (
          (e?.title || "").toLowerCase().includes(needle) ||
          (e?.venue || "").toLowerCase().includes(needle) ||
          (e?.city || "").toLowerCase().includes(needle)
        );
      });
    }

    const ids = list.map((r) => r.id);
    const { sold, reserved } = await loadCounts(ids);

    // Tržba za termín — z položiek zaplatených objednávok viazaných na termín.
    const revenue = new Map<string, number>();
    if (ids.length > 0) {
      const { data: orders } = await supabaseAdmin
        .from("orders")
        .select("event_date_id, total_amount")
        .in("event_date_id", ids)
        .eq("status", "paid");
      for (const o of orders || []) {
        const key = o.event_date_id as string;
        revenue.set(key, (revenue.get(key) || 0) + Number(o.total_amount || 0));
      }
    }

    return list.map((r) => {
      const e = eventById.get(r.event_id);
      return {
        ...mapDate(r, sold.get(r.id) || 0, reserved.get(r.id) || 0),
        event_title: e?.title || "—",
        venue: e?.venue || "",
        city: e?.city || "",
        event_status: (e?.status as "draft" | "published") ?? "draft",
        sale_type: (e?.sale_type as string) ?? null,
        revenue: Math.round((revenue.get(r.id) || 0) * 100) / 100,
      };
    });
  });

const DateInput = z.object({
  id: z.string().uuid().optional(),
  event_id: z.string().uuid(),
  event_date: z.string().min(1),
  event_time: z.string().min(1),
  status: z.enum(["on_sale", "cancelled"]).default("on_sale"),
  total_tickets: z.number().int().nonnegative().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

export type EventDateInputData = z.input<typeof DateInput>;

/** Vlastníctvo sa vynucuje na serveri — termín smie meniť len majiteľ podujatia alebo admin. */
async function assertEventAccess(eventId: string, userId: string) {
  const { data: event } = await supabaseAdmin
    .from("events")
    .select("id, organizer_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) throw new Error("Podujatie sa nenašlo");
  if (event.organizer_id !== userId && !(await isAdmin(userId))) {
    throw new Error("Forbidden: podujatie patrí inému organizátorovi");
  }
}

export const upsertEventDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => DateInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertEventAccess(data.event_id, context.userId);

    const row = {
      event_id: data.event_id,
      event_date: data.event_date,
      event_time: data.event_time,
      status: data.status,
      total_tickets: data.total_tickets ?? null,
      note: data.note ?? null,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await supabaseAdmin.from("event_dates").update(row).eq("id", data.id);
      if (error) throw new Error(friendly(error.message));
      return { id: data.id };
    }
    const { data: created, error } = await supabaseAdmin
      .from("event_dates")
      .insert(row)
      .select("id")
      .single();
    if (error || !created)
      throw new Error(friendly(error?.message || "Termín sa nepodarilo uložiť"));
    return { id: created.id };
  });

function friendly(message: string): string {
  if (message.includes("event_dates_unique_slot")) {
    return "Tento termín už pri podujatí existuje.";
  }
  return message;
}

/**
 * Zmazanie termínu. Termín, na ktorý sa už predávalo, sa nezmaže — namiesto toho
 * ho treba zrušiť (`cancelled`), inak by sa stratila väzba na vydané vstupenky.
 * Rovnako sa nedá zmazať posledný termín podujatia: bez termínu sa nedá kúpiť.
 */
export const deleteEventDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row } = await supabaseAdmin
      .from("event_dates")
      .select("id, event_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Termín sa nenašiel");
    await assertEventAccess(row.event_id, context.userId);

    const { count: orderCount } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("event_date_id", data.id)
      .in("status", ["pending", "awaiting_payment", "paid", "refunded"]);
    if ((orderCount ?? 0) > 0) {
      throw new Error(
        "Na tento termín už sú objednávky. Namiesto zmazania ho zruš — vstupenky tak ostanú dohľadateľné.",
      );
    }

    const { count: total } = await supabaseAdmin
      .from("event_dates")
      .select("id", { count: "exact", head: true })
      .eq("event_id", row.event_id);
    if ((total ?? 0) <= 1) {
      throw new Error("Podujatie musí mať aspoň jeden termín. Najprv pridaj iný.");
    }

    const { error } = await supabaseAdmin.from("event_dates").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type SeatAvailability = {
  /** Sedadlá, ktoré si už nikto iný nemôže vybrať (predané alebo platne držané). */
  taken: { seat_id: string; status: "reserved" | "sold" }[];
  /** Kapacita termínu pre predaj bez sedadiel (0 = neobmedzené). */
  capacity: number;
  /** Koľko z tej kapacity je už minutých. */
  taken_count: number;
};

/**
 * Obsadenosť konkrétneho termínu pre zákaznícku mapu.
 * Číta sa priamo z databázy, takže dvaja kupujúci na dvoch počítačoch vidia
 * ten istý stav — localStorage vie len o vlastnom prehliadači.
 */
export const getSeatAvailability = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ event_date_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<SeatAvailability> => {
    const { data: date } = await supabaseAdmin
      .from("event_dates")
      .select("id, event_id, total_tickets")
      .eq("id", data.event_date_id)
      .maybeSingle();
    if (!date) return { taken: [], capacity: 0, taken_count: 0 };

    const { data: rows } = await supabaseAdmin
      .from("seat_inventory")
      .select("seat_id, status, reserved_until")
      .eq("event_date_id", data.event_date_id)
      .in("status", ["reserved", "sold"]);

    const now = Date.now();
    const taken = (rows || [])
      .filter((r) => {
        if (r.status === "sold") return true;
        const until = r.reserved_until ? new Date(r.reserved_until).getTime() : Infinity;
        return until > now;
      })
      .map((r) => ({ seat_id: r.seat_id as string, status: r.status as "reserved" | "sold" }));

    let capacity = date.total_tickets ?? 0;
    if (!capacity) {
      const { data: event } = await supabaseAdmin
        .from("events")
        .select("total_tickets")
        .eq("id", date.event_id)
        .maybeSingle();
      capacity = event?.total_tickets ?? 0;
    }

    // Predaj bez sedadiel: koľko kusov už drží živá alebo zaplatená objednávka.
    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("quantity, seat_id, orders!inner(event_date_id, status)")
      .eq("orders.event_date_id", data.event_date_id)
      .in("orders.status", ["pending", "awaiting_payment", "paid"]);
    const takenCount = (items || [])
      .filter((it) => !it.seat_id)
      .reduce((s, it: { quantity: number }) => s + (it.quantity || 0), 0);

    return { taken, capacity, taken_count: takenCount };
  });
