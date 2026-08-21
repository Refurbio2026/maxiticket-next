// POST /api/public/tickets/scan
// Body: { token: string, event_id: string, scanner_user_id?: string, scanner_name?: string,
//         device_id?: string, allow_reentry?: boolean }
// Returns ticket info + result: valid | duplicate | invalid | reentry
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyTicket } from "@/lib/qr-token.server";
import { loadEventInfo } from "@/lib/event-info.server";

type ScanResult = "valid" | "duplicate" | "invalid" | "reentry" | "refunded";

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
    await supabaseAdmin.from("ticket_scans").insert(payload);
  } catch (e) {
    console.error("scan log fail", e);
  }
}

export const Route = createFileRoute("/api/public/tickets/scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ua = request.headers.get("user-agent") || "";
        // Telo prichádza zvonku — čítame ho ako neznáme a každé pole si
        // prevedieme sami.
        let body: Record<string, unknown> = {};
        try {
          body = await request.json();
        } catch {
          /* Pokazené JSON telo necháme prejsť ako prázdne — o pár riadkov nižšie ho
           odmietne kontrola tokenu s poriadnou hláškou. */
        }
        const token = String(body?.token || "").trim();
        const eventToken = body?.event_token ? String(body.event_token).trim() : null;
        const scannedBy = body?.scanner_user_id ? String(body.scanner_user_id) : null;
        const scannerName = body?.scanner_name ? String(body.scanner_name) : null;
        const deviceId = body?.device_id ? String(body.device_id) : null;
        const allowReentry = Boolean(body?.allow_reentry);

        // Zariadenie si poznačíme, že žije. Beží to na pozadí — keby sa zápis
        // nepodaril, sken sa tým nesmie zdržať ani zhodiť.
        if (deviceId) {
          void supabaseAdmin
            .rpc("touch_scanner_device", { p_device_id: deviceId })
            .then(({ error }) => {
              if (error) console.error("touch_scanner_device zlyhalo", error.message);
            });
        }

        // SECURITY: scanning is authorized ONLY by knowledge of the event's
        // scanner_token (the shared scanner secret). We never trust a raw
        // event_id from the body — otherwise anyone could mark tickets used.
        if (!eventToken) {
          return Response.json(
            { ok: false, result: "invalid" as const, message: "Chýba skenovací kód podujatia." },
            { status: 200 },
          );
        }
        const { data: ev } = await supabaseAdmin
          .from("events")
          .select("id")
          .eq("scanner_token", eventToken)
          .maybeSingle();
        const eventId: string | null = ev?.id || null;
        if (!eventId) {
          return Response.json(
            { ok: false, result: "invalid" as const, message: "Neplatný kód podujatia" },
            { status: 200 },
          );
        }

        // Accept legacy plaintext qr_code too (fallback)
        const ticketId = verifyTicket(token);
        const query = supabaseAdmin
          .from("tickets")
          .select(
            "id, event_id, event_date_id, order_id, seat_label, seat_id, qr_code, qr_token, scan_count, last_scan_at, used_at, refunded_at, allow_reentry, scanned_by, issued_at",
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
          return Response.json({
            ok: false,
            result: "invalid" as const,
            message: "Neplatná vstupenka",
          });
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

        // Refundovaná vstupenka neplatí, aj keď nikdy nebola použitá.
        // Kontrola musí byť pred logikou prvého použitia, inak by sa označila
        // za platnú a pustila by kupujúceho dnu.
        if (ticket.refunded_at) {
          await logScan({
            ticket_id: ticket.id,
            event_id: ticket.event_id,
            qr_token: token,
            result: "refunded",
            scanned_by: scannedBy,
            scanner_name: scannerName,
            user_agent: ua,
          });
          return Response.json({
            ok: false,
            result: "refunded" as const,
            message: "Vstupenka bola refundovaná — neplatí.",
          });
        }

        // Load context (order + event)
        const [orderRes, eventInfo] = await Promise.all([
          supabaseAdmin
            .from("orders")
            .select("id, customer_name, customer_email, total_amount, paid_at, created_at")
            .eq("id", ticket.order_id)
            .maybeSingle(),
          // Skener musí ukázať termín tej vstupenky, nie najbližší termín
          // podujatia — inak sa pri repríze nedá odlíšiť včerajší lístok.
          loadEventInfo(ticket.event_id, ticket.event_date_id),
        ]);

        const canReentry = allowReentry || ticket.allow_reentry;
        const now = new Date().toISOString();

        let result: ScanResult;
        if (!ticket.used_at) {
          // Atomic first-use: only the row whose used_at is STILL null gets
          // updated. If two scanners race the same ticket, exactly one wins.
          const { data: claimed } = await supabaseAdmin
            .from("tickets")
            .update({
              used_at: now,
              scan_count: (ticket.scan_count || 0) + 1,
              last_scan_at: now,
              scanned_by: scannedBy,
            })
            .eq("id", ticket.id)
            .is("used_at", null)
            .select("id");
          if (claimed && claimed.length > 0) {
            result = "valid";
          } else {
            // Lost the race — ticket was used a moment ago on another device.
            result = canReentry ? "reentry" : "duplicate";
            if (result === "reentry") {
              await supabaseAdmin
                .from("tickets")
                .update({
                  scan_count: (ticket.scan_count || 0) + 1,
                  last_scan_at: now,
                  scanned_by: scannedBy,
                })
                .eq("id", ticket.id);
            }
          }
        } else if (canReentry) {
          result = "reentry";
          await supabaseAdmin
            .from("tickets")
            .update({
              scan_count: (ticket.scan_count || 0) + 1,
              last_scan_at: now,
              scanned_by: scannedBy,
            })
            .eq("id", ticket.id);
        } else {
          result = "duplicate";
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
          event: eventInfo ? { id: ticket.event_id, ...eventInfo } : null,
        });
      },
    },
  },
});
