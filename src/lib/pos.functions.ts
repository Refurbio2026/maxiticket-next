// Server funkcie pre pokladňu (POS).
//
// Predaj na mieste vytvára tie isté `orders` / `order_items` / `tickets` ako
// web — líši sa len `channel = 'pos'` a spôsobom platby. Vďaka tomu funguje
// skener, kapacita, štatistiky aj vyúčtovanie organizátorovi bez ďalšej vetvy.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import crypto from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { newSignedTicket } from "./qr-token.server";
import { loadSeatPricing } from "./seat-pricing.server";
import { checkCoupon, couponErrorMessage, releaseCoupon, recordRedemption } from "./coupons.server";
import { buildClosingDocument } from "./pos-documents.server";
import type { Database } from "@/integrations/supabase/types";

export const CASHIER_PERMISSIONS = [
  "sale",
  "void",
  "refund",
  "open_register",
  "close_register",
  "view_sales",
] as const;
export type CashierPermission = (typeof CASHIER_PERMISSIONS)[number];

export type PosCashierRecord = {
  id: string;
  organizer_id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  status: "active" | "inactive";
  permissions: CashierPermission[];
  created_at: string;
  /** Má tento pokladník práve otvorenú smenu? */
  open_session_id?: string;
  /** Vyplní sa len v admin prehľade naprieč organizátormi. */
  organizer_name?: string;
};

export type PosSessionRecord = {
  id: string;
  cashier_id: string;
  cashier_name: string;
  organizer_id: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at?: string;
  opening_cash: number;
  closing_cash?: number;
  note?: string;
};

export type PosSaleRecord = {
  id: string;
  receipt_number: string;
  created_at: string;
  event_id: string;
  event_title: string;
  event_date: string;
  cashier_id?: string;
  cashier_name?: string;
  pos_session_id?: string;
  payment_method: string;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  promo_code?: string;
  void_reason?: string;
  fiscal_receipt_id?: string;
  items: { label: string; quantity: number; unit_price: number }[];
  tickets: { id: string; seat_label: string; qr_code: string }[];
};

// --- PIN --------------------------------------------------------------
// Štvorciferný PIN má 10 000 možností, takže obyčajný SHA-256 by sa dal
// prelúskať hotovou tabuľkou. Preto ho podpisujeme tajomstvom aplikácie
// (rovnaké, akým sa podpisujú QR vstupenky) a overujeme v konštantnom čase.

function pinSecret(): string {
  const secret = process.env.TICKET_QR_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Chýba TICKET_QR_SECRET — PIN sa nedá bezpečne uložiť.");
  return secret;
}

function hashPin(cashierId: string, pin: string): string {
  // Do hashu ide aj id pokladníka, takže dvaja s rovnakým PIN-om majú iný hash.
  return crypto.createHmac("sha256", pinSecret()).update(`${cashierId}:${pin}`).digest("hex");
}

