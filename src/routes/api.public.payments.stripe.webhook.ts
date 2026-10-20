// POST /api/public/payments/stripe/webhook
//
// Stripe sem posiela, čo sa stalo. Spracúvame dve veci:
//   * `checkout.session.completed` → objednávka sa doúčtuje, vydajú sa
//     vstupenky a odošle e-mail,
//   * `account.updated` → uloží sa, či Stripe organizátorovi už povolil
//     prijímať platby (`charges_enabled`).
//
// BEZPEČNOSŤ: bez overenia podpisu je toto otvorené API na vydávanie
// vstupeniek — kto pozná adresu, pošle si „zaplatené" a dostane lístky.
// Preto sa podpis overuje nad **surovým** telom ako prvá vec a sumám z tela
// sa neveria: stav aj suma sa berú z Stripe objektu až po overení, a samotné
// doúčtovanie si stav ešte raz dopytuje v `settleOrder`.
//
// Vstupenky nevydávame tu: robí to `settleOrder` v order-settlement.server.ts
// spoločne pre všetky brány — vrátane podpísaného QR, faktúry, e-mailu
// a uvolnenia kupónu. Druhá kópia tej logiky by sa rozišla.
import { createFileRoute } from "@tanstack/react-router";
import { settleOrder } from "@/lib/order-settlement.server";
import { spracujAccountUpdated } from "@/lib/stripe-connect.server";
import { overPodpis } from "@/lib/payment-gateways/stripe-podpis.server";
import { podpisoveTajomstvo } from "@/lib/payment-gateways/stripe.gateway.server";
import { pripravPristupy } from "@/lib/pristupy.server";
import { errorMessage } from "@/lib/error-message";

/** Stripe pokladá za doručené všetko, na čo odpovieme 2xx. */
const ok = (detail: string) => Response.json({ ok: true, detail });

async function handler({ request }: { request: Request }) {
  // Surové telo, nie `request.json()` — po preparsovaní a znovuposkládaní
  // by podpis nesedel.
  const telo = await request.text();

  await pripravPristupy();
  const tajomstvo = podpisoveTajomstvo();
  const podpis = request.headers.get("stripe-signature") ?? "";

  const overenie = overPodpis(telo, podpis, tajomstvo ?? "");
  if (!overenie.ok) {
    // 400 zámerne: Stripe to skúsi znova a v jeho prehľade je to vidieť ako
    // chyba. Do logu píšeme dôvod, nie telo — v tele sú osobné údaje.
    console.error("Stripe webhook: podpis neprešiel —", overenie.dovod);
    return Response.json({ error: "neplatný podpis" }, { status: 400 });
  }

  let udalost: Record<string, unknown>;
  try {
    udalost = JSON.parse(telo) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "telo nie je JSON" }, { status: 400 });
  }

  const typ = String(udalost.type ?? "");
  const objekt = ((udalost.data as Record<string, unknown>)?.object ?? {}) as Record<
    string,
    unknown
  >;

  try {
    if (typ === "account.updated") {
      const { zmenene } = await spracujAccountUpdated(objekt);
      return ok(zmenene ? "stav účtu organizátora uložený" : "účet nepoznáme, zahodené");
    }

    if (
      typ === "checkout.session.completed" ||
      typ === "checkout.session.async_payment_succeeded"
    ) {
      const orderId = idObjednavky(objekt);
      if (!orderId) {
        // Bez id objednávky nemáme čo doúčtovať. 200, aby to Stripe neskúšal
        // dokola — chyba je u nás v metadátach, nie na jeho strane.
        console.error("Stripe webhook: v session chýba metadata.orderId");
        return ok("session bez id objednávky, zahodené");
      }

      const sessionId = typeof objekt.id === "string" ? objekt.id : null;
      // Doúčtovanie si stav dopytuje samo (podľa `payment_ref`), takže sem
      // nepodsúvame stav z tela — len mu povieme, o ktorú platbu ide.
      const vysledok = await settleOrder(orderId, {
        provider: "stripe",
        ref: sessionId ?? "",
      });
      return ok(`objednávka ${orderId}: ${vysledok.status}${vysledok.changed ? " (zmenené)" : ""}`);
    }

    // Na čo nereagujeme, potvrdíme — inak to Stripe skúša dokola a v jeho
    // prehľade to svieti ako chyba, hoci je všetko v poriadku.
    return ok(`typ ${typ || "bez typu"} nespracúvame`);
  } catch (e) {
    console.error("Stripe webhook zlyhal", typ, errorMessage(e));
    // 500 nech to Stripe zopakuje — doúčtovanie je idempotentné, takže
    // zopakovanie nič nerozbije.
    return Response.json({ error: "spracovanie zlyhalo" }, { status: 500 });
  }
}

/**
 * Id našej objednávky zo session — z `metadata.orderId`, ktoré tam dávame
 * pri zakladaní platby.
 *
 * Zámerne nič nedohľadávame podľa iných polí: keby sa objednávka hľadala
 * napríklad podľa sumy, dala by sa cudzej platbe priradiť nesprávna
 * objednávka.
 */
function idObjednavky(session: Record<string, unknown>): string | null {
  const meta = (session.metadata ?? {}) as Record<string, unknown>;
  const z = meta.orderId;
  if (typeof z === "string" && z) return z;
  return null;
}

export const Route = createFileRoute("/api/public/payments/stripe/webhook")({
  server: {
    handlers: {
      POST: handler,
      // Stripe posiela len POST; GET necháme ohlásiť sa, nech sa dá overiť,
      // že je adresa živá, bez toho, aby čokoľvek spracovala.
      GET: async () => Response.json({ ok: true, detail: "Stripe webhook je tu. Posielaj POST." }),
    },
  },
});
