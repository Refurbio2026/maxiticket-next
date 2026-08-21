// Register platobných brán. Jediné miesto, kde sa rozhoduje, ktorá brána
// objednávku spracuje — všetko ostatné pracuje len s rozhraním PaymentGateway.
import { goPayGateway } from "./gopay.gateway.server";
import { gpWebpayGateway } from "./gpwebpay.server";
import { tatraPayPlusGateway } from "./tatrapayplus.server";
import type { GatewayId, PaymentGateway } from "./types";

const BRANY: Record<GatewayId, PaymentGateway> = {
  gopay: goPayGateway,
  gpwebpay: gpWebpayGateway,
  tatrapayplus: tatraPayPlusGateway,
};

export function branaPodlaId(id: string): PaymentGateway {
  const brana = BRANY[id as GatewayId];
  if (!brana) throw new Error(`Neznáma platobná brána '${id}'`);
  return brana;
}

/** Brány, ktoré majú vyplnené prístupy. Zákazníkovi sa ponúknu len tieto. */
export function dostupneBrany(): PaymentGateway[] {
  return Object.values(BRANY).filter((b) => b.isConfigured());
}

/**
 * Brána, ktorá sa použije, keď si zákazník nevyberie. Dá sa určiť premennou
 * PAYMENT_PROVIDER; inak je to prvá nakonfigurovaná.
 */
export function predvolenaBrana(): PaymentGateway | null {
  const zvolena = process.env.PAYMENT_PROVIDER?.trim();
  const dostupne = dostupneBrany();
  if (zvolena) {
    const brana = dostupne.find((b) => b.id === zvolena);
    if (brana) return brana;
  }
  return dostupne[0] ?? null;
}

export type { GatewayId, PaymentGateway, PaymentState, StartPaymentInput } from "./types";
