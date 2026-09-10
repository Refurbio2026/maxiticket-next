// GET /api/public/tickets/stats?event_token=...
//
// Vráti predané / použité / zostávajúce vstupenky a posledných 20 skenov.
//
// BEZPEČNOSŤ: autorizuje výlučne znalosť `scanner_token` podujatia, rovnako
// ako samotné skenovanie. Holé `event_id` sa zámerne neprijíma — id podujatí
// sú verejné, takže by čísla predaja aj mená čítačiek čítal ktokoľvek.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/tickets/stats")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("event_token");
        if (!token) return Response.json({ error: "event_token required" }, { status: 400 });

        const { data } = await supabaseAdmin
          .from("events")
          .select("id")
          .eq("scanner_token", token)
          .maybeSingle();
        const eventId = data?.id || null;
        // Neplatný kód nesmie prezradiť, či také podujatie existuje.
        if (!eventId) return Response.json({ error: "Not found" }, { status: 404 });

        const [{ count: sold }, { count: used }, scansRes] = await Promise.all([
          supabaseAdmin
            .from("tickets")
            .select("id", { count: "exact", head: true })
            .eq("event_id", eventId),
          supabaseAdmin
            .from("tickets")
            .select("id", { count: "exact", head: true })
            .eq("event_id", eventId)
            .not("used_at", "is", null),
          supabaseAdmin
            .from("ticket_scans")
            .select("id, created_at, result, scanner_name, ticket_id")
            .eq("event_id", eventId)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);

        return Response.json({
          event_id: eventId,
          sold: sold || 0,
          used: used || 0,
          remaining: Math.max(0, (sold || 0) - (used || 0)),
          recent: scansRes.data || [],
        });
      },
    },
  },
});
