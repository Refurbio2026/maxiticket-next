// Stiahnutie faktúry k objednávke.
//
// Faktero vydáva na PDF len podpísanú adresu platnú päť minút, takže sa nedá
// uložiť ani poslať e-mailom. Zákazník preto dostane odkaz na nás a čerstvú
// adresu si vypýtame až pri kliknutí.
//
// BEZPEČNOSŤ: faktúra obsahuje meno a e-mail zákazníka, takže sa nesmie dať
// stiahnuť len na základe id objednávky. Vyžaduje sa ten istý podpísaný token
// ako pri prístupe k objednávke.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyOrderAccess } from "@/lib/order-access.server";
import { systemPodlaId } from "@/lib/invoicing/index.server";
import { pripravPristupy } from "@/lib/pristupy.server";
import { errorMessage } from "@/lib/error-message";

function odmietnute(dovod: string, status = 404): Response {
  return new Response(JSON.stringify({ error: dovod }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handler({ request, params }: { request: Request; params: { orderId: string } }) {
  const url = new URL(request.url);
  const orderId = params.orderId;
  if (!verifyOrderAccess(orderId, url.searchParams.get("t"))) {
    return odmietnute("Not found");
  }

  try {
    // To isté id môže patriť objednávke alebo vyúčtovaciemu protokolu —
    // faktúru vystavujeme k obom a odkaz má byť jeden.
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("invoice_provider, superfaktura_invoice_id, superfaktura_invoice_pdf_url")
      .eq("id", orderId)
      .maybeSingle();

    let provider = order?.invoice_provider ?? null;
    let invoiceId = order?.superfaktura_invoice_id ?? null;
    let ulozenaAdresa = order?.superfaktura_invoice_pdf_url ?? null;

    if (!invoiceId) {
      const { data: settlement } = await supabaseAdmin
        .from("settlements")
        .select("invoice_source, invoice_id, invoice_pdf_url")
        .eq("id", orderId)
        .maybeSingle();
      provider = settlement?.invoice_source ?? null;
      invoiceId = settlement?.invoice_id ?? null;
      ulozenaAdresa = settlement?.invoice_pdf_url ?? null;
    }

    if (!invoiceId) return odmietnute("Faktúra zatiaľ nie je vystavená");

    await pripravPristupy();
    const system = systemPodlaId(provider || "superfaktura");
    const cerstva = await system.pdfAdresa(invoiceId);

    // `null` znamená, že uložená adresa platí natrvalo (SuperFaktúra).
    const kam = cerstva || ulozenaAdresa;
    if (!kam) return odmietnute("Adresa faktúry nie je k dispozícii");

    return new Response(null, { status: 302, headers: { location: kam } });
  } catch (e) {
    console.error("Faktúru sa nepodarilo doručiť", orderId, e);
    return new Response(JSON.stringify({ error: errorMessage(e) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/invoices/$orderId/pdf")({
  server: { handlers: { GET: handler } },
});
