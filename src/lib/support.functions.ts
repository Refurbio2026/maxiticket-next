import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { askSupportBot, type BotResult } from "./support-bot.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ipBucket } from "./client-ip.server";

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
    const kluceIp = ipBucket("support:ip:");
    const { data: allowed, error } = await supabaseAdmin.rpc("hit_rate_limit", {
      // Bez použiteľnej adresy spoločný, voľnejší strop — pozri `ipBucket`.
      p_bucket: kluceIp ?? "support:spolocne",
      p_limit: kluceIp ? 30 : 300,
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
          "Priveľa správ za krátky čas. Skús to prosím o chvíľu, alebo napíš na support@eticketo.eu.",
      };
    }
    return askSupportBot(data.messages, data.lang || "sk");
  });
