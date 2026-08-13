// Zľavové kupóny — správa v admine a overenie pri nákupe.
// Drž tento súbor tenký: samotné uplatnenie je v `coupons.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkCoupon, couponErrorMessage } from "./coupons.server";

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

export type CouponRecord = {
  id: string;
  code: string;
  organizer_id: string | null;
  organizer_name: string | null;
  event_id: string | null;
  event_title: string | null;
  discount_type: "percent" | "amount";
  discount_value: number;
  max_uses: number | null;
  max_uses_per_email: number | null;
  used_count: number;
  min_order_amount: number;
  valid_from: string | null;
  valid_until: string | null;
  status: "active" | "paused";
  note: string | null;
  created_at: string;
  /** Koľko peňazí kupón doteraz rozdal. */
  discount_total: number;
};

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

/** Kupóny vidí admin všetky, organizátor len svoje. */
export const listCoupons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CouponRecord[]> => {
    const admin = await isAdmin(context.userId);

    let q = supabaseAdmin
      .from("coupons")
      .select(
        "id, code, organizer_id, event_id, discount_type, discount_value, max_uses, max_uses_per_email, used_count, min_order_amount, valid_from, valid_until, status, note, created_at",
      )
      .order("created_at", { ascending: false });
    if (!admin) q = q.eq("organizer_id", context.userId);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = rows || [];
    if (list.length === 0) return [];

    const eventIds = [...new Set(list.map((c) => c.event_id).filter(Boolean))] as string[];
    const organizerIds = [...new Set(list.map((c) => c.organizer_id).filter(Boolean))] as string[];

    const [{ data: events }, { data: profiles }, { data: redemptions }] = await Promise.all([
      eventIds.length
        ? supabaseAdmin.from("events").select("id, title").in("id", eventIds)
        : Promise.resolve({ data: [] as { id: string; title: string }[] }),
      organizerIds.length
        // `profiles` nemá e-mail — ten žije v `auth.users`. Meno stačí.
        ? supabaseAdmin.from("profiles").select("id, full_name").in("id", organizerIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      supabaseAdmin
        .from("coupon_redemptions")
        .select("coupon_id, discount_amount")
        .in(
          "coupon_id",
          list.map((c) => c.id),
        ),
    ]);

    const eventTitle = new Map((events || []).map((e) => [e.id, e.title]));
    const organizerName = new Map(
      (profiles || []).map((p) => [p.id, p.full_name || "—"]),
    );
    const discountTotal = new Map<string, number>();
    for (const r of redemptions || []) {
      const key = r.coupon_id as string;
      discountTotal.set(key, (discountTotal.get(key) || 0) + Number(r.discount_amount || 0));
    }

    return list.map((c) => ({
      id: c.id,
      code: c.code,
      organizer_id: c.organizer_id,
      organizer_name: c.organizer_id ? (organizerName.get(c.organizer_id) ?? null) : null,
      event_id: c.event_id,
      event_title: c.event_id ? (eventTitle.get(c.event_id) ?? null) : null,
      discount_type: c.discount_type === "amount" ? "amount" : "percent",
      discount_value: Number(c.discount_value),
      max_uses: c.max_uses,
      max_uses_per_email: c.max_uses_per_email,
      used_count: c.used_count,
      min_order_amount: Number(c.min_order_amount || 0),
      valid_from: c.valid_from,
      valid_until: c.valid_until,
      status: c.status === "paused" ? "paused" : "active",
      note: c.note,
      created_at: c.created_at,
      discount_total: Math.round((discountTotal.get(c.id) || 0) * 100) / 100,
    }));
  });