function pinMatches(cashierId: string, pin: string, hash: string): boolean {
  const candidate = Buffer.from(hashPin(cashierId, pin));
  const stored = Buffer.from(hash);
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

// --- Spoločné ---------------------------------------------------------

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
 * Kto vlastní tržbu. Organizátor pracuje vždy pod sebou; admin smie zadať
 * `organizer_id` a pozerať sa cudziemu organizátorovi pod prsty.
 */
async function resolveOrganizer(userId: string, requested?: string | null): Promise<string> {
  if (requested && requested !== userId) {
    if (!(await isAdmin(userId))) throw new Error("Forbidden: cudzia pokladňa");
    return requested;
  }
  return userId;
}

async function loadSession(sessionId: string, organizerId: string) {
  const { data } = await supabaseAdmin
    .from("pos_sessions")
    .select("id, organizer_id, cashier_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!data) throw new Error("Smena sa nenašla");
  if (data.organizer_id !== organizerId) throw new Error("Forbidden: cudzia smena");
  if (data.status !== "open") throw new Error("Smena je už uzavretá — otvor novú.");
  return data;
}

async function assertPermission(cashierId: string, permission: CashierPermission) {
  const { data } = await supabaseAdmin
    .from("pos_cashiers")
    .select("permissions, status, display_name")
    .eq("id", cashierId)
    .maybeSingle();
  if (!data) throw new Error("Pokladník sa nenašiel");
  if (data.status !== "active") throw new Error("Pokladník je deaktivovaný");
  if (!(data.permissions || []).includes(permission)) {
    throw new Error(`${data.display_name} nemá oprávnenie na túto operáciu.`);
  }
}

// --- Pokladníci -------------------------------------------------------

export const listCashiers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ organizer_id: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<PosCashierRecord[]> => {
    const admin = await isAdmin(context.userId);
    // Admin bez zadaného organizátora vidí pokladníkov všetkých.
    const allOrganizers = admin && !data.organizer_id;
    let q = supabaseAdmin
      .from("pos_cashiers")
      .select(
        "id, organizer_id, first_name, last_name, display_name, status, permissions, created_at",
      )
      .order("created_at", { ascending: false });
    if (!allOrganizers) {
      const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
      q = q.eq("organizer_id", organizerId);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const organizerNames = new Map<string, string>();
    if (allOrganizers && (rows || []).length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", [...new Set((rows || []).map((r) => r.organizer_id))]);
      for (const p of profiles || []) organizerNames.set(p.id, p.full_name || "");
    }

    const ids = (rows || []).map((r) => r.id);
    const open = new Map<string, string>();
    if (ids.length > 0) {
      const { data: sessions } = await supabaseAdmin
        .from("pos_sessions")
        .select("id, cashier_id")
        .in("cashier_id", ids)
        .eq("status", "open");
      for (const s of sessions || []) open.set(s.cashier_id, s.id);
    }

    return (rows || []).map((r) => ({
      id: r.id,
      organizer_id: r.organizer_id,
      first_name: r.first_name,
      last_name: r.last_name,
      display_name: r.display_name,
      status: r.status as "active" | "inactive",
      permissions: (r.permissions || []) as CashierPermission[],
      created_at: r.created_at,
      open_session_id: open.get(r.id),
      organizer_name: organizerNames.get(r.organizer_id) || undefined,
    }));
  });

const CashierSchema = z.object({
  id: z.string().uuid().optional(),
  organizer_id: z.string().uuid().optional(),
  first_name: z.string().min(1).max(120),
  last_name: z.string().min(1).max(120),
  // Zobrazované meno; bez neho sa poskladá z mena a priezviska.
  display_name: z.string().max(200).optional(),
  // PIN je povinný len pri zakladaní; pri úprave prázdny = nechať pôvodný.
  pin: z
    .string()
    .regex(/^\d{4,8}$/, "PIN musí mať 4 až 8 číslic")
    .optional(),
  status: z.enum(["active", "inactive"]).default("active"),
  permissions: z.array(z.enum(CASHIER_PERMISSIONS)).min(1).default(["sale"]),
});
export type CashierInput = z.input<typeof CashierSchema>;

export const upsertCashier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CashierSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
    const displayName = (data.display_name || `${data.first_name} ${data.last_name}`).trim();

    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("pos_cashiers")
        .select("id, organizer_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!existing) throw new Error("Pokladník sa nenašiel");
      if (existing.organizer_id !== organizerId) throw new Error("Forbidden: cudzí pokladník");

      const patch = {
        first_name: data.first_name,
        last_name: data.last_name,
        display_name: displayName,
        status: data.status,
        permissions: data.permissions as string[],
        updated_at: new Date().toISOString(),
        // Prázdny PIN pri úprave znamená „nechaj pôvodný".
        ...(data.pin ? { pin_hash: hashPin(data.id, data.pin) } : {}),
      };
      const { error } = await supabaseAdmin.from("pos_cashiers").update(patch).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    if (!data.pin) throw new Error("Nový pokladník potrebuje PIN.");
    // Id si vyrobíme dopredu, lebo vstupuje do hashu PIN-u.
    const id = crypto.randomUUID();
    const { error } = await supabaseAdmin.from("pos_cashiers").insert({
      id,
      organizer_id: organizerId,
      first_name: data.first_name,
      last_name: data.last_name,
      display_name: displayName,
      pin_hash: hashPin(id, data.pin),
      status: data.status,
      permissions: data.permissions,
    });
    if (error) throw new Error(error.message);
    return { id };
  });

/**
 * Pokladníka s históriou predajov nemažeme — deaktivujeme ho. Doklad musí
 * navždy vedieť, kto ho vystavil.
 */
export const deleteCashier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: cashier } = await supabaseAdmin
      .from("pos_cashiers")
      .select("id, organizer_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!cashier) throw new Error("Pokladník sa nenašiel");
    await resolveOrganizer(context.userId, cashier.organizer_id);

    const { count } = await supabaseAdmin
      .from("pos_sessions")
      .select("id", { count: "exact", head: true })
      .eq("cashier_id", data.id);
    if ((count ?? 0) > 0) {
      await supabaseAdmin
        .from("pos_cashiers")
        .update({ status: "inactive", updated_at: new Date().toISOString() })
        .eq("id", data.id);
      return { ok: true, deactivated: true };
    }

    const { error } = await supabaseAdmin.from("pos_cashiers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, deactivated: false };
  });

// --- Smeny ------------------------------------------------------------

/** Riadok smeny tak, ako ho vracia databáza. */
type PosSessionRow = Database["public"]["Tables"]["pos_sessions"]["Row"];

function mapSession(row: PosSessionRow, cashierName: string): PosSessionRecord {
  return {
    id: row.id,
    cashier_id: row.cashier_id,
    cashier_name: cashierName,
    organizer_id: row.organizer_id,
    // `status` je v databáze obyčajný text; smena je buď zatvorená, alebo
    // otvorená — čokoľvek iné berieme ako otvorenú, nech sa nestratí.
    status: row.status === "closed" ? "closed" : "open",
    opened_at: row.opened_at,
    closed_at: row.closed_at ?? undefined,
    opening_cash: Number(row.opening_cash || 0),
    closing_cash: row.closing_cash === null ? undefined : Number(row.closing_cash),
    note: row.note ?? undefined,
  };
}

