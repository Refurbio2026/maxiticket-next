// GoPay pod spoločným rozhraním. Samotný REST klient zostáva v gopay.server.ts,
// tento súbor len prekladá jeho tvar na tvar, ktorý čaká zvyšok aplikácie.
import type { Json } from "@/integrations/supabase/types";
import {
  createGoPayPayment,
  getGoPayPaymentStatus,
  mapGoPayStateToOrder,
  refundGoPayPayment,
} from "../gopay.server";
import type {
  GatewayStatus,
  PaymentGateway,
  PolozkaKonfiguracie,
  StartPaymentInput,
  StartPaymentResult,
  TestBrany,
} from "./types";
import { hodnota, polozka } from "../pristupy.server";

export const goPayGateway: PaymentGateway = {
  id: "gopay",
  label: "Karta alebo prevod (GoPay)",
  hint: "Platba kartou, bankovým prevodom, Apple Pay alebo Google Pay.",

  isConfigured(): boolean {
    return !!(
      hodnota("gopay", "GOPAY_CLIENT_ID") &&
      hodnota("gopay", "GOPAY_CLIENT_SECRET") &&
      hodnota("gopay", "GOPAY_GOID")
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

  konfiguracia(): PolozkaKonfiguracie[] {
    return [
      polozka("gopay", {
        premenna: "GOPAY_CLIENT_ID",
        nazov: "Client ID",
        popis: "Identifikátor obchodníka z GoPay",
        povinna: true,
      }),
      polozka("gopay", {
        premenna: "GOPAY_CLIENT_SECRET",
        nazov: "Client Secret",
        popis: "Heslo k API",
        povinna: true,
        tajna: true,
      }),
      polozka("gopay", {
        premenna: "GOPAY_GOID",
        nazov: "GoID",
        popis: "Číslo účtu GoPay, na ktorý chodia peniaze",
        povinna: true,
      }),
      polozka("gopay", {
        premenna: "GOPAY_API_URL",
        nazov: "Adresa API",
        popis: "Ostrá je https://gw.gopay.com/api; bez vyplnenia sa použije testovacia",
        povinna: false,
      }),
    ];
  },

  endpoint(): string {
    return (hodnota("gopay", "GOPAY_API_URL") || "https://gw.sandbox.gopay.com/api").replace(
      /\/+$/,
      "",
    );
  },

  async test(): Promise<TestBrany> {
    // Vypýtame si token. Nič nezakladáme, ale prístupy sa overia naozaj.
    const { apiUrl, clientId, clientSecret } = {
      apiUrl: this.endpoint(),
      clientId: hodnota("gopay", "GOPAY_CLIENT_ID") || "",
      clientSecret: hodnota("gopay", "GOPAY_CLIENT_SECRET") || "",
    };
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(`${apiUrl}/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "payment-create",
      }).toString(),
    });
    if (!res.ok) {
      return { ok: false, detail: `GoPay odmietol prístupy (HTTP ${res.status})` };
    }
    return { ok: true, detail: "Prístupy platia, token sa podarilo získať." };
  },
};
