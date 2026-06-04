// GET /api/public/events/by-token?token=...
// Resolves a scanner token to a public event summary. No auth required.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/events/by-token")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = (url.searchParams.get("token") || "").trim();
        if (!token) return Response.json({ error: "token required" }, { status: 400 });

        const { data, error } = await supabaseAdmin
          .from("events")
          .select("id, title, event_date, event_time, venue, city, image_url, scanner_token")
          .eq("scanner_token", token)
          .maybeSingle();

        if (error || !data) {
          return Response.json({ error: "not_found" }, { status: 404 });
        }
        return Response.json({ event: data });
      },
    },
  },
});
