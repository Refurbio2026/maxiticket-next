import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Returns the signed-in user's paid tickets, matched by the email on their
// verified token (never by client-supplied input). Replaces the old
// localStorage-only "Moje vstupenky" list so a real GoPay purchase actually
// shows up in the account.
export const getMyTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Prefer the email claim on the token; fall back to the auth admin lookup.
    let email = (context.claims as { email?: string } | undefined)?.email;
    if (!email) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(context.userId);
      email = data.user?.email ?? undefined;
    }
    if (!email) return { rows: [] };

    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("id, customer_email, event_id, status, paid_at")
      .eq("status", "paid")
      .ilike("customer_email", email);

    const orderIds = (orders ?? []).map((o) => o.id);
    if (orderIds.length === 0) return { rows: [] };

    const eventIds = Array.from(new Set((orders ?? []).map((o) => o.event_id)));
    const [{ data: tickets }, { data: events }] = await Promise.all([
      supabaseAdmin
        .from("tickets")
        .select("id, order_id, event_id, seat_label, qr_code, issued_at")
        .in("order_id", orderIds),
      supabaseAdmin
        .from("events")
        .select("id, title, event_date, event_time, venue, city")
        .in("id", eventIds),
    ]);

    const eventById = new Map((events ?? []).map((e) => [e.id, e]));
    const orderById = new Map((orders ?? []).map((o) => [o.id, o]));

    const rows = (tickets ?? [])
      .map((t) => ({
        ticket: {
          id: t.id,
          order_id: t.order_id,
          event_id: t.event_id,
          seat_label: t.seat_label,
          qr_code: t.qr_code,
          issued_at: t.issued_at,
        },
        event: eventById.get(t.event_id) ?? null,
        customer_email: orderById.get(t.order_id)?.customer_email ?? null,
      }))
      .sort((a, b) => (b.ticket.issued_at ?? "").localeCompare(a.ticket.issued_at ?? ""));

    return { rows };
  });