/**
 * Prihlásenie pokladníka a otvorenie smeny.
 * PIN sa overuje na serveri — v prehliadači by sa dal obísť. Neúspešné pokusy
 * sú limitované, inak sa štvorciferný PIN uhádne skriptom za pár sekúnd.
 */
export const openPosSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        cashier_id: z.string().uuid(),
        pin: z.string().min(4).max(8),
        opening_cash: z.number().nonnegative().default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<PosSessionRecord> => {
    const { data: allowed } = await supabaseAdmin.rpc("hit_rate_limit", {
      p_bucket: `pos:pin:${data.cashier_id}`,
      p_limit: 10,
      p_window_seconds: 900,
    });
    if (allowed === false) {
      throw new Error("Príliš veľa pokusov o PIN. Skús to o 15 minút.");
    }

    const { data: cashier } = await supabaseAdmin
      .from("pos_cashiers")
      .select("id, organizer_id, display_name, pin_hash, status, permissions")
      .eq("id", data.cashier_id)
      .maybeSingle();
    if (!cashier) throw new Error("Pokladník sa nenašiel");
    await resolveOrganizer(context.userId, cashier.organizer_id);
    if (cashier.status !== "active") throw new Error("Pokladník je deaktivovaný");
    if (!pinMatches(cashier.id, data.pin, cashier.pin_hash)) throw new Error("Nesprávny PIN");

    // Otvorená smena je jedna — ak už beží, vrátime ju namiesto chyby.
    const { data: running } = await supabaseAdmin
      .from("pos_sessions")
      .select("*")
      .eq("cashier_id", cashier.id)
      .eq("status", "open")
      .maybeSingle();
    if (running) return mapSession(running, cashier.display_name);

    const { data: created, error } = await supabaseAdmin
      .from("pos_sessions")
      .insert({
        organizer_id: cashier.organizer_id,
        cashier_id: cashier.id,
        opening_cash: data.opening_cash,
      })
      .select("*")
      .single();
    if (error || !created) throw new Error(error?.message || "Smenu sa nepodarilo otvoriť");
    return mapSession(created, cashier.display_name);
  });

/**
 * Overenie PIN-u bez otvorenia smeny — pokladník tak vidí chybu hneď pri
 * zadávaní, nie až po vyplnení počiatočnej hotovosti. Otvorenie smeny si PIN
 * overuje znovu, takže toto nie je jediná zábrana.
 */
export const verifyCashierPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ cashier_id: z.string().uuid(), pin: z.string().min(4).max(8) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { data: allowed } = await supabaseAdmin.rpc("hit_rate_limit", {
      p_bucket: `pos:pin:${data.cashier_id}`,
      p_limit: 10,
      p_window_seconds: 900,
    });
    if (allowed === false) throw new Error("Príliš veľa pokusov o PIN. Skús to o 15 minút.");

    const { data: cashier } = await supabaseAdmin
      .from("pos_cashiers")
      .select("id, organizer_id, pin_hash, status")
      .eq("id", data.cashier_id)
      .maybeSingle();
    if (!cashier) throw new Error("Pokladník sa nenašiel");
    await resolveOrganizer(context.userId, cashier.organizer_id);
    if (cashier.status !== "active") throw new Error("Pokladník je deaktivovaný");
    return { ok: pinMatches(cashier.id, data.pin, cashier.pin_hash) };
  });

