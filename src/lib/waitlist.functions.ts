// Čakačka na vypredaný termín.
//
// Vypredané dnes znamená koniec: zákazník odíde a organizátor sa ani
// nedozvie, že by sa oplatilo pridať termín. Zápis je bez prihlásenia, takže
// je limitovaný rovnako ako zakladanie objednávky.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequest } from "@tanstack/react-start/server";

/** IP klienta spoza nginxu — `X-Forwarded-For` prvá položka sa dá podvrhnúť. */
function clientIp(): string {
  const h = getRequest()?.headers;
  const real = h?.get("x-real-ip");
  if (real) return real.trim();
  const fwd = h?.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((s) => s.trim());
    return parts[parts.length - 1] || "unknown";
  }
  return "unknown";
}

async function limituj(bucket: string, limit: number, sekundy: number, sprava: string) {
  const { data: allowed, error } = await supabaseAdmin.rpc("hit_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: sekundy,
  });
  if (error) {
    // Výpadok počítadla nesmie zastaviť zápis — limit je ochrana, nie kritická cesta.
    console.error("rate limit zlyhal", bucket, error.message);
    return;
  }
  if (allowed === false) throw new Error(sprava);
}

export const joinWaitlist = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        event_id: z.string().uuid(),
        event_date_id: z.string().uuid().optional().nullable(),
        email: z.string().email(),
        wanted: z.number().int().min(1).max(20).default(1),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true; uzZapisany: boolean }> => {
    await limituj(
      `waitlist:ip:${clientIp()}`,
      20,
      3600,
      "Príliš veľa pokusov. Skús to prosím o chvíľu.",
    );

    const { data: event } = await supabaseAdmin
      .from("events")
      .select("id, status")
      .eq("id", data.event_id)
      .maybeSingle();
    if (!event) throw new Error("Podujatie sa nenašlo");
    if (event.status !== "published") throw new Error("Podujatie nie je v predaji");

    const email = data.email.trim().toLowerCase();
    const { data: existujuci } = await supabaseAdmin
      .from("waitlist")
      .select("id")
      .eq("event_id", data.event_id)
      .eq("email", email)
      .is("notified_at", null)
      .limit(1);

    if (existujuci && existujuci.length > 0) {
      // Opakovaný zápis len upraví počet — nech sa nedá nafúknuť zoznam.
      await supabaseAdmin
        .from("waitlist")
        .update({ wanted: data.wanted })
        .eq("id", existujuci[0].id);
      return { ok: true, uzZapisany: true };
    }

    const { error } = await supabaseAdmin.from("waitlist").insert({
      event_id: data.event_id,
      event_date_id: data.event_date_id ?? null,
      email,
      wanted: data.wanted,
    });
    if (error) throw new Error(error.message);
    return { ok: true, uzZapisany: false };
  });

/** Koľko ľudí čaká — podklad pre organizátora, či pridať termín. */
export const getWaitlistSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ event_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rola } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!rola) {
      // Organizátor smie vidieť čakačku na svoje podujatie.
      const { data: event } = await supabaseAdmin
        .from("events")
        .select("organizer_id")
        .eq("id", data.event_id)
        .maybeSingle();
      if (event?.organizer_id !== context.userId) {
        throw new Error("Forbidden: cudzie podujatie");
      }
    }

    const { data: riadky } = await supabaseAdmin
      .from("waitlist")
      .select("wanted, notified_at, event_date_id")
      .eq("event_id", data.event_id)
      .limit(5000);

    const caka = (riadky || []).filter((r) => !r.notified_at);
    return {
      ludi: caka.length,
      vstupeniek: caka.reduce((s, r) => s + (r.wanted || 0), 0),
      uzUpovedomenych: (riadky || []).length - caka.length,
    };
  });
