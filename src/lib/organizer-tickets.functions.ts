// Vstupenky organizátorov — koľko sa za koho vydalo, koľko sa naozaj prešlo
// dverami a koľko sa vrátilo.
//
// Nová evidencia to nie je: všetko je v `tickets` a `orders`. Vstupenka vzniká
// až po zaplatení, takže tento pohľad ukazuje predané, nie rezervované.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OrganizerTicketRow = {
  event_id: string;
  event_title: string;
  event_date: string;
  city: string;
  organizer_id: string;
  organizer_name: string;
  /** Vydané a platné — refundované sa nepočítajú. */
  issued: number;
  refunded: number;
  /** Vstupenky, ktoré prešli skenerom. */
  scanned: number;
  /** Tržba zo zaplatených objednávok na toto podujatie. */
  gross: number;
  channel_web: number;
  channel_pos: number;
};

export type OrganizerTicketsResult = {
  rows: OrganizerTicketRow[];
  totals: {
    issued: number;
    refunded: number;
    scanned: number;
    gross: number;
  };
};

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

export const listOrganizerTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        organizer_id: z.string().uuid().optional().nullable(),
        from: z.string().optional().nullable(),
        to: z.string().optional().nullable(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<OrganizerTicketsResult> => {
    await assertAdmin(context.userId);

    let eventsQ = supabaseAdmin
      .from("events")
      .select("id, title, event_date, city, organizer_id")
      .order("event_date", { ascending: false });
    if (data.organizer_id) eventsQ = eventsQ.eq("organizer_id", data.organizer_id);
    // Filtrujeme podľa dátumu podujatia — admin sa pýta „čo sme hrali v auguste".
    if (data.from) eventsQ = eventsQ.gte("event_date", data.from);
    if (data.to) eventsQ = eventsQ.lte("event_date", data.to);

    const { data: events, error } = await eventsQ;
    if (error) throw new Error(error.message);

    const list = events || [];
    if (list.length === 0) {
      return { rows: [], totals: { issued: 0, refunded: 0, scanned: 0, gross: 0 } };
    }

    const eventIds = list.map((e) => e.id);
    const organizerIds = [...new Set(list.map((e) => e.organizer_id))];

    const [{ data: tickets }, { data: orders }, { data: profiles }] = await Promise.all([
      supabaseAdmin
        .from("tickets")
        .select("event_id, refunded_at, used_at, order_id")
        .in("event_id", eventIds),
      supabaseAdmin
        .from("orders")
        .select("id, event_id, total_amount, refunded_amount, channel")
        .in("event_id", eventIds)
        .not("paid_at", "is", null),
      supabaseAdmin.from("profiles").select("id, full_name, company_name").in("id", organizerIds),
    ]);

    const names = new Map(
      (profiles || []).map((p) => [p.id, p.company_name || p.full_name || "—"]),
    );
    const orderChannel = new Map((orders || []).map((o) => [o.id, o.channel || "web"]));

    const issued = new Map<string, number>();
    const refunded = new Map<string, number>();
    const scanned = new Map<string, number>();
    const web = new Map<string, number>();
    const pos = new Map<string, number>();
    for (const t of tickets || []) {
      const id = t.event_id;
      if (t.refunded_at) {
        refunded.set(id, (refunded.get(id) || 0) + 1);
        continue;
      }
      issued.set(id, (issued.get(id) || 0) + 1);
      if (t.used_at) scanned.set(id, (scanned.get(id) || 0) + 1);
      if (orderChannel.get(t.order_id) === "pos") pos.set(id, (pos.get(id) || 0) + 1);
      else web.set(id, (web.get(id) || 0) + 1);
    }

    const gross = new Map<string, number>();
    for (const o of orders || []) {
      const net = Number(o.total_amount || 0) - Number(o.refunded_amount || 0);
      gross.set(o.event_id, (gross.get(o.event_id) || 0) + net);
    }

    const rows: OrganizerTicketRow[] = list.map((e) => ({
      event_id: e.id,
      event_title: e.title,
      event_date: e.event_date,
      city: e.city,
      organizer_id: e.organizer_id,
      organizer_name: names.get(e.organizer_id) || "—",
      issued: issued.get(e.id) || 0,
      refunded: refunded.get(e.id) || 0,
      scanned: scanned.get(e.id) || 0,
      gross: round2(gross.get(e.id) || 0),
      channel_web: web.get(e.id) || 0,
      channel_pos: pos.get(e.id) || 0,
    }));

    return {
      rows,
      totals: {
        issued: rows.reduce((s, r) => s + r.issued, 0),
        refunded: rows.reduce((s, r) => s + r.refunded, 0),
        scanned: rows.reduce((s, r) => s + r.scanned, 0),
        gross: round2(rows.reduce((s, r) => s + r.gross, 0)),
      },
    };
  });

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