export const closePosSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        session_id: z.string().uuid(),
        closing_cash: z.number().nonnegative().optional(),
        note: z.string().max(2000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: session } = await supabaseAdmin
      .from("pos_sessions")
      .select("id, organizer_id, status")
      .eq("id", data.session_id)
      .maybeSingle();
    if (!session) throw new Error("Smena sa nenašla");
    await resolveOrganizer(context.userId, session.organizer_id);

    const { error } = await supabaseAdmin
      .from("pos_sessions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closing_cash: data.closing_cash ?? null,
        note: data.note ?? null,
      })
      .eq("id", data.session_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Smeny organizátora; predvolene len tie otvorené. */
export const listPosSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        organizer_id: z.string().uuid().optional(),
        status: z.enum(["open", "closed", "all"]).default("open"),
        limit: z.number().int().positive().max(200).default(50),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<PosSessionRecord[]> => {
    const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
    let q = supabaseAdmin
      .from("pos_sessions")
      .select("*")
      .eq("organizer_id", organizerId)
      .order("opened_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const cashierIds = [...new Set((rows || []).map((r) => r.cashier_id))];
    const names = new Map<string, string>();
    if (cashierIds.length > 0) {
      const { data: cashiers } = await supabaseAdmin
        .from("pos_cashiers")
        .select("id, display_name")
        .in("id", cashierIds);
      for (const c of cashiers || []) names.set(c.id, c.display_name);
    }
    return (rows || []).map((r) => mapSession(r, names.get(r.cashier_id) || "—"));
  });

// --- Predaj -----------------------------------------------------------

const PosItemSchema = z.object({
  ticket_type_id: z.string().uuid().optional().nullable(),
  seat_id: z.string().max(120).optional().nullable(),
  seat_label: z.string().max(200).optional().nullable(),
  quantity: z.number().int().positive().max(50).default(1),
});

const PosSaleSchema = z.object({
  session_id: z.string().uuid(),
  event_id: z.string().uuid(),
  event_date_id: z.string().uuid().optional(),
  items: z.array(PosItemSchema).min(1).max(100),
  payment_method: z.enum(["cash", "card", "transfer", "free"]),
  discount_pct: z.number().min(0).max(100).default(0),
  promo_code: z.string().max(60).optional().nullable(),
  customer_name: z.string().max(200).optional().nullable(),
  customer_email: z.string().email().optional().nullable(),
  fiscal_receipt_id: z.string().max(120).optional().nullable(),
});
export type PosSaleInput = z.input<typeof PosSaleSchema>;

/**
 * Predaj z pokladne. Peniaze sú prijaté na mieste, takže objednávka vzniká
 * rovno ako `paid` a vstupenky sa vydajú okamžite — kupujúci odchádza s QR
 * kódom, ktorý skener pozná.
 *
 * BEZPEČNOSŤ: ceny určuje server z databázy rovnako ako pri webovom predaji.
 * Pokladňa posiela len to, ČO sa predáva, nikdy za koľko.
 */
export const createPosSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PosSaleSchema.parse(input))
  .handler(async ({ data, context }) => {
    const organizerId = context.userId;
    const session = await loadSession(data.session_id, organizerId);
    await assertPermission(session.cashier_id, "sale");

    const { data: event } = await supabaseAdmin
      .from("events")
      .select("id, organizer_id, status, base_price, vip_price, total_tickets, venue_layout_id")
      .eq("id", data.event_id)
      .maybeSingle();
    if (!event) throw new Error("Podujatie sa nenašlo");
    if (event.organizer_id !== organizerId && !(await isAdmin(organizerId))) {
      throw new Error("Forbidden: podujatie patrí inému organizátorovi");
    }

    // Termín: rovnaké pravidlá ako na webe.
    const today = new Date().toISOString().slice(0, 10);
    let eventDate: { id: string; total_tickets: number | null };
    if (data.event_date_id) {
      const { data: row } = await supabaseAdmin
        .from("event_dates")
        .select("id, event_id, status, total_tickets, event_date")
        .eq("id", data.event_date_id)
        .maybeSingle();
      if (!row || row.event_id !== data.event_id) throw new Error("Termín sa nenašiel");
      if (row.status !== "on_sale") throw new Error("Tento termín nie je v predaji");
      eventDate = { id: row.id, total_tickets: row.total_tickets };
    } else {
      const { data: rows } = await supabaseAdmin
        .from("event_dates")
        .select("id, total_tickets")
        .eq("event_id", data.event_id)
        .eq("status", "on_sale")
        .gte("event_date", today)
        .order("event_date", { ascending: true })
        .order("event_time", { ascending: true })
        .limit(1);
      if (!rows?.[0]) throw new Error("Podujatie nemá žiadny termín v predaji");
      eventDate = { id: rows[0].id, total_tickets: rows[0].total_tickets };
    }

    const { data: ticketTypes } = await supabaseAdmin
      .from("ticket_types")
      .select("id, name, price, quantity")
      .eq("event_id", data.event_id);
    const typeById = new Map((ticketTypes || []).map((t) => [t.id, t]));

    const basePrice = Number(event.base_price ?? 0);
    const vipPrice = event.vip_price === null ? basePrice : Number(event.vip_price);

    // Zónu aj cenu sedadla určuje rozloženie sály, nie pokladník. Rovnaké
    // ocenenie ako na webe — spoločné v `seat-pricing.server.ts`.
    const pricing = await loadSeatPricing({
      eventId: data.event_id,
      venueLayoutId: event.venue_layout_id,
      basePrice,
      vipPrice,
    });

    const priced = data.items.map((it) => {
      if (it.ticket_type_id) {
        const tt = typeById.get(it.ticket_type_id);
        if (!tt) throw new Error("Neplatný typ vstupenky");
        return {
          ticket_type_id: tt.id,
          seat_id: it.seat_id || null,
          label: tt.name,
          unit_price: Number(tt.price),
          quantity: it.quantity,
          is_vip: false,
        };
      }
      if (it.seat_id) {
        const vip = pricing.isVip(it.seat_id);
        return {
          ticket_type_id: null,
          seat_id: it.seat_id,
          label: it.seat_label || it.seat_id,
          unit_price: pricing.priceFor(it.seat_id),
          quantity: 1,
          is_vip: vip,
        };
      }
      return {
        ticket_type_id: null,
        seat_id: null,
        label: "Vstupenka",
        unit_price: basePrice,
        quantity: it.quantity,
        is_vip: false,
      };
    });

    // Voľná vstupenka (`free`) smie mať nulu; inak musí byť cena nastavená.
    if (data.payment_method !== "free" && priced.some((p) => p.unit_price <= 0)) {
      throw new Error("Podujatie nemá nastavenú cenu vstupenky");
    }

    // Kapacita v rámci termínu — pokladňa nesmie prepredať sálu, ktorú
    // súbežne predáva web.
    const seatless = priced.filter((p) => !p.seat_id);
    const byType = new Map<string | null, number>();
    for (const p of seatless) {
      byType.set(p.ticket_type_id, (byType.get(p.ticket_type_id) || 0) + p.quantity);
    }
    for (const [typeId, requested] of byType) {
      const capacity = typeId
        ? Number(typeById.get(typeId)?.quantity ?? 0)
        : Number(eventDate.total_tickets ?? event.total_tickets ?? 0);
      if (capacity <= 0) continue;
      let q = supabaseAdmin
        .from("order_items")
        .select("quantity, orders!inner(event_date_id, status)")
        .eq("orders.event_date_id", eventDate.id)
        .in("orders.status", ["pending", "awaiting_payment", "paid"]);
      q = typeId ? q.eq("ticket_type_id", typeId) : q.is("ticket_type_id", null);
      const { data: taken } = await q;
      const used = (taken || []).reduce((s, r: { quantity: number }) => s + (r.quantity || 0), 0);
      if (used + requested > capacity) {
        const left = Math.max(0, capacity - used);
        throw new Error(left === 0 ? "Vypredané." : `K dispozícii je už len ${left} ks.`);
      }
    }

    const subtotal = priced.reduce((s, it) => s + it.unit_price * it.quantity, 0);

    // Zľavový kupón overuje a uplatňuje server. Predtým mala pokladňa trojicu
    // kódov natvrdo v komponente — dali sa prečítať z JavaScriptu prehliadača
    // a použiť donekonečna. Ručná zľava pokladníka (`discount_pct`) platí len
    // vtedy, keď kupón zadaný nie je.
    let couponId: string | null = null;
    let couponDiscount = 0;
    if (data.promo_code?.trim()) {
      const result = await checkCoupon({
        code: data.promo_code,
        eventId: data.event_id,
        amount: subtotal,
        email: data.customer_email ?? null,
        claim: true,
      });
      if (!result.ok) throw new Error(couponErrorMessage(result.error));
      couponId = result.coupon_id;
      couponDiscount = result.discount;
    }

    const discount =
      data.payment_method === "free"
        ? subtotal
        : couponId
          ? couponDiscount
          : Math.round(((subtotal * data.discount_pct) / 100) * 100) / 100;
    const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);

    const { data: receipt } = await supabaseAdmin.rpc("next_receipt_number", {
      p_organizer_id: organizerId,
    });

    const now = new Date().toISOString();
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        event_id: data.event_id,
        event_date_id: eventDate.id,
        channel: "pos",
        payment_method: data.payment_method,
        cashier_id: session.cashier_id,
        pos_session_id: session.id,
        receipt_number: receipt as string,
        discount_amount: discount,
        coupon_id: couponId,
        promo_code: couponId ? data.promo_code!.trim().toUpperCase() : null,
        fiscal_receipt_id: data.fiscal_receipt_id || null,
        customer_name: data.customer_name || null,
        customer_email: data.customer_email || null,
        total_amount: total,
        currency: "EUR",
        status: "paid",
        paid_at: now,
      })
      .select("id")
      .single();
    if (orderErr || !order) {
      if (couponId) await releaseCoupon(couponId);
      throw new Error(orderErr?.message || "Predaj sa nepodarilo uložiť");
    }

    const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(
      priced.map((it) => ({
        order_id: order.id,
        ticket_type_id: it.ticket_type_id,
        seat_id: it.seat_id,
        label: it.label,
        unit_price: it.unit_price,
        quantity: it.quantity,
      })),
    );
    if (itemsErr) {
      if (couponId) await releaseCoupon(couponId);
      throw new Error(itemsErr.message);
    }

    // Sedadlá cez tú istú atómickú funkciu ako web — dvaja kupujúci (jeden pri
    // pokladni, druhý na webe) nemôžu dostať to isté miesto.
    const seats = priced.filter((p) => p.seat_id);
    if (seats.length > 0) {
      const { error: seatErr } = await supabaseAdmin.rpc("reserve_seats", {
        p_event_id: data.event_id,
        p_event_date_id: eventDate.id,
        p_order_id: order.id,
        p_reserved_until: new Date(Date.now() + 60_000).toISOString(),
        p_seats: seats.map((s) => ({
          seat_id: s.seat_id,
          label: s.label,
          price: s.unit_price,
          is_vip: s.is_vip,
        })),
      });
      if (seatErr) {
        await supabaseAdmin.from("order_items").delete().eq("order_id", order.id);
        await supabaseAdmin.from("orders").delete().eq("id", order.id);
        if (couponId) await releaseCoupon(couponId);
        throw new Error(
          seatErr.message?.includes("SEATS_TAKEN")
            ? "Niektoré sedadlá si medzitým vzal iný kupujúci."
            : seatErr.message,
        );
      }
      await supabaseAdmin
        .from("seat_inventory")
        .update({ status: "sold", reserved_until: null })
        .eq("order_id", order.id);
    }

    // Vstupenky sa vydávajú hneď — zákazník odchádza s papierom v ruke.
    const tickets = priced.flatMap((it) =>
      Array.from({ length: it.quantity }).map((_, i) => {
        const { id, token } = newSignedTicket();
        return {
          id,
          order_id: order.id,
          event_id: data.event_id,
          event_date_id: eventDate.id,
          seat_id: it.seat_id,
          seat_label: it.label + (it.quantity > 1 ? ` #${i + 1}` : ""),
          qr_code: token,
          qr_token: token,
        };
      }),
    );
    const { error: ticketErr } = await supabaseAdmin.from("tickets").insert(tickets);
    if (ticketErr) throw new Error(ticketErr.message);

    if (couponId) {
      await recordRedemption({
        couponId,
        orderId: order.id,
        email: data.customer_email ?? null,
        discount,
      });
    }

    return {
      order_id: order.id,
      receipt_number: receipt as string,
      subtotal,
      discount,
      total,
      tickets: tickets.map((t) => ({ id: t.id, seat_label: t.seat_label, qr_code: t.qr_code })),
    };
  });

