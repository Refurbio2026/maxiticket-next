// GoPay pod spoločným rozhraním. Samotný REST klient zostáva v gopay.server.ts,
// tento súbor len prekladá jeho tvar na tvar, ktorý čaká zvyšok aplikácie.
import type { Json } from "@/integrations/supabase/types";
import {
  createGoPayPayment,
  getGoPayPaymentStatus,
  mapGoPayStateToOrder,
  refundGoPayPayment,
} from "../gopay.server";
import type { GatewayStatus, PaymentGateway, StartPaymentInput, StartPaymentResult } from "./types";

export const goPayGateway: PaymentGateway = {
  id: "gopay",
  label: "Karta alebo prevod (GoPay)",
  hint: "Platba kartou, bankovým prevodom, Apple Pay alebo Google Pay.",

  isConfigured(): boolean {
    return !!(
      process.env.GOPAY_CLIENT_ID &&
      process.env.GOPAY_CLIENT_SECRET &&
      process.env.GOPAY_GOID
    );
  },

  async start(input: StartPaymentInput): Promise<StartPaymentResult> {
    const result = await createGoPayPayment({
      orderNumber: input.reference,
      orderDescription: input.description,
      amountCents: Math.round(input.amount * 100),
      currency: input.currency,
      customer: {
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        email: input.customer.email,
        phone: input.customer.phone,
      },
      items: input.items.map((it) => ({
        name: it.name,
        amountCents: Math.round(it.unitPrice * 100),
        count: it.quantity,
      })),
      returnUrl: input.returnUrl,
      notificationUrl: input.notifyUrl,
      lang: (input.lang || "sk").toUpperCase(),
    });
    return { providerRef: String(result.id), redirectUrl: result.gw_url, raw: result.raw };
  },

  async getStatus(providerRef: string): Promise<GatewayStatus | null> {
    const status = await getGoPayPaymentStatus(providerRef);
    const mapped = mapGoPayStateToOrder(status.state);
    return {
      // `awaiting_payment` z GoPay je pre nás len „ešte nič" — čakáme ďalej.
      state: mapped === "awaiting_payment" ? "pending" : mapped,
      raw: status.raw,
    };
  },

  supportsRefund: true,
  async refund(providerRef: string, amount: number): Promise<{ raw: Json }> {
    const res = await refundGoPayPayment(providerRef, Math.round(amount * 100));
    return { raw: res.raw };
  },
};
