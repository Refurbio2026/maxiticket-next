// Refund objednávky z administrácie. Samotné vrátenie peňazí žije
// v refunds.server.ts, aby ho vedelo použiť aj hromadné zrušenie podujatia.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { vratPeniaze, type RefundOrderResult } from "./refunds.server";

export type { RefundOrderResult } from "./refunds.server";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

export const refundOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        order_id: z.string().uuid(),
        amount: z.number().positive().optional(),
        reason: z.string().max(500).optional().nullable(),
        notify_customer: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<RefundOrderResult> => {
    await assertAdmin(context.userId);
    return vratPeniaze({
      order_id: data.order_id,
      amount: data.amount,
      reason: data.reason,
      notifyCustomer: data.notify_customer,
      userId: context.userId,
    });
  });