/**
 * Storno predaja z pokladne. Vstupenky sa označia za refundované (skener ich
 * odmietne) a sedadlá sa uvoľnia späť do predaja.
 */
export const voidPosSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        order_id: z.string().uuid(),
        session_id: z.string().uuid(),
        reason: z.string().min(1).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const session = await loadSession(data.session_id, context.userId);
    await assertPermission(session.cashier_id, "void");

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, status, channel, event_id, total_amount")
      .eq("id", data.order_id)
      .maybeSingle();
    if (!order) throw new Error("Predaj sa nenašiel");
    if (order.channel !== "pos") throw new Error("Toto nie je predaj z pokladne.");
    if (order.status !== "paid")
      throw new Error(`Predaj má stav ${order.status}, nedá sa stornovať.`);

    const { data: event } = await supabaseAdmin
      .from("events")
      .select("organizer_id")
      .eq("id", order.event_id)
      .maybeSingle();
    if (event?.organizer_id !== context.userId && !(await isAdmin(context.userId))) {
      throw new Error("Forbidden: cudzí predaj");
    }

    const now = new Date().toISOString();
    // `void_reason` zostáva kvôli prehľadu pokladne, `refund_*` je spoločný
    // záznam pre Storno — pokladňa aj web tak píšu na to isté miesto.
    await supabaseAdmin
      .from("orders")
      .update({
        status: "refunded",
        void_reason: data.reason,
        refunded_at: now,
        refunded_amount: Number(order.total_amount),
        refund_reason: data.reason,
        refunded_by: context.userId,
      })
      .eq("id", order.id);
    await supabaseAdmin
      .from("tickets")
      .update({ refunded_at: now })
      .eq("order_id", order.id)
      .is("refunded_at", null);
    await supabaseAdmin
      .from("seat_inventory")
      .update({ status: "available", reserved_until: null, order_id: null })
      .eq("order_id", order.id);

    return { ok: true };
  });

