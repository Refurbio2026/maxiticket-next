// Uplatnenie zľavového kupónu na strane servera.
//
// Kontrolu aj inkrement počítadla robí jedna funkcia v databáze
// (`check_coupon`), ktorá si riadok kupónu uzamkne. Vďaka tomu sa dvom
// súbežným kupujúcim nemôže podariť minúť to isté posledné použitie.
//
// Zľavu nikdy nepočítaj v prehliadači — klient posiela len kód.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CouponCheck =
  | { ok: true; coupon_id: string; discount: number }
  | { ok: false; error: string };

const MESSAGES: Record<string, string> = {
  not_found: "Takýto zľavový kód neexistuje.",
  inactive: "Tento kupón je pozastavený.",
  not_yet: "Tento kupón ešte neplatí.",
  expired: "Platnosť kupónu už uplynula.",
  wrong_event: "Kupón sa na toto podujatie nevzťahuje.",
  min_amount: "Objednávka je pod minimálnou sumou pre tento kupón.",
  exhausted: "Kupón je už vyčerpaný.",
  email_limit: "Tento kupón si už z tejto adresy použil.",
};

export function couponErrorMessage(code: string): string {
  return MESSAGES[code] ?? "Kupón sa nepodarilo uplatniť.";
}

/**
 * Overí kupón voči podujatiu a sume.
 *
 * `claim = true` zároveň zvýši počítadlo použití — volaj ho až vtedy, keď
 * objednávka naozaj vzniká, a pri neúspechu ďalej v toku zavolaj
 * `releaseCoupon()`.
 */
export async function checkCoupon(opts: {
  code: string;
  eventId: string;
  amount: number;
  email?: string | null;
  claim?: boolean;
}): Promise<CouponCheck> {
  const code = opts.code.trim();
  if (!code) return { ok: false, error: "not_found" };

  const { data, error } = await supabaseAdmin.rpc("check_coupon", {
    p_code: code,
    p_event_id: opts.eventId,
    p_amount: opts.amount,
    p_email: opts.email ?? null,
    p_claim: !!opts.claim,
  });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: "not_found" };
  if (row.error_code) return { ok: false, error: row.error_code as string };
  return { ok: true, coupon_id: row.coupon_id as string, discount: Number(row.discount || 0) };
}

/** Vráti použitie kupónu späť. Volaj, keď objednávka po uplatnení zlyhá. */
export async function releaseCoupon(couponId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc("release_coupon", { p_coupon_id: couponId });
  if (error) console.error("release_coupon zlyhalo", couponId, error.message);
}

/**
 * Vráti kupón po zrušenej alebo neúspešnej platbe.
 *
 * Na rozdiel od `releaseCoupon()` zmaže aj riadok uplatnenia — bez toho by
 * zákazníkovi ostal minutý `max_uses_per_email`, hoci nič nezaplatil. Je
 * idempotentná, takže opakovaná notifikácia z GoPay nič nepokazí.
 */
export async function releaseCouponForOrder(orderId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc("release_order_coupon", { p_order_id: orderId });
  if (error) console.error("release_order_coupon zlyhalo", orderId, error.message);
}

/** Zápis uplatnenia. Bez neho by nefungoval limit na e-mail ani prehľad využitia. */
export async function recordRedemption(opts: {
  couponId: string;
  orderId: string;
  email?: string | null;
  discount: number;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("coupon_redemptions").insert({
    coupon_id: opts.couponId,
    order_id: opts.orderId,
    email: opts.email ?? null,
    discount_amount: opts.discount,
  });
  if (error) console.error("Zápis uplatnenia kupónu zlyhal", opts.orderId, error.message);
}
