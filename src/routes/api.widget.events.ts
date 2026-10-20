// GET /api/widget/events?organizator=<subdomena>&pocet=N
// GET /api/widget/events?podujatie=<uuid>
//
// Dáta pre widget, ktorý si organizátor vloží na vlastný web (`/widget.js`).
// Volá sa to z **cudzích domén**, takže je tu CORS `*`.
//
// BEZPEČNOSŤ: vracia výhradne to, čo je na eticketo.eu aj tak verejné —
// zverejnené, nezrušené a budúce podujatia schváleného a zobrazeného
// organizátora. Presne to isté dnes prečíta kdokoľvek anonymným kľúčom cez
// Supabase REST (politika `events_public_published_select`), takže tento
// koncový bod neodkrýva nič nové. Žiadne objednávky, vstupenky ani kontakty.
//
// Prečo `supabaseAdmin` a nie anonymný klient: pohľad `public_organizers`
// anonym zámerne nevidí a stav schválenia organizátora treba overiť.
// Preto sa tu dotazy píšu úzko a stav sa kontroluje ručne.
//
// Strop je spoločný, nie na IP: perimeter dnes zlieva adresy (pozri `ip.ts`),
// takže limit na IP by bol strop na celý web. Odpoveď sa navyše dá kešovať
// minútu, čo väčšinu opakovaných volaní zachytí ešte pred nami.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  adresaNakupu,
  orezPocet,
  platnaSubdomena,
  platneUuid,
  type WidgetOdpoved,
  type WidgetPodujatie,
} from "@/lib/widget";
import { ipBucket } from "@/lib/client-ip.server";

const HLAVICKY = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  // Minúta: nové podujatie sa na webe organizátora objaví takmer hneď, ale
  // obnovenie stránky v cykle nám nerobí dotaz do databázy.
  "Cache-Control": "public, max-age=60, s-maxage=60",
};

const odpovedz = (telo: unknown, status = 200) =>
  Response.json(telo, { status, headers: HLAVICKY });

/** Riadok z `events` → to, čo widget potrebuje. Nič viac sa neposiela. */
function naPodujatie(
  r: {
    id: string;
    title: string;
    event_date: string;
    event_time: string | null;
    venue: string | null;
    city: string | null;
    image_url: string | null;
    category: string | null;
    base_price: number | null;
  },
  zaklad: string,
): WidgetPodujatie {
  return {
    id: r.id,
    nazov: r.title,
    datum: r.event_date,
    cas: r.event_time,
    miesto: r.venue,
    mesto: r.city,
    obrazok: r.image_url,
    kategoria: r.category,
    cena_od: r.base_price,
    odkaz: adresaNakupu(zaklad, r.id),
  };
}

const POLIA =
  "id, title, event_date, event_time, venue, city, image_url, category, base_price, organizer_id";

export const Route = createFileRoute("/api/widget/events")({
  server: {
    handlers: {
      // Prehliadač sa pred volaním z cudzej domény spýta, či smie.
      OPTIONS: async () => new Response(null, { status: 204, headers: HLAVICKY }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const zaklad = process.env.PUBLIC_SITE_URL || url.origin;

        const subdomena = (url.searchParams.get("organizator") || "").trim().toLowerCase();
        const idPodujatia = (url.searchParams.get("podujatie") || "").trim();
        if (!subdomena && !idPodujatia) {
          return odpovedz({ error: "Chýba `organizator` alebo `podujatie`." }, 400);
        }
        if (subdomena && !platnaSubdomena(subdomena)) {
          return odpovedz({ error: "Neplatná subdoména." }, 400);
        }
        if (idPodujatia && !platneUuid(idPodujatia)) {
          return odpovedz({ error: "Neplatné id podujatia." }, 400);
        }

        const kluc = ipBucket("widget:ip:");
        const { data: smie } = await supabaseAdmin.rpc("hit_rate_limit", {
          p_bucket: kluc ?? "widget:spolocne",
          p_limit: kluc ? 600 : 6000,
          p_window_seconds: 3600,
        });
        if (smie === false) {
          return odpovedz({ error: "Priveľa volaní, skús to o chvíľu." }, 429);
        }

        const dnes = new Date().toISOString().slice(0, 10);

        // --- Jedno podujatie -------------------------------------------------
        if (idPodujatia) {
          const { data: e } = await supabaseAdmin
            .from("events")
            .select(POLIA)
            .eq("id", idPodujatia)
            .eq("status", "published")
            .is("cancelled_at", null)
            .maybeSingle();
          if (!e) return odpovedz({ organizator: null, podujatia: [] } satisfies WidgetOdpoved);

          // Aj pri jednom podujatí platí, že organizátor musí byť schválený —
          // inak by sa widgetom dalo obísť schvaľovanie.
          const { data: org } = await supabaseAdmin
            .from("profiles")
            .select("display_name, company_name, subdomain, organizer_status")
            .eq("id", e.organizer_id)
            .maybeSingle();
          if (!org || org.organizer_status !== "approved") {
            return odpovedz({ organizator: null, podujatia: [] } satisfies WidgetOdpoved);
          }

          return odpovedz({
            organizator: {
              nazov: org.display_name || org.company_name || "",
              subdomena: org.subdomain ?? null,
            },
            podujatia: [naPodujatie(e, zaklad)],
          } satisfies WidgetOdpoved);
        }

        // --- Zoznam podujatí organizátora ------------------------------------
        const { data: org } = await supabaseAdmin
          .from("public_organizers")
          .select("id, display_name, company_name, subdomain")
          .eq("subdomain", subdomena)
          .maybeSingle();
        // Pohľad už filtruje neschválených aj tých, čo v katalógu byť nechcú.
        // `id` je v pohľade nullovateľné, preto sa kontroluje zvlášť.
        if (!org?.id) {
          return odpovedz({ organizator: null, podujatia: [] } satisfies WidgetOdpoved);
        }

        const pocet = orezPocet(url.searchParams.get("pocet"));
        const { data: zoznam } = await supabaseAdmin
          .from("events")
          .select(POLIA)
          .eq("organizer_id", org.id)
          .eq("status", "published")
          .is("cancelled_at", null)
          .gte("event_date", dnes)
          .order("event_date", { ascending: true })
          .limit(pocet);

        return odpovedz({
          organizator: {
            nazov: org.display_name || org.company_name || "",
            subdomena: org.subdomain ?? null,
          },
          podujatia: (zoznam ?? []).map((e) => naPodujatie(e, zaklad)),
        } satisfies WidgetOdpoved);
      },
    },
  },
});
