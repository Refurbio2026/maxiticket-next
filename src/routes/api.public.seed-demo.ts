import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEMO = [
  { email: "admin@vstupenky.sk", password: "admin123", full_name: "Admin", role: "admin" as const },
  { email: "organizer@vstupenky.sk", password: "organizer123", full_name: "Organizer", role: "organizer" as const },
  { email: "user@vstupenky.sk", password: "user123", full_name: "User", role: "user" as const },
];

export const Route = createFileRoute("/api/public/seed-demo")({
  server: {
    handlers: {
      GET: async () => {
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