// --- Prehľady ---------------------------------------------------------

export const listPosSales = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        organizer_id: z.string().uuid().optional(),
        session_id: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().positive().max(500).default(100),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<PosSaleRecord[]> => {
    const admin = await isAdmin(context.userId);
    const organizerId = await resolveOrganizer(context.userId, data.organizer_id);

    // Admin bez zadaného organizátora vidí pokladne všetkých.
    let eventIds: string[] | null = null;
    if (!(admin && !data.organizer_id)) {
      const { data: events } = await supabaseAdmin
        .from("events")
        .select("id")
        .eq("organizer_id", organizerId);
      eventIds = (events || []).map((e) => e.id);
      if (eventIds.length === 0) return [];
    }

    let q = supabaseAdmin
      .from("orders")
      .select(
        "id, receipt_number, created_at, event_id, event_date_id, cashier_id, pos_session_id, payment_method, status, total_amount, discount_amount, promo_code, void_reason, fiscal_receipt_id",
      )
      .eq("channel", "pos")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (eventIds) q = q.in("event_id", eventIds);
    if (data.session_id) q = q.eq("pos_session_id", data.session_id);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);

    const { data: orders, error } = await q;
    if (error) throw new Error(error.message);
    const list = orders || [];
    if (list.length === 0) return [];

    const orderIds = list.map((o) => o.id);
    const [
      { data: items },
      { data: tickets },
      { data: events },
      { data: dates },
      { data: cashiers },
    ] = await Promise.all([
      supabaseAdmin
        .from("order_items")
        .select("order_id, label, quantity, unit_price")
        .in("order_id", orderIds),
      supabaseAdmin
        .from("tickets")
        .select("id, order_id, seat_label, qr_code")
        .in("order_id", orderIds),
      supabaseAdmin
        .from("events")
        .select("id, title")
        .in("id", [...new Set(list.map((o) => o.event_id))]),
      supabaseAdmin
        .from("event_dates")
        .select("id, event_date, event_time")
        .in("id", [...new Set(list.map((o) => o.event_date_id))]),
      supabaseAdmin
        .from("pos_cashiers")
        .select("id, display_name")
        .in("id", [...new Set(list.map((o) => o.cashier_id).filter(Boolean))] as string[]),
    ]);

    const titleById = new Map((events || []).map((e) => [e.id, e.title]));
    const dateById = new Map((dates || []).map((d) => [d.id, d]));
    const cashierById = new Map((cashiers || []).map((c) => [c.id, c.display_name]));

    return list.map((o) => {
      const myItems = (items || []).filter((i) => i.order_id === o.id);
      const subtotal = myItems.reduce((s, i) => s + Number(i.unit_price) * (i.quantity || 1), 0);
      const date = dateById.get(o.event_date_id);
      return {
        id: o.id,
        receipt_number: o.receipt_number || "—",
        created_at: o.created_at,
        event_id: o.event_id,
        event_title: titleById.get(o.event_id) || "—",
        event_date: date ? `${date.event_date} ${(date.event_time || "").slice(0, 5)}` : "",
        cashier_id: o.cashier_id ?? undefined,
        cashier_name: o.cashier_id ? cashierById.get(o.cashier_id) : undefined,
        pos_session_id: o.pos_session_id ?? undefined,
        payment_method: o.payment_method || "cash",
        status: o.status,
        subtotal: Math.round(subtotal * 100) / 100,
        discount: Number(o.discount_amount || 0),
        total: Number(o.total_amount || 0),
        promo_code: o.promo_code ?? undefined,
        void_reason: o.void_reason ?? undefined,
        fiscal_receipt_id: o.fiscal_receipt_id ?? undefined,
        items: myItems.map((i) => ({
          label: i.label,
          quantity: i.quantity || 1,
          unit_price: Number(i.unit_price),
        })),
        tickets: (tickets || [])
          .filter((t) => t.order_id === o.id)
          .map((t) => ({ id: t.id, seat_label: t.seat_label, qr_code: t.qr_code })),
      };
    });
  });

