import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { askSupportBot, type BotResult } from "./support-bot.server";

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
    return askSupportBot(data.messages, data.lang || "sk");
  });
