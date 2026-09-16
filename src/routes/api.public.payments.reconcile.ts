// Pravidelné úlohy — jedna routa pre všetko, čo beží z cronu.
//
// GP webpay ani tatrapay+ nemajú webhook, takže výsledok platby príde len
// návratom zákazníka do prehliadača. Kto po zaplatení zavrie okno, ostal by
// bez vstupeniek — dotiahne ho až dopytovací sken. K nemu pribudli platby
// z bankových výpisov, ktoré nemajú bránu vôbec.
//
// BEZPEČNOSŤ: úlohy púšťajú dopyty do bánk pre desiatky objednávok a vydávajú
// vstupenky, takže sa nesmú dať spustiť zvonku. Bez nastaveného
// `RECONCILE_SECRET` je routa úplne mŕtva a tvári sa, že neexistuje.
//
// PORADIE A IZOLÁCIA: kroky bežia za sebou a **žiadny nesmie zhodiť ostatné**.
// Peniaze majú prednosť: ingest a párovanie idú prvé, pripomienky a čakačka
// až potom.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { dopytajCakajuce } from "@/lib/order-settlement.server";
import { posliPripomienky } from "@/lib/reminders.server";
import { upovedomCakajucich } from "@/lib/waitlist.server";
import { vybavLehotyPrevodov } from "@/lib/prevod.server";
import { sparujTransakcie } from "@/lib/bank/matching.server";
import { stiahniZoZdrojov, upracOriginaly } from "@/lib/bank/ingest/index.server";
import { spustiUlohu } from "@/lib/job-runs.server";
import { errorMessage } from "@/lib/error-message";

/** Ako dlho sa drží surový obsah zo zdroja, kým ho retencia zmaže. */
const RETENCIA_DNI = 90;

function nenajdene(): Response {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Porovnanie tajomstva v konštantnom čase.
 *
 * Bežné `!==` skončí na prvom odlišnom znaku, takže z dĺžky odpovede sa dá
 * tajomstvo uhádnuť znak po znaku.
 */
function rovnakeTajomstvo(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let rozdiel = 0;
  for (let i = 0; i < a.length; i++) rozdiel |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return rozdiel === 0;
}

async function handler({ request }: { request: Request }) {
  const secret = process.env.RECONCILE_SECRET;
  const url = new URL(request.url);
  const podane = url.searchParams.get("key") || request.headers.get("x-reconcile-secret");
  if (!secret || !podane || !rovnakeTajomstvo(secret, podane)) return nenajdene();

  const hodiny = Number(url.searchParams.get("hours") || 48);
  const okno = Number.isFinite(hodiny) ? Math.min(Math.max(hodiny, 1), 168) : 48;

  // Každý krok je samostatná úloha so zámkom a vlastným záznamom behu.
  // `spustiUlohu` výnimku nikdy neprepustí, takže poradie nie je krehké.
  const banka = await spustiUlohu("banka-ingest", () => stiahniZoZdrojov());
  const parovanie = await spustiUlohu("banka-parovanie", () => sparujTransakcie());

  // Dopytovací sken rieši peniaze cez brány — najdôležitejší krok.
  const sken = await spustiUlohu("dopytovaci-sken", () => dopytajCakajuce(okno), {
    ttlMinut: 45,
  });

  const prevody = await spustiUlohu("prevod-lehoty", () => vybavLehotyPrevodov());
  const pripomienky = await spustiUlohu("pripomienky", () => posliPripomienky(1));
  const cakacka = await spustiUlohu("cakacka", () => upovedomCakajucich());
  const retencia = await spustiUlohu("banka-retencia", () => upracOriginaly(RETENCIA_DNI));

  const odpoved = { banka, parovanie, sken, prevody, pripomienky, cakacka, retencia };

  // Odtlačok behu — podľa neho prehľad prevádzky pozná, či cron vôbec beží.
  try {
    await supabaseAdmin.rpc("stamp_heartbeat", {
      p_name: "reconcile",
      p_detail: odpoved as unknown as Json,
    });
  } catch (e) {
    console.error("Odtlačok behu sa nepodarilo zapísať", errorMessage(e));
  }

  // Keď zlyhalo všetko, nech to monitoring vidí na stavovom kóde. Keď zlyhal
  // len niektorý krok, beh sám o sebe prebehol — detail je v odpovedi.
  const kroky = Object.values(odpoved);
  const vsetkoZlyhalo = kroky.every((k) => k.stav === "zlyhalo");

  return new Response(JSON.stringify(odpoved), {
    status: vsetkoZlyhalo ? 500 : 200,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/payments/reconcile")({
  server: { handlers: { GET: handler, POST: handler } },
});