export type PosClosingTotals = {
  orders_count: number;
  tickets_count: number;
  cash_total: number;
  card_total: number;
  transfer_total: number;
  free_total: number;
  gross_total: number;
  voided_count: number;
  voided_total: number;
  opening_cash: number;
  expected_cash: number;
  period_from: string;
  period_to: string;
};

async function computeTotals(
  organizerId: string,
  sessionId: string | undefined,
  from: string,
  to: string,
): Promise<PosClosingTotals> {
  const { data: events } = await supabaseAdmin
    .from("events")
    .select("id")
    .eq("organizer_id", organizerId);
  const eventIds = (events || []).map((e) => e.id);

  let q = supabaseAdmin
    .from("orders")
    .select("id, payment_method, status, total_amount")
    .eq("channel", "pos")
    .gte("created_at", from)
    .lte("created_at", to);
  if (eventIds.length > 0) q = q.in("event_id", eventIds);
  if (sessionId) q = q.eq("pos_session_id", sessionId);
  const { data: orders } = await q;

  const paid = (orders || []).filter((o) => o.status === "paid");
  const voided = (orders || []).filter((o) => o.status === "refunded");
  const sum = (method: string) =>
    Math.round(
      paid
        .filter((o) => o.payment_method === method)
        .reduce((s, o) => s + Number(o.total_amount || 0), 0) * 100,
    ) / 100;

  let ticketsCount = 0;
  if (paid.length > 0) {
    const { count } = await supabaseAdmin
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .in(
        "order_id",
        paid.map((o) => o.id),
      );
    ticketsCount = count ?? 0;
  }

  let openingCash = 0;
  if (sessionId) {
    const { data: session } = await supabaseAdmin
      .from("pos_sessions")
      .select("opening_cash")
      .eq("id", sessionId)
      .maybeSingle();
    openingCash = Number(session?.opening_cash || 0);
  }

  const cash = sum("cash");
  return {
    orders_count: paid.length,
    tickets_count: ticketsCount,
    cash_total: cash,
    card_total: sum("card"),
    transfer_total: sum("transfer"),
    free_total: sum("free"),
    gross_total: Math.round(paid.reduce((s, o) => s + Number(o.total_amount || 0), 0) * 100) / 100,
    voided_count: voided.length,
    voided_total:
      Math.round(voided.reduce((s, o) => s + Number(o.total_amount || 0), 0) * 100) / 100,
    opening_cash: openingCash,
    // V zásuvke má byť počiatočná hotovosť plus hotovostné tržby.
    expected_cash: Math.round((openingCash + cash) * 100) / 100,
    period_from: from,
    period_to: to,
  };
}

