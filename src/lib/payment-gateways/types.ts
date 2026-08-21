// Spoločné rozhranie platobných brán. Aplikácia nesmie vedieť, ktorá brána
// objednávku spracúva — vie len, že ju vie naštartovať, opýtať sa na stav
// a (niekedy) vrátiť peniaze.
import type { Json } from "@/integrations/supabase/types";

export type GatewayId = "gopay" | "gpwebpay" | "tatrapayplus";

/** Stav platby preložený do reči objednávky. */
export type PaymentState = "pending" | "paid" | "failed" | "cancelled" | "refunded";

export type StartPaymentInput = {
  orderId: string;
  /** Číselná referencia — GP webpay ORDERNUMBER, tatrapay+ variabilný symbol. */
  reference: string;
  /** Suma v eurách, nie v centoch. */
  amount: number;
  currency: string;
  description: string;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  items: Array<{ name: string; unitPrice: number; quantity: number }>;
  /** Kam sa vráti zákazník po zaplatení. */
  returnUrl: string;
  /** Kam brána pošle server-to-server notifikáciu (ak ju vie poslať). */
  notifyUrl: string;
  clientIp: string;
  lang: string;
};

export type StartPaymentResult = {
  /** Identifikátor platby u brány — ukladá sa do orders.payment_ref. */
  providerRef: string;
  redirectUrl: string;
  raw: Json;
};

export type GatewayStatus = { state: PaymentState; raw: Json };

export interface PaymentGateway {
  id: GatewayId;
  /** Názov pre zákazníka v checkoute. */
  label: string;
  /** Krátky popis pod názvom. */
  hint: string;
  /**
   * `false`, keď chýbajú prístupy. Brána sa vtedy zákazníkovi vôbec
   * neponúkne — radšej ju skryť, než ho poslať do slepej uličky.
   */
  isConfigured(): boolean;
  start(input: StartPaymentInput): Promise<StartPaymentResult>;
  /**
   * Dopyt na stav platby. `null` znamená, že brána takú otázku nevie
   * zodpovedať a stav sa dá zistiť len z overeného návratu zákazníka
   * (presne toto je prípad GP webpay cez HTTP rozhranie).
   */
  getStatus(providerRef: string): Promise<GatewayStatus | null>;
  /** `false` znamená, že refund sa robí ručne v portáli brány. */
  supportsRefund: boolean;
  refund(providerRef: string, amount: number): Promise<{ raw: Json }>;
}

export function nemaRefund(id: GatewayId): never {
  throw new Error(
    `Brána ${id} nevie vrátiť peniaze cez API — refund sprav v jej portáli ` +
      `a v Maxitickete ho zapíš ako ručný.`,
  );
}