const CouponInput = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Kód smie mať len písmená, číslice, pomlčku a podčiarkovník"),
  event_id: z.string().uuid().optional().nullable(),
  discount_type: z.enum(["percent", "amount"]).default("percent"),
  discount_value: z.number().positive(),
  max_uses: z.number().int().nonnegative().optional().nullable(),
  max_uses_per_email: z.number().int().nonnegative().optional().nullable(),
  min_order_amount: z.number().nonnegative().default(0),
  valid_from: z.string().optional().nullable(),
  valid_until: z.string().optional().nullable(),
  status: z.enum(["active", "paused"]).default("active"),
  note: z.string().max(2000).optional().nullable(),
  /** Len admin: kupón na cudzieho organizátora, prípadne `null` = celoplatformový. */
  organizer_id: z.string().uuid().optional().nullable(),
});

export type CouponInputData = z.input<typeof CouponInput>;

export const upsertCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CouponInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const admin = await isAdmin(context.userId);

    if (data.discount_type === "percent" && data.discount_value > 100) {
      throw new Error("Percentuálna zľava nemôže byť viac ako 100 %.");
    }

    // Vlastníka neberieme z klienta — organizátor si vie založiť kupón len na
    // seba. Celoplatformový kupón (`organizer_id = null`) smie dať iba admin.
    const organizerId = admin ? (data.organizer_id ?? null) : context.userId;

    // Podujatie musí patriť tomu, kto kupón zakladá.
    if (data.event_id) {
      const { data: event } = await supabaseAdmin
        .from("events")
        .select("id, organizer_id")
        .eq("id", data.event_id)
        .maybeSingle();
      if (!event) throw new Error("Podujatie sa nenašlo");
      if (!admin && event.organizer_id !== context.userId) {
        throw new Error("Forbidden: podujatie patrí inému organizátorovi");
      }
    }

    const row = {
      code: data.code.trim().toUpperCase(),
      organizer_id: organizerId,
      event_id: data.event_id || null,
      discount_type: data.discount_type,
      discount_value: data.discount_value,
      max_uses: data.max_uses ? data.max_uses : null,
      max_uses_per_email: data.max_uses_per_email ? data.max_uses_per_email : null,
      min_order_amount: data.min_order_amount,
      valid_from: data.valid_from || null,
      valid_until: data.valid_until || null,
      status: data.status,
      note: data.note || null,
    };

    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("coupons")
        .select("id, organizer_id")
        .eq("id", data.id)
        .maybeSingle();
      if (!existing) throw new Error("Kupón sa nenašiel");
      if (!admin && existing.organizer_id !== context.userId) {
        throw new Error("Forbidden: kupón patrí inému organizátorovi");
      }
      const { error } = await supabaseAdmin.from("coupons").update(row).eq("id", data.id);
      if (error) throw new Error(friendly(error.message));
      return { id: data.id };
    }

    const { data: created, error } = await supabaseAdmin
      .from("coupons")
      .insert({ ...row, created_by: context.userId })
      .select("id")
      .single();
    if (error || !created)
      throw new Error(friendly(error?.message || "Kupón sa nepodarilo uložiť"));
    return { id: created.id };
  });

function friendly(message: string): string {
  if (message.includes("coupons_code_unique")) return "Takýto kód už existuje.";
  return message;
}

/** Použitý kupón sa nemaže — namiesto toho ho pozastav, nech ostane história. */
export const deleteCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: coupon } = await supabaseAdmin
      .from("coupons")
      .select("id, organizer_id, used_count")
      .eq("id", data.id)
      .maybeSingle();
    if (!coupon) throw new Error("Kupón sa nenašiel");
    if (coupon.organizer_id !== context.userId && !(await isAdmin(context.userId))) {
      throw new Error("Forbidden: kupón patrí inému organizátorovi");
    }
    if (coupon.used_count > 0) {
      throw new Error(
        "Tento kupón už niekto použil. Namiesto zmazania ho pozastav — inak zmizne z histórie objednávok.",
      );
    }
    const { error } = await supabaseAdmin.from("coupons").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type CouponRedemptionRecord = {
  id: string;
  created_at: string;
  email: string | null;
  discount_amount: number;
  order_id: string | null;
  order_total: number | null;
  order_status: string | null;
};

