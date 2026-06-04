// POST /api/public/tickets/scan
// Body: { token: string, event_id: string, scanner_user_id?: string, scanner_name?: string, allow_reentry?: boolean }
// Returns ticket info + result: valid | duplicate | invalid | reentry
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyTicket } from "@/lib/qr-token.server";

type ScanResult = "valid" | "duplicate" | "invalid" | "reentry";

async function logScan(payload: {
  ticket_id: string | null;
  event_id: string | null;
  qr_token: string;
  result: ScanResult;
  scanned_by?: string | null;
  scanner_name?: string | null;
  user_agent?: string | null;
}) {
  try {
    await supabaseAdmin.from("ticket_scans").insert(payload as any);
  } catch (e) {
    console.error("scan log fail", e);
  }
}

export const Route = createFileRoute("/api/public/tickets/scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ua = request.headers.get("user-agent") || "";
        let body: any = {};
        try {
          body = await request.json();
        } catch {}
        const token = String(body?.token || "").trim();
        let eventId: string | null = body?.event_id ? String(body.event_id).trim() : null;
        const eventToken = body?.event_token ? String(body.event_token).trim() : null;
        const scannedBy = body?.scanner_user_id ? String(body.scanner_user_id) : null;
        const scannerName = body?.scanner_name ? String(body.scanner_name) : null;
        const allowReentry = Boolean(body?.allow_reentry);

        // Resolve event by public scanner token (no auth required)
        if (!eventId && eventToken) {
          const { data: ev } = await supabaseAdmin
            .from("events")
            .select("id")
            .eq("scanner_token", eventToken)
            .maybeSingle();
          eventId = (ev as any)?.id || null;
          if (!eventId) {
            return Response.json(
              { ok: false, result: "invalid" as const, message: "Neplatný kód podujatia" },
              { status: 200 },
            );
          }
        }

        // Accept legacy plaintext qr_code too (fallback)
        let ticketId = verifyTicket(token);
        let query = supabaseAdmin.from("tickets").select(
          "id, event_id, order_id, seat_label, seat_id, qr_code, qr_token, scan_count, last_scan_at, used_at, allow_reentry, scanned_by, issued_at",
        );
        const { data: ticket } = ticketId
          ? await query.eq("id", ticketId).maybeSingle()
          : await query.eq("qr_code", token).maybeSingle();

        if (!ticket) {
          await logScan({
            ticket_id: null,
            event_id: eventId,
            qr_token: token.slice(0, 200),
            result: "invalid",
            scanned_by: scannedBy,
            scanner_name: scannerName,
            user_agent: ua,
          });
          return Response.json({ ok: false, result: "invalid" as const, message: "Neplatná vstupenka" });
        }

        if (eventId && ticket.event_id !== eventId) {
          await logScan({
            ticket_id: ticket.id,
            event_id: ticket.event_id,
            qr_token: token,
            result: "invalid",
            scanned_by: scannedBy,
            scanner_name: scannerName,
            user_agent: ua,
          });
          return Response.json({
            ok: false,
            result: "invalid" as const,
            message: "Vstupenka patrí inému podujatiu",
          });
        }

        // Load context (order + event)
        const [orderRes, eventRes] = await Promise.all([
          supabaseAdmin
            .from("orders")
            .select("id, customer_name, customer_email, total_amount, paid_at, created_at")
            .eq("id", ticket.order_id)
            .maybeSingle(),
          supabaseAdmin
            .from("events")
            .select("id, title, event_date, event_time, venue, city")
            .eq("id", ticket.event_id)
            .maybeSingle(),
        ]);

        const alreadyUsed = Boolean(ticket.used_at);
        const canReentry = allowReentry || ticket.allow_reentry;

        let result: ScanResult;
        if (!alreadyUsed) result = "valid";
        else if (canReentry) result = "reentry";
        else result = "duplicate";

        if (result === "valid") {
          await supabaseAdmin
            .from("tickets")
            .update({
              used_at: new Date().toISOString(),
              scan_count: (ticket.scan_count || 0) + 1,
              last_scan_at: new Date().toISOString(),
              scanned_by: scannedBy,
            })
            .eq("id", ticket.id);
        } else if (result === "reentry") {
          await supabaseAdmin
            .from("tickets")
            .update({
              scan_count: (ticket.scan_count || 0) + 1,
              last_scan_at: new Date().toISOString(),
              scanned_by: scannedBy,
            })
            .eq("id", ticket.id);
        }

        await logScan({
          ticket_id: ticket.id,
          event_id: ticket.event_id,
          qr_token: token,
          result,
          scanned_by: scannedBy,
          scanner_name: scannerName,
          user_agent: ua,
        });

        return Response.json({
          ok: result !== "duplicate",
          result,
          ticket: {
            id: ticket.id,
            seat_label: ticket.seat_label,
            issued_at: ticket.issued_at,
            used_at: ticket.used_at,
            scan_count: ticket.scan_count,
            last_scan_at: ticket.last_scan_at,
          },
          order: orderRes.data,
          event: eventRes.data,
        });
      },
    },
  },
});
