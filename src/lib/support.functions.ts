import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { askSupportBot, type BotResult } from "./support-bot.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** IP spoza nginxu — `X-Real-IP` prepisuje nginx, takže sa nedá podvrhnúť. */
function clientIp(): string {
  try {
    const h = getRequest()?.headers;
    const real = h?.get("x-real-ip");
    if (real) return real.trim();
    const fwd = h?.get("x-forwarded-for");
    if (fwd) return fwd.split(",").pop()!.trim();
  } catch {
    /* mimo requestu */
  }
  return "unknown";
}

// Server function backing the support chat widget. Basic abuse guards: bounded
// message length and history size. The AI call itself lives in the .server.ts
// module so the API key never reaches the client bundle.
export const askSupport = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        lang: z.string().max(5).optional(),
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().min(1).max(2000),
            }),
          )
          .min(1)
          .max(20),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<BotResult> => {
    // Endpoint je verejný a každé volanie stojí kredit u poskytovateľa AI.
    // Bez stropu vie ktokoľvek minúť účet, preto limit 30 správ za hodinu na IP.
    const { data: allowed, error } = await supabaseAdmin.rpc("hit_rate_limit", {
      p_bucket: `support:ip:${clientIp()}`,
      p_limit: 30,
      p_window_seconds: 3600,
    });
    if (error) {
      // Výpadok počítadla nesmie zhodiť podporu — radšej pustíme.
      console.error("rate limit podpory zlyhal", error.message);
    } else if (allowed === false) {
      return {
        ok: false,
        reason: "error",
        message:
          "Priveľa správ za krátky čas. Skús to prosím o chvíľu, alebo napíš na support@vipky.sk.",
      };
    }
    return askSupportBot(data.messages, data.lang || "sk");
  });
