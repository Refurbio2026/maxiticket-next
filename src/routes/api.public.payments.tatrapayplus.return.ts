// Návrat zákazníka z tatrapay+. Na rozdiel od GP webpay tu nič nepodpisujeme —
// a ani netreba: stav sa nečíta z adresy, ale dopytom priamo do banky. Adresa
// nám slúži len na to, aby sme vedeli, o ktorú objednávku ide.
//
// Pri prevode z účtu môže byť platba v tejto chvíli ešte nezúčtovaná. Vtedy
// objednávka zostane v `awaiting_payment` a dotiahne ju až dopytovací sken
// (reconcilePendingPayments).
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { settleOrder } from "@/lib/order-settlement.server";
import { signOrderAccess } from "@/lib/order-access.server";
import { siteUrl } from "@/lib/site-url.server";
import { errorMessage } from "@/lib/error-message";

function presmeruj(kam: string): Response {
  return new Response(null, { status: 302, headers: { location: kam } });
}

async function handler({ request }: { request: Request }) {
  const origin = siteUrl();
  try {
    const url = new URL(request.url);
    let orderId = url.searchParams.get("orderId");

    // Návratovú adresu treba mať zaregistrovanú v developer portáli banky.
    // Ak by ju banka zavolala bez našich parametrov, objednávku dohľadáme
    // podľa identifikátora platby, ktorý pripája ona.
    if (!orderId) {
      const paymentId = url.searchParams.get("paymentId") || url.searchParams.get("payment-id");
      if (paymentId) {
        const { data } = await supabaseAdmin
          .from("orders")
          .select("id")
          .eq("payment_provider", "tatrapayplus")
          .eq("payment_ref", paymentId)
          .maybeSingle();
        orderId = data?.id ?? null;
      }
    }

    if (!orderId) {
      await supabaseAdmin.from("payment_logs").insert({
        provider: "tatrapayplus",
        endpoint: "return",
        response_payload: Object.fromEntries(url.searchParams.entries()),
        status: "error",
        error_message: "Návrat z tatrapay+ bez identifikácie objednávky",
      });
      return presmeruj(`${origin}/checkout/return?chyba=objednavka`);
    }

    // Doúčtovať treba práve ten zámer tatrapay+, ktorý sa vrátil — nie to, na
    // čo objednávka práve ukazuje. Zákazník mohol medzitým skúsiť inú bránu
    // a bez toho by sme stav pýtali od nesprávnej.
    const { data: platba } = await supabaseAdmin
      .from("payments")
      .select("provider_payment_id")
      .eq("order_id", orderId)
      .eq("provider", "tatrapayplus")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    await settleOrder(
      orderId,
      platba?.provider_payment_id
        ? { provider: "tatrapayplus", ref: platba.provider_payment_id }
        : undefined,
    );
    return presmeruj(`${origin}/checkout/return?orderId=${orderId}&t=${signOrderAccess(orderId)}`);
  } catch (e) {
    console.error("tatrapay+ návrat zlyhal", e);
    await supabaseAdmin
      .from("payment_logs")
      .insert({
        provider: "tatrapayplus",
        endpoint: "return",
        status: "error",
        error_message: errorMessage(e),
      })
      .then(
        () => undefined,
        () => undefined,
      );
    return presmeruj(`${origin}/checkout/return?chyba=technicka`);
  }
}

export const Route = createFileRoute("/api/public/payments/tatrapayplus/return")({
  server: { handlers: { GET: handler, POST: handler } },
});
