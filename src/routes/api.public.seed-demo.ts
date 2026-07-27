import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEMO = [
  { email: "admin@vipky.sk", password: "admin123", full_name: "Admin", role: "admin" as const },
  { email: "organizer@vipky.sk", password: "organizer123", full_name: "Organizer", role: "organizer" as const },
  { email: "user@vipky.sk", password: "user123", full_name: "User", role: "user" as const },
];

export const Route = createFileRoute("/api/public/seed-demo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // SECURITY: this endpoint creates real admin/organizer accounts, so it
        // must never be openly reachable. It is inert unless a SEED_SECRET is
        // configured AND the caller presents it (?key=… or x-seed-secret header).
        const secret = process.env.SEED_SECRET;
        const url = new URL(request.url);
        const provided = url.searchParams.get("key") || request.headers.get("x-seed-secret");
        if (!secret || provided !== secret) {
          return new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        const results: Record<string, string> = {};
        for (const d of DEMO) {
          const { data: list } = await supabaseAdmin.auth.admin.listUsers();
          let user = list.users.find((u) => u.email === d.email);
          if (!user) {
            const { data, error } = await supabaseAdmin.auth.admin.createUser({
              email: d.email,
              password: d.password,
              email_confirm: true,
              user_metadata: { full_name: d.full_name },
            });
            if (error) {
              results[d.email] = "error: " + error.message;
              continue;
            }
            user = data.user;
          }
          if (user) {
            await supabaseAdmin
              .from("user_roles")
              .upsert({ user_id: user.id, role: d.role }, { onConflict: "user_id,role" });
            results[d.email] = "ok";
          }
        }
        return new Response(JSON.stringify({ results }, null, 2), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