/** Kto a kedy kupón použil. */
export const listCouponRedemptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ coupon_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CouponRedemptionRecord[]> => {
    const { data: coupon } = await supabaseAdmin
      .from("coupons")
      .select("id, organizer_id")
      .eq("id", data.coupon_id)
      .maybeSingle();
    if (!coupon) return [];
    if (coupon.organizer_id !== context.userId && !(await isAdmin(context.userId))) {
      throw new Error("Forbidden: kupón patrí inému organizátorovi");
    }

    const { data: rows } = await supabaseAdmin
      .from("coupon_redemptions")
      .select("id, created_at, email, discount_amount, order_id")
      .eq("coupon_id", data.coupon_id)
      .order("created_at", { ascending: false })
      .limit(500);
    const list = rows || [];
    const orderIds = list.map((r) => r.order_id).filter(Boolean) as string[];

    const { data: orders } = orderIds.length
      ? await supabaseAdmin.from("orders").select("id, total_amount, status").in("id", orderIds)
      : { data: [] as { id: string; total_amount: number; status: string }[] };
    const orderById = new Map((orders || []).map((o) => [o.id, o]));

    return list.map((r) => {
      const o = r.order_id ? orderById.get(r.order_id) : undefined;
      return {
        id: r.id,
        created_at: r.created_at,
        email: r.email,
        discount_amount: Number(r.discount_amount || 0),
        order_id: r.order_id,
        order_total: o ? Number(o.total_amount) : null,
        order_status: o?.status ?? null,
      };
    });
  });

export type CouponPreview = {
  ok: boolean;
  code: string;
  discount: number;
  /**
   * Typ a hodnota zľavy, aby si pokladňa vedela prepočítať sumu pri zmene
   * košíka bez ďalšieho dotazu na server. Záväzný je vždy až server.
   */
  discount_type?: "percent" | "amount";
  discount_value?: number;
  message?: string;
};

/**
 * Náhľad zľavy pre pokladňu a checkout — počítadlo sa NEZVYŠUJE.
 * Skutočné uplatnenie robí až `submitOrder` / `createPosSale`.
 */
export const previewCoupon = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        code: z.string().min(1).max(40),
        event_id: z.string().uuid(),
        amount: z.number().nonnegative(),
        email: z.string().email().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<CouponPreview> => {
    // Endpoint je verejný a odpovedá na otázku „existuje tento kód?". Bez
    // stropu by sa dali kupóny jednoducho uhádnuť skriptom.
    const { data: allowed, error: limitErr } = await supabaseAdmin.rpc("hit_rate_limit", {
      p_bucket: `coupon:ip:${clientIp()}`,
      p_limit: 30,
      p_window_seconds: 600,
    });
    if (limitErr) {
      console.error("rate limit kupónov zlyhal", limitErr.message);
    } else if (allowed === false) {
      return {
        ok: false,
        code: data.code.toUpperCase(),
        discount: 0,
        message: "Priveľa pokusov o zľavový kód. Skús to prosím o chvíľu.",
      };
    }

    const result = await checkCoupon({
      code: data.code,
      eventId: data.event_id,
      amount: data.amount,
      email: data.email ?? null,
    });
    if (!result.ok) {
      return {
        ok: false,
        code: data.code.toUpperCase(),
        discount: 0,
        message: couponErrorMessage(result.error),
      };
    }

    const { data: coupon } = await supabaseAdmin
      .from("coupons")
      .select("discount_type, discount_value")
      .eq("id", result.coupon_id)
      .maybeSingle();

    return {
      ok: true,
      code: data.code.trim().toUpperCase(),
      discount: result.discount,
      discount_type: coupon?.discount_type === "amount" ? "amount" : "percent",
      discount_value: Number(coupon?.discount_value ?? 0),
    };
  });
