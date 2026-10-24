// Kontrola refundov u brány.
//
// PREČO: vrátenie peňazí sme zapísali hneď, ako ho brána prijala. Prijala
// ale neznamená vykonala — ComGate aj ostatné môžu refund zamietnuť neskôr
// (nedostatok prostriedkov na účte obchodníka, vypršaná karta, uzavretá
// transakcia). Bez spätného dopytu by sme zákazníkovi tvrdili, že peniaze
// odišli, hoci by stále ležali u nás.
//
// Čo to robí: pri nedávnych refundoch sa spýta brány na stav a rozdiel
// zapíše do `payment_logs`. Stav objednávky **nemení** — to by mohlo zmiasť
// účtovníctvo aj zákazníka. Od toho je upozornenie, nie automatická oprava.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { branaPodlaId, pripravPristupy } from "./payment-gateways/index.server";
import { errorMessage } from "./error-message";
import type { Json } from "@/integrations/supabase/types";

export type VysledokKontroly = {
  kontrolovanych: number;
  potvrdenych: number;
  nesedi: number;
  chyb: number;
  detail: string[];
};

/**
 * @param dni Ako ďaleko dozadu sa pozerať. Brány staršie transakcie
 *   spravidla neodpovedajú podrobne a nemá zmysel ich búchať dookola.
 */
export async function skontrolujRefundy(dni = 7): Promise<VysledokKontroly> {
  const v: VysledokKontroly = {
    kontrolovanych: 0,
    potvrdenych: 0,
    nesedi: 0,
    chyb: 0,
    detail: [],
  };
  const od = new Date(Date.now() - dni * 86_400_000).toISOString();

  const { data: platby } = await supabaseAdmin
    .from("payments")
    .select("id, order_id, provider, provider_payment_id, amount, status, created_at")
    .eq("status", "refunded")
    .gte("created_at", od)
    .limit(100);

  if (!platby?.length) return v;
  await pripravPristupy();

  for (const p of platby) {
    if (!p.provider_payment_id) continue;
    v.kontrolovanych++;
    try {
      const brana = branaPodlaId(p.provider);
      const stav = await brana.getStatus(p.provider_payment_id);
      // Brána, ktorá sa na stav pýtať nevie, nie je chyba — len o nej nič nezistíme.
      if (!stav) continue;

      if (stav.state === "refunded" || stav.state === "cancelled") {
        v.potvrdenych++;
        continue;
      }

      v.nesedi++;
      const sprava =
        `Refund ${p.provider_payment_id} (${p.amount} €) sme zapísali ako vykonaný, ` +
        `ale ${brana.label} hlási stav „${stav.state}". Over to v portáli brány.`;
      v.detail.push(sprava);
      await supabaseAdmin.from("payment_logs").insert({
        order_id: p.order_id,
        provider: p.provider,
        endpoint: `refund-check:${p.provider_payment_id}`,
        response_payload: (stav.raw ?? null) as Json,
        status: "error",
        error_message: sprava,
      });
    } catch (e) {
      v.chyb++;
      v.detail.push(`${p.provider_payment_id}: ${errorMessage(e)}`);
    }
  }

  return v;
}
