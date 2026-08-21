// Server funkcie pre katalóg podujatí (fáza 2 — presun z localStorage do Supabase).
// Drž tento súbor tenký: len createServerFn deklarácie a mapovanie riadkov.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { deleteEventImageIfUnused } from "./event-images.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// BEZPEČNOSŤ: supabaseAdmin obchádza RLS, takže stĺpce vymenúvame ručne.
// `scanner_token` je zdieľané tajomstvo, ktoré autorizuje skenovanie vstupeniek —
// nesmie sa dostať do odpovede pre verejnosť. Nikdy tu nepoužívaj select("*").
const EVENT_COLUMNS =
  "id, organizer_id, title, category, event_date, event_time, venue, city, address, description, image_url, status, sale_type, venue_id, venue_layout_id, group_id, base_price, total_tickets, vip_price, created_at, updated_at";

export type EventTicketType = {
  id: string;
  name: string;
  price: number;
  quantity: number;
};

/** Termín podujatia tak, ako ho potrebuje katalóg a výber dátumu pri nákupe. */
export type EventDateSummary = {
  id: string;
  event_date: string;
  event_time: string;
  status: "on_sale" | "cancelled";
  total_tickets?: number;
  note?: string;
};

/** Tvar zhodný s pôvodným `EventItem` z local-db, aby sa konzumenti menili minimálne. */
export type EventRecord = {
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
  tickets: EventTicketType[];
  /** Termíny; `event_date` vyššie je len ten najbližší z nich. */
  dates: EventDateSummary[];
  sale_type?: "standing" | "seating" | "seating_map";
  /** Séria / festivalový ročník, do ktorého podujatie patrí. */
  group_id?: string;
  group_name?: string;
  venue_id?: string;
  venue_layout_id?: string;
  base_price?: number;
  total_tickets?: number;
  vip_price?: number;
};

type EventRow = Record<string, unknown>;

function mapEvent(
  row: EventRow,
  tickets: EventTicketType[],
  dates: EventDateSummary[],
  organizerName?: string,
  groupName?: string,
): EventRecord {
  const opt = <T>(v: unknown): T | undefined =>
    v === null || v === undefined ? undefined : (v as T);
  return {
    id: row.id as string,
    organizer_id: row.organizer_id as string,
    organizer_name: organizerName,
    title: row.title as string,
    category: row.category as string,
    event_date: row.event_date as string,
    event_time: row.event_time as string,
    venue: row.venue as string,
    city: row.city as string,
    address: opt<string>(row.address),
    description: opt<string>(row.description),
    image_url: opt<string>(row.image_url),
    status: row.status as "draft" | "published",
    created_at: row.created_at as string,
    tickets,
    dates,
    sale_type: opt<EventRecord["sale_type"]>(row.sale_type),
    venue_id: opt<string>(row.venue_id),
    venue_layout_id: opt<string>(row.venue_layout_id),
    group_id: opt<string>(row.group_id),
    group_name: groupName,
    base_price: row.base_price === null ? undefined : Number(row.base_price),
    total_tickets: opt<number>(row.total_tickets),
    vip_price: row.vip_price === null ? undefined : Number(row.vip_price),
  };
}

/** Názvy skupín pre podujatia — katalóg podľa nich filtruje. */
async function loadGroupNames(groupIds: (string | null | undefined)[]) {
  const ids = [...new Set(groupIds.filter(Boolean))] as string[];
  if (ids.length === 0) return new Map<string, string>();
  const { data } = await supabaseAdmin.from("event_groups").select("id, name").in("id", ids);
  return new Map((data || []).map((g) => [g.id, g.name]));
}

/** Načíta typy lístkov pre zadané podujatia naraz (bez N+1 dotazov). */
async function loadTicketTypes(eventIds: string[]): Promise<Map<string, EventTicketType[]>> {
  const byEvent = new Map<string, EventTicketType[]>();
  if (eventIds.length === 0) return byEvent;
  const { data } = await supabaseAdmin
    .from("ticket_types")
    .select("id, event_id, name, price, quantity")
    .in("event_id", eventIds)
    .order("created_at", { ascending: true });
  for (const t of data || []) {
    const list = byEvent.get(t.event_id) || [];
    list.push({ id: t.id, name: t.name, price: Number(t.price), quantity: t.quantity });
    byEvent.set(t.event_id, list);
  }
  return byEvent;
}

