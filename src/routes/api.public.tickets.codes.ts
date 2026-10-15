// GET /api/public/tickets/codes?event_token=...
//
// Zoznam vstupeniek podujatia, ktorý si čítačka stiahne **pred** podujatím, aby
// vedela rozhodovať aj bez siete. Dovtedy offline režim pustil dovnútra
// kohokoľvek — vrátil „valid" na akýkoľvek kód (pozri `offline-scan.ts`).
//
// Čo sa posiela: kľúče, nie osobné údaje. Pri vstupenke s podpísaným tokenom je
// kľúčom **id vstupenky** (to isté, čo je čitateľné v QR medzi bodkami), pri
// starej vstupenke zo starého systému jej číselný kód. Žiadne meno, e-mail ani
// sedadlo — čítačka ich offline nepotrebuje a na ukradnutom telefóne by boli
// únik.
//
// BEZPEČNOSŤ: autorizuje výlučne znalosť `scanner_token` podujatia, rovnako ako
// samotné skenovanie a `stats`. Holé `event_id` sa neprijíma — id podujatí sú
// verejné. Navyše je tu strop na počet stiahnutí, lebo je to hromadný výpis.
//
// Vedomý kompromis: kto má `scanner_token`, dostane zoznam kľúčov podujatia.
// To mu ale nedáva viac, než už má — s tým istým tokenom vie vstupenky priamo
// skenovať. Preto token patrí len na čítačky a pri strate zariadenia sa mení.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Kľúč, pod ktorým vstupenku pozná čítačka — rovnaké pravidlo ako `klucKodu`. */
function kluc(t: { id: string; qr_code: string | null; qr_token: string | null }): string | null {
  if (t.qr_token && t.qr_token.startsWith("MT2.")) return t.id.replace(/-/g, "").toLowerCase();
  const kod = (t.qr_code || "").trim();
  return kod || null;
}

export const Route = createFileRoute("/api/public/tickets/codes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("event_token");
        if (!token) return Response.json({ error: "event_token required" }, { status: 400 });

        const { data: event } = await supabaseAdmin
          .from("events")
          .select("id")
          .eq("scanner_token", token)
          .maybeSingle();
        // Neplatný kód nesmie prezradiť, či také podujatie existuje.
        if (!event?.id) return Response.json({ error: "Not found" }, { status: 404 });

        const { data: allowed } = await supabaseAdmin.rpc("hit_rate_limit", {
          p_bucket: `codes:event:${event.id}`,
          p_limit: 30,
          p_window_seconds: 3600,
        });
        if (allowed === false) {
          return Response.json({ error: "Príliš veľa stiahnutí, skús o chvíľu." }, { status: 429 });
        }

        const { data: tickets, error } = await supabaseAdmin
          .from("tickets")
          .select("id, qr_code, qr_token, used_at, refunded_at")
          .eq("event_id", event.id)
          .is("refunded_at", null);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const ids: string[] = [];
        const kody: string[] = [];
        const pouzite: string[] = [];
        for (const t of tickets || []) {
          const k = kluc(t);
          if (!k) continue;
          if (t.used_at) {
            pouzite.push(k);
          } else if (t.qr_token && t.qr_token.startsWith("MT2.")) {
            ids.push(k);
          } else {
            kody.push(k);
          }
        }

        return Response.json(
          {
            event_id: event.id,
            ids,
            kody,
            pouzite,
            pocet: ids.length + kody.length + pouzite.length,
            stiahnute: new Date().toISOString(),
          },
          // Zoznam sa mení s každým predajom, takže ho nesmie cachovať proxy
          // ani prehliadač — čerstvosť si čítačka rieši sama.
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
