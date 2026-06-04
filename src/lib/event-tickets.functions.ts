// Server function: fetch sold tickets for an event (admin / organizer only).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SoldTicketRow = {
  id: string;
  seat_label: string;
  qr_code: string;
  qr_token: string | null;
  order_id: string;
  used_at: string | null;
  customer_name: string | null;
  customer_email: string | null;
};

export type EventTicketsResult = {
  event: {
    id: string;
    title: string;
    event_date: string;
    event_time: string;
    venue: string;
    city: string;
  } | null;
  tickets: SoldTicketRow[];
};

export const getEventSoldTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { event_id?: string; title?: string; event_date?: string }) => input)
  .handler(async ({ data, context }): Promise<EventTicketsResult> => {
    const { supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Resolve event
    let event: any = null;
    if (data.event_id) {
      const { data: ev } = await supabase
        .from("events")
        .select("id, title, event_date, event_time, venue, city")
        .eq("id", data.event_id)
        .maybeSingle();
      event = ev;
    } else if (data.title) {
      let q = supabase
        .from("events")
        .select("id, title, event_date, event_time, venue, city")
        .ilike("title", data.title.trim());
      if (data.event_date) q = q.eq("event_date", data.event_date);
      const { data: ev } = await q.maybeSingle();
      event = ev;
    }

    if (!event) return { event: null, tickets: [] };

    // Use admin client to also join order info regardless of RLS scope
    const { data: tickets } = await supabaseAdmin
      .from("tickets")
      .select("id, seat_label, qr_code, qr_token, order_id, used_at, orders ( customer_name, customer_email )")
      .eq("event_id", event.id)
      .order("issued_at", { ascending: true });

    const rows: SoldTicketRow[] = (tickets || []).map((t: any) => ({
      id: t.id,
      seat_label: t.seat_label,
      qr_code: t.qr_code,
      qr_token: t.qr_token,
      order_id: t.order_id,
      used_at: t.used_at,
      customer_name: t.orders?.customer_name ?? null,
      customer_email: t.orders?.customer_email ?? null,
    }));

    return { event, tickets: rows };
  });