/** Načíta termíny pre zadané podujatia naraz (bez N+1 dotazov). */
async function loadDates(eventIds: string[]): Promise<Map<string, EventDateSummary[]>> {
  const byEvent = new Map<string, EventDateSummary[]>();
  if (eventIds.length === 0) return byEvent;
  const { data } = await supabaseAdmin
    .from("event_dates")
    .select("id, event_id, event_date, event_time, status, total_tickets, note")
    .in("event_id", eventIds)
    .order("event_date", { ascending: true })
    .order("event_time", { ascending: true });
  for (const d of data || []) {
    const list = byEvent.get(d.event_id) || [];
    list.push({
      id: d.id,
      event_date: d.event_date,
      event_time: (d.event_time || "").slice(0, 5),
      status: d.status === "cancelled" ? "cancelled" : "on_sale",
      total_tickets: d.total_tickets ?? undefined,
      note: d.note ?? undefined,
    });
    byEvent.set(d.event_id, list);
  }
  return byEvent;
}

async function loadOrganizerNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const { data } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", unique);
  for (const p of data || []) if (p.full_name) map.set(p.id, p.full_name);
  return map;
}

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
 * Verejný zoznam podujatí. Bez `organizer_id` vracia len publikované — to je
 * to, čo vidí neprihlásený návštevník katalógu.
 */
export const listEvents = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        status: z.enum(["published", "draft", "all"]).default("published"),
        organizer_id: z.string().uuid().optional(),
        limit: z.number().int().positive().max(500).default(200),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<EventRecord[]> => {
    let q = supabaseAdmin.from("events").select(EVENT_COLUMNS).limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.organizer_id) q = q.eq("organizer_id", data.organizer_id);
    const { data: rows, error } = await q.order("event_date", { ascending: true });
    if (error) throw new Error(error.message);

    const list = (rows || []) as EventRow[];
    const ids = list.map((r) => r.id as string);
    const [tickets, dates, names, groups] = await Promise.all([
      loadTicketTypes(ids),
      loadDates(ids),
      loadOrganizerNames(list.map((r) => r.organizer_id as string)),
      loadGroupNames(list.map((r) => r.group_id as string | null)),
    ]);
    return list.map((r) =>
      mapEvent(
        r,
        tickets.get(r.id as string) || [],
        dates.get(r.id as string) || [],
        names.get(r.organizer_id as string),
        r.group_id ? groups.get(r.group_id as string) : undefined,
      ),
    );
  });

/** Detail podujatia. Koncept (`draft`) vráti len jeho vlastníkovi alebo adminovi. */
export const getEventById = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), viewer_id: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data }): Promise<EventRecord | null> => {
    const { data: row } = await supabaseAdmin
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (!row) return null;

    const r = row as EventRow;
    if (r.status !== "published") {
      const viewer = data.viewer_id;
      const allowed = !!viewer && (viewer === r.organizer_id || (await isAdmin(viewer)));
      if (!allowed) return null;
    }

    const [tickets, dates, names, groups] = await Promise.all([
      loadTicketTypes([r.id as string]),
      loadDates([r.id as string]),
      loadOrganizerNames([r.organizer_id as string]),
      loadGroupNames([r.group_id as string | null]),
    ]);
    return mapEvent(
      r,
      tickets.get(r.id as string) || [],
      dates.get(r.id as string) || [],
      names.get(r.organizer_id as string),
      r.group_id ? groups.get(r.group_id as string) : undefined,
    );
  });

const TicketTypeInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  price: z.number().nonnegative(),
  quantity: z.number().int().nonnegative(),
});

