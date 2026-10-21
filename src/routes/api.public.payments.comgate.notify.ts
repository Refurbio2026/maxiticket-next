// POST /api/public/payments/comgate/notify
//
// Push notifikácia od ComGate: „s platbou sa niečo stalo". Adresa sa nastavuje
// v ich portáli (Integrace → Nastavení obchodu → Napojení obchodu, pole pre
// výsledok na pozadí), nie pri zakladaní platby.
//
// BEZPEČNOSŤ. ComGate notifikáciu nepodpisuje — posiela v tele pole `secret`,
// teda to isté heslo, ktorým sa my prihlasujeme k jeho API. Preto:
//   1. `secret` sa porovná s našim v konštantnom čase; keď nesedí, 403,
//   2. telu sa **neveria sumy ani stav** — doúčtovanie si stav vypýta priamo
//      z `/v2.0/payment/transId/…`. Dokumentácia ComGate to výslovne žiada:
//      „the payment status should never be evaluated solely based on the
//      received notification".
// Bez prvého bodu by stačilo poznať adresu a poslať si „PAID". Bez druhého by
// stačilo poslať podvrhnutú sumu.
//
// Vstupenky nevydáva táto routa: robí to `settleOrder` v
// order-settlement.server.ts spoločne pre všetky brány — vrátane podpísaného
// QR, faktúry a e-mailu. Celé doúčtovanie je idempotentné, čo ComGate priamo
// vyžaduje („goods are issued to the Payer only once, even if the result of
// the same payment is passed to the Client's server multiple times").
//
// ODPOVEDAŤ TREBA 2xx. Na čokoľvek iné ComGate notifikáciu posiela znova —
// podľa dokumentácie až tisíckrát a potom pošle Patrikovi e-mail.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { settleOrder } from "@/lib/order-settlement.server";
import { rozhodniONotifikacii } from "@/lib/payment-gateways/comgate-notifikacia.server";
import { tajomstvo } from "@/lib/payment-gateways/comgate.gateway.server";
import { pripravPristupy } from "@/lib/pristupy.server";
import { errorMessage } from "@/lib/error-message";

/** ComGate berie za potvrdenie akýkoľvek 2xx; posielame aj text, ako ich vzory. */
const ok = (detail: string) =>
  new Response("OK", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Detail": detail.slice(0, 180) },
  });

async function handler({ request }: { request: Request }) {
  const telo = await request.text();

  await pripravPristupy();
  // Rozhodovanie žije v `comgate-notifikacia.server.ts` a je otestované po
  // vetvách; tu sa z výsledku robí len HTTP odpoveď.
  const rozhodnutie = rozhodniONotifikacii(telo, request.headers.get("content-type"), tajomstvo());

  if (rozhodnutie.co === "nenastavene") {
    console.error("ComGate notifikácia prišla, ale heslo brány nie je nastavené.");
    return new Response("not configured", { status: 503 });
  }
  if (rozhodnutie.co === "cudzie-heslo") {
    // Do logu nepíšeme telo — sú v ňom osobné údaje kupujúceho.
    console.error("ComGate notifikácia: heslo v tele nesedí, zahadzujem.");
    return new Response("forbidden", { status: 403 });
  }
  if (rozhodnutie.co === "necitatelne") {
    console.error("ComGate notifikácia: telo sa nedá prečítať (chýba transId alebo status).");
    // 400 nech to brána zopakuje — možno to bola porucha pri prenose.
    return new Response("bad request", { status: 400 });
  }
  const { notifikacia } = rozhodnutie;

  try {
    const orderId = await objednavkaPodlaPlatby(notifikacia.transId);
    if (!orderId) {
      // Platbu nepoznáme — môže ísť o test z iného prostredia alebo o platbu
      // založenú mimo nášho systému. 200, nech to brána neskúša tisíckrát.
      console.error("ComGate notifikácia: neznáma platba", notifikacia.transId);
      return ok("platbu nepoznáme, zahodené");
    }

    // Stav sa dopýta doúčtovanie priamo z brány; z notifikácie berieme len to,
    // ktorej platby sa to týka.
    const vysledok = await settleOrder(orderId, {
      provider: "comgate",
      ref: notifikacia.transId,
    });
    return ok(`objednávka ${orderId}: ${vysledok.status}${vysledok.changed ? " (zmenené)" : ""}`);
  } catch (e) {
    console.error("ComGate notifikácia zlyhala", notifikacia.transId, errorMessage(e));
    // 500 nech to brána zopakuje; doúčtovanie je idempotentné.
    return new Response("error", { status: 500 });
  }
}

/**
 * Objednávka podľa identifikátora platby.
 *
 * Hľadáme **len** podľa `payment_ref`, teda podľa toho, čo sme si pri zakladaní
 * platby uložili. Podľa `refId` (variabilný symbol) sa zámerne nehľadá: ten
 * podľa dokumentácie ComGate nie je unikátny, takže by sa dala notifikácia
 * priradiť nesprávnej objednávke.
 */
async function objednavkaPodlaPlatby(transId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("payment_provider", "comgate")
    .eq("payment_ref", transId)
    .maybeSingle();
  return data?.id ?? null;
}

export const Route = createFileRoute("/api/public/payments/comgate/notify")({
  server: {
    handlers: {
      POST: handler,
      // ComGate posiela POST. GET necháme ohlásiť sa, nech sa dá overiť, že je
      // adresa živá, bez toho, aby čokoľvek spracoval.
      GET: async () =>
        new Response("ComGate notify je tu. Posielaj POST.", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    },
  },
});
