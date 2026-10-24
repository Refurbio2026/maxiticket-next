// Serverová funkcia za bublinou asistenta na webe.
//
// Endpoint je verejný, preto sú tu dve poistky: obmedzená dĺžka správ
// a strop na počet otázok z jednej adresy. Samotné volanie modelu je
// v `asistent/klient.server.ts`, aby sa kľúč nedostal do balíka pre
// prehliadač.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { odpovedz, type BotResult } from "./asistent/klient.server";
import { kontextStranky } from "./asistent/znalosti.server";
import type { Jazyk } from "./asistent/temy";
import { pripravPristupy } from "./pristupy.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ipBucket } from "./client-ip.server";
import { PREVADZKOVATEL } from "@/lib/kontakt";

const JAZYKY = ["sk", "en", "de", "hu"] as const;

export const askSupport = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        lang: z.string().max(5).optional(),
        /** Cesta, ktorú má návštevník otvorenú — nie celá adresa. */
        cesta: z.string().max(200).optional(),
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
    // Každé volanie stojí kredit u poskytovateľa modelu. Bez stropu vie
    // ktokoľvek minúť účet, preto limit 30 správ za hodinu na adresu.
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
        message: `Priveľa správ za krátky čas. Skús to prosím o chvíľu, alebo napíš na ${PREVADZKOVATEL.email}.`,
      };
    }

    // Kľúč k modelu je uložený v administrácii; bez tohto by sa čítalo
    // len z premenných prostredia a asistent by vyzeral ako nenastavený.
    await pripravPristupy();

    const jazyk = (JAZYKY as readonly string[]).includes(data.lang ?? "")
      ? (data.lang as Jazyk)
      : "sk";
    const kontext = await kontextStranky(data.cesta).catch(() => null);

    return odpovedz(data.messages, jazyk, kontext);
  });