const EventInput = z.object({
  id: z.string().uuid().optional(),
  // Rešpektuje sa VÝHRADNE adminovi (zakladanie podujatia za organizátora).
  // Bežnému používateľovi sa ignoruje — inak by si mohol podstrčiť cudzie id.
  organizer_id: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  category: z.string().min(1).max(120),
  event_date: z.string().min(1),
  event_time: z.string().min(1),
  venue: z.string().min(1).max(300),
  city: z.string().min(1).max(200),
  address: z.string().max(400).optional().nullable(),
  description: z.string().max(20000).optional().nullable(),
  image_url: z.string().max(2000).optional().nullable(),
  status: z.enum(["draft", "published"]).default("draft"),
  sale_type: z.enum(["standing", "seating", "seating_map"]).default("standing"),
  venue_id: z.string().uuid().optional().nullable(),
  venue_layout_id: z.string().max(200).optional().nullable(),
  group_id: z.string().uuid().optional().nullable(),
  base_price: z.number().nonnegative().optional().nullable(),
  total_tickets: z.number().int().nonnegative().optional().nullable(),
  vip_price: z.number().nonnegative().optional().nullable(),
  tickets: z.array(TicketTypeInput).max(50).default([]),
});

/** Vstup pre `upsertEvent` tak, ako ho posiela klient (polia s default sú voliteľné). */
export type EventInputData = z.input<typeof EventInput>;

/**
 * Vytvorí alebo upraví podujatie aj s typmi lístkov.
 * Vlastníctvo sa vynucuje na serveri: organizátor smie meniť len svoje podujatia,
 * admin všetky. `organizer_id` sa nikdy nepreberá z klienta.
 */
export const upsertEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => EventInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const admin = await isAdmin(context.userId);

    let organizerId = admin && data.organizer_id ? data.organizer_id : context.userId;
    // Obrázok pred úpravou — ak ho organizátor vymení, ten starý po zápise
    // upraceme, inak by v úložisku ostal navždy.
    let povodnyObrazok: string | null = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("events")
        .select("id, organizer_id, image_url")
        .eq("id", data.id)
        .maybeSingle();
      if (!existing) throw new Error("Podujatie sa nenašlo");
      if (existing.organizer_id !== context.userId && !admin) {
        throw new Error("Forbidden: podujatie patrí inému organizátorovi");
      }
      povodnyObrazok = existing.image_url;
      // Pri úprave sa vlastník zachová; prepísať ho môže len admin, a to
      // výslovným poslaním `organizer_id`.
      organizerId = admin && data.organizer_id ? data.organizer_id : existing.organizer_id;
    }

    // Miesto konania je zdroj pravdy: adresu z neho odtlačíme do podujatia,
    // aby ju verejný katalóg, PDF aj e-maily čítali bez ďalšieho dotazu — a aby
    // podujatie prežilo zmazanie miesta s tým, kde sa naozaj konalo.
    let venue = data.venue;
    let city = data.city;
    let address = data.address ?? null;
    if (data.venue_id) {
      const { data: place } = await supabaseAdmin
        .from("venues")
        .select("name, city, address")
        .eq("id", data.venue_id)
        .maybeSingle();
      if (place) {
        venue = place.name;
        city = place.city;
        address = place.address;
      }
    }

    // POZOR: `event_date` / `event_time` na podujatí sú len odtlačok najbližšieho
    // termínu — udržiava ich trigger `trg_event_dates_sync_event`. Preto ich tu
    // pri úprave nezapisujeme; meníme samotný termín a databáza si to premietne.
    const row = {
      title: data.title,
      category: data.category,
      venue,
      city,
      address,
      description: data.description ?? null,
      image_url: data.image_url ?? null,
      status: data.status,
      sale_type: data.sale_type,
      venue_id: data.venue_id ?? null,
      venue_layout_id: data.venue_layout_id ?? null,
      group_id: data.group_id ?? null,
      base_price: data.base_price ?? null,
      total_tickets: data.total_tickets ?? null,
      vip_price: data.vip_price ?? null,
      organizer_id: organizerId,
      updated_at: new Date().toISOString(),
    };

    let eventId: string;
    if (data.id) {
      const { error } = await supabaseAdmin.from("events").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      eventId = data.id;
      if (povodnyObrazok && povodnyObrazok !== row.image_url) {
        await deleteEventImageIfUnused(povodnyObrazok);
      }
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("events")
        .insert({ ...row, event_date: data.event_date, event_time: data.event_time })
        .select("id")
        .single();
      if (error || !created) throw new Error(error?.message || "Podujatie sa nepodarilo vytvoriť");
      eventId = created.id;
    }

    // Termíny. Podujatie bez termínu sa nedá kúpiť, takže prvý vzniká hneď pri
    // založení. Pri úprave posunieme termín len vtedy, keď je jediný — pri
    // repríze by inak formulár podujatia prepísal jeden z viacerých dátumov.
    const { data: existingDates } = await supabaseAdmin
      .from("event_dates")
      .select("id")
      .eq("event_id", eventId)
      .order("event_date", { ascending: true })
      .order("event_time", { ascending: true });
    if (!existingDates || existingDates.length === 0) {
      await supabaseAdmin.from("event_dates").insert({
        event_id: eventId,
        event_date: data.event_date,
        event_time: data.event_time,
      });
    } else if (existingDates.length === 1) {
      await supabaseAdmin
        .from("event_dates")
        .update({
          event_date: data.event_date,
          event_time: data.event_time,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingDates[0].id);
    }

    // Typy lístkov: dorovnáme na stav poslaný klientom. Odstránené riadky sa
    // zmažú; `order_items.ticket_type_id` má `on delete set null`, takže už
    // predané položky si zachovajú svoj názov aj cenu (sú denormalizované).
    const { data: current } = await supabaseAdmin
      .from("ticket_types")
      .select("id")
      .eq("event_id", eventId);
    const keep = new Set(data.tickets.map((t) => t.id).filter(Boolean) as string[]);
    const toDelete = (current || []).map((t) => t.id).filter((id) => !keep.has(id));
    if (toDelete.length > 0) {
      await supabaseAdmin.from("ticket_types").delete().in("id", toDelete);
    }
    for (const t of data.tickets) {
      const payload = { event_id: eventId, name: t.name, price: t.price, quantity: t.quantity };
      if (t.id) {
        await supabaseAdmin.from("ticket_types").update(payload).eq("id", t.id);
      } else {
        await supabaseAdmin.from("ticket_types").insert(payload);
      }
    }

    return { id: eventId };
  });

