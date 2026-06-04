// GET /api/public/tickets/stats?event_id=...
// Returns sold / used / remaining + last 20 scans.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/tickets/stats")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const eventId = url.searchParams.get("event_id");
        if (!eventId) return Response.json({ error: "event_id required" }, { status: 400 });

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
          sold: sold || 0,
          used: used || 0,
          remaining: Math.max(0, (sold || 0) - (used || 0)),
          recent: scansRes.data || [],
        });
      },
    },
  },
});
