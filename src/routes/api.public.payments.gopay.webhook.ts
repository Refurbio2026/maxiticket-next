// GoPay pošle notifikáciu (GET alebo POST), keď sa zmení stav platby.
// Telu notifikácie neveríme — stav si vždy vypýtame priamo z GoPay API.
// `orderId` si dávame do adresy pri zakladaní platby; keď chýba, objednávku
// dohľadáme podľa identifikátora platby.
//
// Samotné doúčtovanie žije v order-settlement.server.ts spoločne pre všetky
// brány, nech sa tá istá logika neudržiava na štyroch miestach.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { settleOrder } from "@/lib/order-settlement.server";
import { errorMessage } from "@/lib/error-message";

async function handler({ request }: { request: Request }) {
  try {
    const url = new URL(request.url);
    let orderId = url.searchParams.get("orderId");
    if (!orderId && request.method === "POST") {
      try {
        const body = await request.json();
        const gopayId = body?.id || body?.parent_id;
        if (gopayId) {
          const { data: ord } = await supabaseAdmin
            .from("orders")
            .select("id")
            .eq("payment_ref", String(gopayId))
            .maybeSingle();
          orderId = ord?.id || null;
          if (!orderId) {
            // Objednávky spred zavedenia generických stĺpcov.
            const { data: stara } = await supabaseAdmin
              .from("orders")
              .select("id")
              .eq("gopay_payment_id", String(gopayId))
              .maybeSingle();
            orderId = stara?.id || null;
          }
        }
      } catch {
        /* GoPay môže poslať prázdne telo */
      }
    }
    if (!orderId) {
      return new Response(JSON.stringify({ ok: false, reason: "no_order_id" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    await settleOrder(orderId);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("GoPay webhook error", e);
    return new Response(JSON.stringify({ ok: false, error: errorMessage(e) }), {
      // 200 aby GoPay pri našej chybe neretryoval donekonečna.
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/payments/gopay/webhook")({
  server: { handlers: { GET: handler, POST: handler } },
});
