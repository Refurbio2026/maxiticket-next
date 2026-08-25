// Návrat zákazníka z GP webpay. Iné oznámenie o výsledku od brány nepríde —
// HTTP rozhranie GP webpay webhook nemá — takže toto je jediné miesto, kde sa
// o zaplatení dozvieme priamo.
//
// Dôverovať sa dá len podpisu: parametre prechádzajú cez prehliadač zákazníka,
// takže „PRCODE=0" bez platného DIGEST/DIGEST1 je pokus o podvrh, nie platba.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { overNavrat } from "@/lib/payment-gateways/gpwebpay.server";
import { settleOrder } from "@/lib/order-settlement.server";
import { signOrderAccess } from "@/lib/order-access.server";
import { siteUrl } from "@/lib/site-url.server";
import { errorMessage } from "@/lib/error-message";

async function zozbierajParametre(request: Request): Promise<Record<string, string>> {
  const url = new URL(request.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (params[k] = v));
  if (request.method === "POST") {
    // Keď si obchodník vypýta ADDINFO, brána odpovedá metódou POST.
    const form = await request.formData();
    form.forEach((v, k) => {
      if (typeof v === "string") params[k] = v;
    });
  }
  return params;
}

function presmeruj(kam: string): Response {
  return new Response(null, { status: 302, headers: { location: kam } });
}

async function handler({ request }: { request: Request }) {
  const origin = siteUrl();
  let params: Record<string, string> = {};
  try {
    params = await zozbierajParametre(request);
    const navrat = overNavrat(params);

    if (!navrat) {
      // Neoveriteľná odpoveď. Zapíšeme ju celú — keby brána začala posielať
      // pole, ktoré nemáme v poradí podpisu, inak by sa to nedalo odhaliť.
      await supabaseAdmin.from("payment_logs").insert({
        provider: "gpwebpay",
        endpoint: "return",
        response_payload: params,
        status: "error",
        error_message: "Podpis odpovede GP webpay neprešiel overením",
      });
      return presmeruj(`${origin}/checkout/return?chyba=podpis`);
    }

    if (!navrat.orderId) {
      await supabaseAdmin.from("payment_logs").insert({
        provider: "gpwebpay",
        endpoint: "return",
        response_payload: params,
        status: "error",
        error_message: "Overená odpoveď bez id objednávky v poli MD",
      });
      return presmeruj(`${origin}/checkout/return?chyba=objednavka`);
    }

    await supabaseAdmin.from("payment_logs").insert({
      order_id: navrat.orderId,
      provider: "gpwebpay",
      endpoint: "return",
      response_payload: params,
      status: "ok",
    });

    if (!navrat.orderNumber) {
      // Bez ORDERNUMBER by sa platba nedala pripísať konkrétnemu zámeru.
      await supabaseAdmin.from("payment_logs").insert({
        order_id: navrat.orderId,
        provider: "gpwebpay",
        endpoint: "return",
        response_payload: params,
        status: "error",
        error_message: "Overená odpoveď bez ORDERNUMBER",
      });
      return presmeruj(`${origin}/checkout/return?chyba=objednavka`);
    }

    // Stav je overený podpisom brány, takže ho smieme podstrčiť doúčtovaniu.
    // Referencia je ORDERNUMBER tejto platby — nie to, na čo práve ukazuje
    // objednávka. Zákazník totiž mohol medzitým skúsiť inú bránu.
    await settleOrder(navrat.orderId, {
      provider: "gpwebpay",
      ref: navrat.orderNumber,
      state: navrat.state,
      raw: params,
    });

    return presmeruj(
      `${origin}/checkout/return?orderId=${navrat.orderId}&t=${signOrderAccess(navrat.orderId)}`,
    );
  } catch (e) {
    console.error("GP webpay návrat zlyhal", e);
    await supabaseAdmin
      .from("payment_logs")
      .insert({
        provider: "gpwebpay",
        endpoint: "return",
        response_payload: params,
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

export const Route = createFileRoute("/api/public/payments/gpwebpay/return")({
  server: { handlers: { GET: handler, POST: handler } },
});