const ClosingRange = z.object({
  organizer_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

function rangeOrToday(from?: string, to?: string) {
  const start = from ?? new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
  const end = to ?? new Date().toISOString();
  return { start, end };
}

/** Náhľad uzávierky — čísla ešte nie sú zmrazené. */
export const previewPosClosing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ClosingRange.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PosClosingTotals> => {
    const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
    const { start, end } = rangeOrToday(data.from, data.to);
    return computeTotals(organizerId, data.session_id, start, end);
  });

const ClosingSchema = ClosingRange.extend({
  counted_cash: z.number().nonnegative().optional(),
  note: z.string().max(2000).optional().nullable(),
  close_session: z.boolean().default(true),
});
export type PosClosingInput = z.input<typeof ClosingSchema>;

/**
 * Uloží uzávierku a zavrie smenu. Čísla sa zmrazia — neskorší predaj ani
 * storno ich už nesmie prepísať, inak by doklad nesedel s hotovosťou, ktorá
 * sa naozaj odovzdala.
 */
export const createPosClosing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ClosingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
    const { start, end } = rangeOrToday(data.from, data.to);

    let cashierId: string | null = null;
    if (data.session_id) {
      const session = await loadSession(data.session_id, organizerId);
      await assertPermission(session.cashier_id, "close_register");
      cashierId = session.cashier_id;
    }

    const totals = await computeTotals(organizerId, data.session_id, start, end);
    const counted = data.counted_cash ?? null;

    const { data: created, error } = await supabaseAdmin
      .from("pos_closings")
      .insert({
        organizer_id: organizerId,
        session_id: data.session_id ?? null,
        cashier_id: cashierId,
        period_from: start,
        period_to: end,
        orders_count: totals.orders_count,
        tickets_count: totals.tickets_count,
        cash_total: totals.cash_total,
        card_total: totals.card_total,
        transfer_total: totals.transfer_total,
        free_total: totals.free_total,
        gross_total: totals.gross_total,
        voided_count: totals.voided_count,
        voided_total: totals.voided_total,
        opening_cash: totals.opening_cash,
        counted_cash: counted,
        cash_difference:
          counted === null ? null : Math.round((counted - totals.expected_cash) * 100) / 100,
        note: data.note ?? null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "Uzávierku sa nepodarilo uložiť");

    if (data.session_id && data.close_session) {
      await supabaseAdmin
        .from("pos_sessions")
        .update({
          status: "closed",
          closed_at: new Date().toISOString(),
          closing_cash: counted,
        })
        .eq("id", data.session_id);
    }

    // PDF vzniká hneď pri uzávierke, nie až pri stiahnutí — dokument musí
    // zodpovedať číslam v okamihu, keď sa hotovosť odovzdávala. Keby sa
    // generovanie pokazilo, uzávierka je aj tak uložená a doklad sa dá
    // dotvoriť neskôr cez `getClosingDocument`.
    let documentId: string | null = null;
    try {
      const doc = await buildClosingDocument(created.id, context.userId);
      documentId = doc.id;
    } catch (e) {
      console.error("[POS] PDF uzávierky sa nepodarilo vytvoriť:", e);
    }

    return { id: created.id, document_id: documentId, ...totals, counted_cash: counted };
  });

export const listPosClosings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        organizer_id: z.string().uuid().optional(),
        limit: z.number().int().positive().max(200).default(50),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const admin = await isAdmin(context.userId);
    let q = supabaseAdmin
      .from("pos_closings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (!(admin && !data.organizer_id)) {
      const organizerId = await resolveOrganizer(context.userId, data.organizer_id);
      q = q.eq("organizer_id", organizerId);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const cashierIds = [...new Set((rows || []).map((r) => r.cashier_id).filter(Boolean))];
    const names = new Map<string, string>();
    if (cashierIds.length > 0) {
      const { data: cashiers } = await supabaseAdmin
        .from("pos_cashiers")
        .select("id, display_name")
        .in("id", cashierIds as string[]);
      for (const c of cashiers || []) names.set(c.id, c.display_name);
    }

    return (rows || []).map((r) => ({
      ...r,
      cashier_name: r.cashier_id ? (names.get(r.cashier_id) ?? "—") : "—",
      cash_total: Number(r.cash_total),
      card_total: Number(r.card_total),
      transfer_total: Number(r.transfer_total),
      free_total: Number(r.free_total),
      gross_total: Number(r.gross_total),
      voided_total: Number(r.voided_total),
      opening_cash: Number(r.opening_cash),
      counted_cash: r.counted_cash === null ? null : Number(r.counted_cash),
      cash_difference: r.cash_difference === null ? null : Number(r.cash_difference),
    }));
  });