export const deleteEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: existing } = await supabaseAdmin
      .from("events")
      .select("id, organizer_id, image_url")
      .eq("id", data.id)
      .maybeSingle();
    if (!existing) throw new Error("Podujatie sa nenašlo");
    if (existing.organizer_id !== context.userId && !(await isAdmin(context.userId))) {
      throw new Error("Forbidden: podujatie patrí inému organizátorovi");
    }
    const { error } = await supabaseAdmin.from("events").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await deleteEventImageIfUnused(existing.image_url);
    return { ok: true };
  });

export type OrganizerOption = { id: string; full_name: string; email: string };

/**
 * Zoznam organizátorov pre admin výber „za koho zakladám podujatie".
 * Vracia reálnych používateľov z databázy — demo účty z localStorage majú id
 * ako `demo-organizer`, ktoré by `upsertEvent` odmietol (čaká UUID).
 */
export const listOrganizers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OrganizerOption[]> => {
    if (!(await isAdmin(context.userId))) throw new Error("Forbidden: vyžaduje sa rola admin");

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["organizer", "admin"]);
    const ids = [...new Set((roles || []).map((r) => r.user_id))];
    if (ids.length === 0) return [];

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    const names = new Map((profiles || []).map((p) => [p.id, p.full_name || ""]));

    const { data: authList } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const emails = new Map((authList?.users || []).map((u) => [u.id, u.email || ""]));

    return ids
      .map((id) => ({
        id,
        full_name: names.get(id) || emails.get(id) || id,
        email: emails.get(id) || "",
      }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  });

/**
 * Skenovací token podujatia. Je to zdieľané tajomstvo, ktoré autorizuje
 * označovanie vstupeniek za použité, takže ho vydávame výhradne vlastníkovi
 * podujatia alebo adminovi — nikdy ho neprikladáme k bežnému detailu.
 */
export const getEventScannerToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ scanner_token: string }> => {
    const { data: row } = await supabaseAdmin
      .from("events")
      .select("organizer_id, scanner_token")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Podujatie sa nenašlo");
    if (row.organizer_id !== context.userId && !(await isAdmin(context.userId))) {
      throw new Error("Forbidden: podujatie patrí inému organizátorovi");
    }
    return { scanner_token: row.scanner_token };
  });
