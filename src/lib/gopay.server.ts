// Server-only GoPay REST client. Never import from client code.
// Docs: https://doc.gopay.com/en/

type TokenCache = { token: string; expiresAt: number } | null;
let tokenCache: TokenCache = null;

function env() {
  const apiUrl = (process.env.GOPAY_API_URL || "https://gw.sandbox.gopay.com/api").replace(
    /\/+$/,
    "",
  );
  const clientId = process.env.GOPAY_CLIENT_ID;
  const clientSecret = process.env.GOPAY_CLIENT_SECRET;
  const goid = process.env.GOPAY_GOID;
  if (!clientId || !clientSecret || !goid) {
    throw new Error(
      "GoPay nie je nakonfigurovaný. Doplň GOPAY_CLIENT_ID, GOPAY_CLIENT_SECRET a GOPAY_GOID do secrets.",
    );
  }
  return { apiUrl, clientId, clientSecret, goid };
}

async function getAccessToken(
  scope: "payment-create" | "payment-all" = "payment-create",
): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 5_000) {
    return tokenCache.token;
  }
  const { apiUrl, clientId, clientSecret } = env();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${apiUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GoPay token zlyhal (${res.status}): ${text}`);
  }
  const data = JSON.parse(text) as { access_token: string; expires_in: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 30) * 1000,
  };
  return data.access_token;
}

export type CreatePaymentInput = {
  orderNumber: string;
  orderDescription: string;
  amountCents: number;
  currency?: string;
  customer: {
    firstName?: string;
    lastName?: string;
    email: string;
    phone?: string;
  };
  items: Array<{ name: string; amountCents: number; count?: number }>;
  returnUrl: string;
  notificationUrl: string;
  lang?: string;
};

export type CreatePaymentResult = {
  id: number;
  gw_url: string;
  state: string;
  raw: unknown;
};

export async function createGoPayPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  const { apiUrl, goid } = env();
  const token = await getAccessToken("payment-create");
  const body = {
    payer: {
      default_payment_instrument: "PAYMENT_CARD",
      allowed_payment_instruments: [
        "PAYMENT_CARD",
        "BANK_ACCOUNT",
        "GOPAY",
        "APPLE_PAY",
        "GOOGLE_PAY",
      ],
      contact: {
        first_name: input.customer.firstName || "",
        last_name: input.customer.lastName || "",
        email: input.customer.email,
        phone_number: input.customer.phone || "",
        country_code: "SVK",
      },
    },
    target: { type: "ACCOUNT", goid: Number(goid) },
    amount: input.amountCents,
    currency: input.currency || "EUR",
    order_number: input.orderNumber,
    order_description: input.orderDescription,
    items: input.items.map((it) => ({
      name: it.name,
      amount: it.amountCents,
      count: it.count ?? 1,
    })),
    callback: {
      return_url: input.returnUrl,
      notification_url: input.notificationUrl,
    },
    lang: input.lang || "SK",
  };

  const res = await fetch(`${apiUrl}/payments/payment`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GoPay create payment zlyhal (${res.status}): ${text}`);
  }
  const data = JSON.parse(text);
  return { id: data.id, gw_url: data.gw_url, state: data.state, raw: data };
}

export type GoPayStatus = {
  id: number;
  state: string; // CREATED | PAYMENT_METHOD_CHOSEN | AUTHORIZED | PAID | CANCELED | TIMEOUTED | REFUNDED | PARTIALLY_REFUNDED
  amount: number;
  currency: string;
  order_number: string;
  raw: unknown;
};

export async function getGoPayPaymentStatus(paymentId: string | number): Promise<GoPayStatus> {
  const { apiUrl } = env();
  const token = await getAccessToken("payment-all");
  const res = await fetch(`${apiUrl}/payments/payment/${paymentId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GoPay status zlyhal (${res.status}): ${text}`);
  }
  const data = JSON.parse(text);
  return {
    id: data.id,
    state: data.state,
    amount: data.amount,
    currency: data.currency,
    order_number: data.order_number,
    raw: data,
  };
}

export type RefundResult = {
  id?: number;
  result: string;
  raw: unknown;
};

export async function refundGoPayPayment(
  paymentId: string | number,
  amountCents: number,
): Promise<RefundResult> {
  const { apiUrl } = env();
  const token = await getAccessToken("payment-all");
  const res = await fetch(`${apiUrl}/payments/payment/${paymentId}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ amount: String(amountCents) }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GoPay refund zlyhal (${res.status}): ${text}`);
  }
  const data = JSON.parse(text);
  return { id: data.id, result: data.result || "FINISHED", raw: data };
}

export function mapGoPayStateToOrder(
  state: string,
): "paid" | "failed" | "cancelled" | "awaiting_payment" | "refunded" {
  switch (state) {
    case "PAID":
      return "paid";
    case "CANCELED":
      return "cancelled";
    case "TIMEOUTED":
      return "failed";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      return "refunded";
    default:
      return "awaiting_payment";
  }
}
