// Platby z brány — prehľad pre administráciu.
//
// PREČO SAMOSTATNE: na platby sa dalo pozerať len cez objednávky, takže
// otázka „prišli dnes peniaze a za čo?" sa odpovedala preklikávaním. Tu je
// zoznam transakcií brány: stav, suma, referencia a odkaz na objednávku.
//
// Stav sa dá kedykoľvek dopýtať priamo u brány. Dôležité je to po refunde —
// brána ho môže zamietnuť aj dodatočne a bez dopytu by sme o tom nevedeli.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

export type PlatbaRiadok = {
  id: string;
  created_at: string;
  provider: string;
  provider_payment_id: string | null;
  amount: number;
  currency: string;
  status: string;
  order_id: string | null;
  /** Údaje objednávky, aby sa nemuselo preklikávať. */
  order_status: string | null;
  order_total: number | null;
  order_refunded: number | null;
  customer_name: string | null;
  customer_email: string | null;
  event_title: string | null;
  /** Dá sa z tohto riadku vrátiť? Rozhoduje brána aj stav objednávky. */
  refundovatelna: boolean;
};

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

export const listGatewayPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        provider: z.string().max(40).optional().nullable(),
        /** `all`, alebo konkrétny stav platby. */
        status: z.string().max(40).default("all"),
        /** Hľadá v referencii platby, e-maile a mene zákazníka. */
        hladaj: z.string().max(120).optional().nullable(),
        limit: z.number().int().positive().max(500).default(100),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<PlatbaRiadok[]> => {
    await assertAdmin(context.userId);

    let dotaz = supabaseAdmin
      .from("payments")
      .select("id, created_at, provider, provider_payment_id, amount, currency, status, order_id")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    // Hodnoty prichádzajú z výberu v admine; typy stĺpcov sú úzke enumy,
    // preto `as never` — kontrolu robí databáza, nie prehliadač.
    if (data.provider) dotaz = dotaz.eq("provider", data.provider as never);
    if (data.status && data.status !== "all") dotaz = dotaz.eq("status", data.status as never);
    if (data.hladaj?.trim()) dotaz = dotaz.ilike("provider_payment_id", `%${data.hladaj.trim()}%`);

    const { data: platby, error } = await dotaz;
    if (error) throw new Error(error.message);

    const idObjednavok = [...new Set((platby ?? []).map((p) => p.order_id).filter(Boolean))];
    const objednavky = idObjednavok.length
      ? ((
          await supabaseAdmin
            .from("orders")
            .select(
              "id, status, total_amount, refunded_amount, customer_name, customer_email, event_id",
            )
            .in("id", idObjednavok as string[])
        ).data ?? [])
      : [];
    const idPodujati = [...new Set(objednavky.map((o) => o.event_id).filter(Boolean))];
    const podujatia = idPodujati.length
      ? ((
          await supabaseAdmin
            .from("events")
            .select("id, title")
            .in("id", idPodujati as string[])
        ).data ?? [])
      : [];

    // Ktoré brány vedia vrátiť peniaze cez API — bez toho by tlačidlo
    // sľubovalo niečo, čo skončí hláškou „sprav to v portáli".
    const { vsetkyBrany, pripravPristupy } = await import("./payment-gateways/index.server");
    await pripravPristupy();
    const vieRefundovat = new Map(vsetkyBrany().map((b) => [b.id as string, b.supportsRefund]));

    return (platby ?? []).map((p) => {
      const o = objednavky.find((x) => x.id === p.order_id);
      const e = podujatia.find((x) => x.id === o?.event_id);
      const suma = Number(p.amount);
      const vratene = Number(o?.refunded_amount ?? 0);
      return {
        id: p.id,
        created_at: p.created_at,
        provider: p.provider,
        provider_payment_id: p.provider_payment_id,
        amount: suma,
        currency: p.currency ?? "EUR",
        status: p.status,
        order_id: p.order_id,
        order_status: o?.status ?? null,
        order_total: o ? Number(o.total_amount) : null,
        order_refunded: o ? vratene : null,
        customer_name: o?.customer_name ?? null,
        customer_email: o?.customer_email ?? null,
        event_title: e?.title ?? null,
        refundovatelna:
          suma > 0 &&
          !!p.order_id &&
          o?.status === "paid" &&
          vratene + 0.01 < Number(o?.total_amount ?? 0) &&
          (vieRefundovat.get(p.provider) ?? false),
      };
    });
  });

export type StavPlatby = {
  ok: boolean;
  /** Stav podľa brány; `null` keď sa brána na stav pýtať nedá. */
  stav: string | null;
  sprava: string;
};

/**
 * Dopyt stavu priamo u brány.
 *
 * Odpoveď sa zapisuje do `payment_logs`, takže sa dá spätne doložiť, čo
 * brána povedala a kedy — pri spore o vrátenie peňazí je to jediný dôkaz.
 */
export const refreshPaymentState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ payment_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<StavPlatby> => {
    await assertAdmin(context.userId);

    const { data: platba } = await supabaseAdmin
      .from("payments")
      .select("id, provider, provider_payment_id, order_id, status")
      .eq("id", data.payment_id)
      .maybeSingle();
    if (!platba?.provider_payment_id) {
      return { ok: false, stav: null, sprava: "Platba nemá referenciu brány." };
    }

    const { branaPodlaId, pripravPristupy } = await import("./payment-gateways/index.server");
    await pripravPristupy();

    let brana;
    try {
      brana = branaPodlaId(platba.provider);
    } catch {
      return { ok: false, stav: null, sprava: `Brána ${platba.provider} už v aplikácii nie je.` };
    }

    try {
      const stav = await brana.getStatus(platba.provider_payment_id);
      await supabaseAdmin.from("payment_logs").insert({
        order_id: platba.order_id,
        provider: platba.provider,
        endpoint: `status:${platba.provider_payment_id}`,
        response_payload: (stav?.raw ?? null) as Json,
        status: "ok",
      });
      if (!stav) {
        return {
          ok: true,
          stav: null,
          sprava: `${brana.label} na stav platby odpovedať nevie — zisťuje sa len z návratu zákazníka.`,
        };
      }

      // Stav brány je zdroj pravdy; náš záznam sa mu prispôsobí.
      if (stav.state !== platba.status) {
        await supabaseAdmin
          .from("payments")
          .update({ status: stav.state, updated_at: new Date().toISOString() })
          .eq("id", platba.id);
      }
      return {
        ok: true,
        stav: stav.state,
        sprava:
          stav.state === platba.status
            ? `Brána potvrdila stav „${stav.state}".`
            : `Stav sa zmenil: ${platba.status} → ${stav.state}.`,
      };
    } catch (e) {
      const sprava = e instanceof Error ? e.message : "Dopyt zlyhal.";
      await supabaseAdmin.from("payment_logs").insert({
        order_id: platba.order_id,
        provider: platba.provider,
        endpoint: `status:${platba.provider_payment_id}`,
        status: "error",
        error_message: sprava,
      });
      return { ok: false, stav: null, sprava };
    }
  });
