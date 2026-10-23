// GET /api/public/tickets/<id>.pkpass?t=<podpis objednávky>
//
// Vstupenka pre Apple Wallet. Súbor sa skladá a podpisuje až na požiadanie —
// nikam sa neukladá, takže sa nedá vytiahnuť z disku ani z databázy.
//
// BEZPEČNOSŤ: pass obsahuje meno kupujúceho a hlavne **platný QR kód**, ktorým
// sa dá prejsť na podujatie. Nesmie teda stačiť id vstupenky. Vyžaduje sa ten
// istý podpísaný token objednávky ako pri faktúre a PDF vstupenkách
// (`verifyOrderAccess`), a token sa overuje proti objednávke, ktorej tá
// vstupenka naozaj patrí — inak by token k jednej objednávke otvoril
// vstupenky z inej.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyOrderAccess } from "@/lib/order-access.server";
import { pripravPristupy } from "@/lib/pristupy.server";
import { vytvorPkpass } from "@/lib/wallet/apple-wallet.server";
import { errorMessage } from "@/lib/error-message";

function odmietnute(dovod: string, status = 404): Response {
  return new Response(JSON.stringify({ error: dovod }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handler({ request, params }: { request: Request; params: { ticketId: string } }) {
  const url = new URL(request.url);
  const ticketId = params.ticketId;
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return odmietnute("Not found");

  const { data: vstupenka } = await supabaseAdmin
    .from("tickets")
    .select("id, order_id, event_id, qr_token, qr_code, seat_label, refunded_at")
    .eq("id", ticketId)
    .maybeSingle();
  // Neexistujúca vstupenka a neplatný token dávajú tú istú odpoveď — nech sa
  // skúšaním id nedá zistiť, ktoré vstupenky existujú.
  if (!vstupenka?.order_id) return odmietnute("Not found");
  if (!verifyOrderAccess(vstupenka.order_id, url.searchParams.get("t"))) {
    return odmietnute("Not found");
  }
  if (vstupenka.refunded_at) return odmietnute("Vstupenka bola refundovaná", 410);

  const { data: objednavka } = await supabaseAdmin
    .from("orders")
    .select("customer_name, payment_vs, status")
    .eq("id", vstupenka.order_id)
    .maybeSingle();
  // Nezaplatená objednávka nemá čo chodiť do peňaženky.
  if (objednavka?.status !== "paid") return odmietnute("Vstupenka ešte nie je zaplatená", 409);

  const { data: podujatie } = await supabaseAdmin
    .from("events")
    .select("title, event_date, event_time, venue, city, organizer_id")
    .eq("id", vstupenka.event_id)
    .maybeSingle();
  if (!podujatie) return odmietnute("Not found");

  let organizator: string | null = null;
  if (podujatie.organizer_id) {
    const { data: profil } = await supabaseAdmin
      .from("profiles")
      .select("display_name, company_name")
      .eq("id", podujatie.organizer_id)
      .maybeSingle();
    organizator = profil?.display_name || profil?.company_name || null;
  }

  try {
    await pripravPristupy();
    const pass = await vytvorPkpass({
      id: vstupenka.id,
      // Podpísaný token je to, čo čítačka očakáva; starý číselný kód je záloha
      // pre vstupenky prenesené zo starého systému.
      qrKod: vstupenka.qr_token || vstupenka.qr_code || vstupenka.id,
      sedadlo: vstupenka.seat_label,
      podujatie: podujatie.title,
      datum: podujatie.event_date,
      cas: podujatie.event_time,
      miesto: podujatie.venue,
      mesto: podujatie.city,
      kupujuci: objednavka?.customer_name ?? null,
      objednavka: objednavka?.payment_vs ? String(objednavka.payment_vs) : null,
      organizator,
    });

    return new Response(new Uint8Array(pass), {
      headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": `attachment; filename="vstupenka-${vstupenka.id.slice(0, 8)}.pkpass"`,
        // Pass sa podpisuje nanovo pri každom stiahnutí; kešovať ho netreba
        // a v medzipamäti proxy by nemal čo robiť.
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    // Chýbajúci certifikát je chyba nastavenia, nie zákazníka. Do odpovede
    // ide zrozumiteľná veta, do logu podrobnosť.
    console.error("Apple Wallet pass sa nepodarilo vytvoriť", ticketId, errorMessage(e));
    return new Response(
      JSON.stringify({
        error: "Pridanie do Apple Wallet zatiaľ nie je k dispozícii.",
        detail: errorMessage(e),
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/public/tickets/$ticketId.pkpass")({
  server: { handlers: { GET: handler } },
});
