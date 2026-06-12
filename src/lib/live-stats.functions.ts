import { createServerFn } from "@tanstack/react-start";

export const getLiveBuyersCount = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  // Distinct users with pending/paid orders in the last 15 minutes
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("user_id, created_at")
    .gte("created_at", since);

  if (error) return { count: 0 };
  const unique = new Set((data ?? []).map((o) => o.user_id).filter(Boolean));
  return { count: unique.size };
});
