// Dopytovací sken pre cron.
//
// GP webpay ani tatrapay+ nemajú webhook, takže výsledok platby príde len
// návratom zákazníka do prehliadača. Kto po zaplatení zavrie okno, ostal by
// bez vstupeniek — dotiahne ho až tento sken.
//
// BEZPEČNOSŤ: sken púšťa dopyty do banky pre desiatky objednávok, takže sa
// nesmie dať spustiť zvonku. Bez nastaveného `RECONCILE_SECRET` je routa
// úplne mŕtva a tvári sa, že neexistuje.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { dopytajCakajuce } from "@/lib/order-settlement.server";
import { posliPripomienky } from "@/lib/reminders.server";
import { errorMessage } from "@/lib/error-message";

function nenajdene(): Response {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

async function handler({ request }: { request: Request }) {
  const secret = process.env.RECONCILE_SECRET;
  const url = new URL(request.url);
  const podane = url.searchParams.get("key") || request.headers.get("x-reconcile-secret");
  if (!secret || podane !== secret) return nenajdene();

  const hodiny = Number(url.searchParams.get("hours") || 48);
  try {
    const vysledok = await dopytajCakajuce(
      Number.isFinite(hodiny) ? Math.min(Math.max(hodiny, 1), 168) : 48,
    );
    // Pripomienky idú tou istou cestou — jeden cron, jedno tajomstvo.
    // Zlyhanie pripomienok nesmie zhodiť dopytovací sken; ten rieši peniaze.
    let pripomienky: unknown = null;
    try {
      pripomienky = await posliPripomienky(1);
    } catch (e) {
      console.error("Pripomienky zlyhali", e);
      pripomienky = { chyba: errorMessage(e) };
    }

    // Odtlačok behu — podľa neho prehľad prevádzky pozná, či cron vôbec beží.
    await supabaseAdmin.rpc("stamp_heartbeat", {
      p_name: "reconcile",
      p_detail: { ...vysledok, pripomienky } as unknown as Json,
    });
    return new Response(JSON.stringify({ ...vysledok, pripomienky }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("Dopytovací sken zlyhal", e);
    return new Response(JSON.stringify({ ok: false, error: errorMessage(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/public/payments/reconcile")({
  server: { handlers: { GET: handler, POST: handler } },
});
