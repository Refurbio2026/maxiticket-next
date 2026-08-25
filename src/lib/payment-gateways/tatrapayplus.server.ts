// tatrapay+ — súčasná platobná brána Tatra banky. Na rozdiel od starého
// TatraPay (presmerovanie podpísané HMAC) je to REST API: požiada sa o zámer
// platby, banka vráti adresu, na ktorú sa zákazník presmeruje, a stav sa
// potom dopytuje.
//
// Zdroj: OpenAPI tatrapay+ v1 (sdk.tatrabanka.sk) — POST /v1/payments,
// GET /v1/payments/{id}/status, PATCH /v1/payments/{id}, DELETE /v1/payments/{id}.
//
// Pozor: v1 nemá webhook. Výsledok sa dozvieme buď návratom zákazníka, alebo
// vlastným dopytom. Pri prevode z účtu navyše platba v čase návratu ešte
// nemusí byť zúčtovaná — preto dopytovanie nesmie chýbať.
import crypto from "node:crypto";
import type { Json } from "@/integrations/supabase/types";
import type {
  GatewayStatus,
  PaymentGateway,
  PaymentState,
  PolozkaKonfiguracie,
  StartPaymentInput,
  StartPaymentResult,
  TestBrany,
} from "./types";
import { hodnota, polozka } from "../pristupy.server";

const SANDBOX = "https://api.tatrabanka.sk/tatrapayplus/sandbox";

type Nastavenie = { apiUrl: string; clientId: string; clientSecret: string };

function nastavenie(): Nastavenie {
  const apiUrl = (hodnota("tatrapayplus", "TATRAPAYPLUS_API_URL") || SANDBOX).replace(/\/+$/, "");
  const clientId = hodnota("tatrapayplus", "TATRAPAYPLUS_CLIENT_ID");
  const clientSecret = hodnota("tatrapayplus", "TATRAPAYPLUS_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error(
      "tatrapay+ nie je nakonfigurovaný — doplň Client ID a Client Secret " +
        "(z developer.tatrabanka.sk) v Systém → Platobné brány.",
    );
  }
  return { apiUrl, clientId, clientSecret };
}

export function jeNakonfigurovany(): boolean {
  return !!(
    hodnota("tatrapayplus", "TATRAPAYPLUS_CLIENT_ID") &&
    hodnota("tatrapayplus", "TATRAPAYPLUS_CLIENT_SECRET")
  );
}

let tokenCache: { token: string; expiresAt: number } | null = null;

async function ziskajToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 5_000) return tokenCache.token;
  const { apiUrl, clientId, clientSecret } = nastavenie();
  const res = await fetch(`${apiUrl}/auth/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "TATRAPAYPLUS",
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`tatrapay+ token zlyhal (${res.status}): ${text}`);
  const data = JSON.parse(text) as { access_token: string; expires_in?: number };
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + ((data.expires_in ?? 300) - 30) * 1000,
  };
  return data.access_token;
}

/** Len na testy — token sa inak drží v pamäti procesu. */
export function zabudniToken(): void {
  tokenCache = null;
}

async function volaj(
  cesta: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; data: unknown; text: string }> {
  const { apiUrl } = nastavenie();
  const token = await ziskajToken();
  const res = await fetch(`${apiUrl}${cesta}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-Request-ID": crypto.randomUUID(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
    body: init.body,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Banka pri chybe niekedy pošle obyčajný text; nechávame ho v `text`.
  }
  return { status: res.status, data, text };
}

/**
 * Banka má na väčšine polí prísne vzory znakov. Diakritiku zhodíme a všetko
 * mimo povolenej množiny nahradíme medzerou, nech požiadavku neodmietne
 * kvôli menu so „š".
 */
export function ocisti(text: string, povolene: RegExp, maxDlzka: number): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split("")
    .map((z) => (povolene.test(z) ? z : " "))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxDlzka);
}

const MENO_ZNAKY = /[a-zA-Z0-9 ]/;
const POZNAMKA_ZNAKY = /[ 0-9a-zA-Z?:()/.,'+-]/;
const DRZITEL_ZNAKY = /[ 0-9a-zA-Z.@_-]/;

export type StavTatrapay = {
  selectedPaymentMethod?: string;
  authorizationStatus?: string;
  status?: string | { status?: string };
};

/**
 * Preloží stav zámeru platby na stav objednávky.
 *
 * Zámerne prísne: pri prevode z účtu sa za zaplatené považuje až ACSC/ACCC,
 * teda skutočne zúčtovaná platba. Stavy ako ACCP alebo PDNG znamenajú iba
 * „banka príkaz prijala" — vydať za ne vstupenky by znamenalo poslať tovar
 * pred peniazmi.
 */
export function stavPlatby(odpoved: StavTatrapay): PaymentState {
  const autorizacia = odpoved.authorizationStatus;
  if (autorizacia === "AUTH_FAILED" || autorizacia === "EXPIRED") return "failed";
  if (autorizacia === "CANCELLED_BY_USER" || autorizacia === "CANCELLED_BY_TPP") {
    return "cancelled";
  }

  const metoda = odpoved.selectedPaymentMethod;
  const stav = typeof odpoved.status === "string" ? odpoved.status : odpoved.status?.status;
  if (!metoda || !stav) return "pending";

  switch (metoda) {
    case "CARD_PAY":
    case "DIRECT_API":
      if (stav === "OK" || stav === "CPA") return "paid";
      if (stav === "CB") return "refunded";
      if (stav === "FAIL") return "failed";
      if (stav === "AUTH_CANCELED" || stav === "SPA") return "cancelled";
      if (stav === "AUTH_EXPIRED" || stav === "XPA") return "failed";
      return "pending";
    case "BANK_TRANSFER":
    case "QR_PAY":
      if (stav === "ACSC" || stav === "ACCC") return "paid";
      if (stav === "CANC") return "cancelled";
      if (stav === "RJCT") return "failed";
      return "pending";
    case "PAY_LATER":
      if (stav === "LOAN_APPLICATION_FINISHED" || stav === "LOAN_DISBURSED") return "paid";
      if (stav === "CANCELED") return "cancelled";
      if (stav === "EXPIRED") return "failed";
      return "pending";
    default:
      return "pending";
  }
}

export function postavTeloPlatby(input: StartPaymentInput) {
  if (!/^[0-9]{1,10}$/.test(input.reference)) {
    throw new Error(
      `tatrapay+ chce číselný variabilný symbol do 10 číslic, dostal '${input.reference}'`,
    );
  }
  const meno = ocisti(input.customer.firstName || "Zakaznik", MENO_ZNAKY, 30) || "Zakaznik";
  const priezvisko = ocisti(input.customer.lastName || "Vstupenky", MENO_ZNAKY, 30) || "Vstupenky";
  const drzitel = ocisti(`${meno} ${priezvisko}`, DRZITEL_ZNAKY, 45);

  return {
    basePayment: {
      instructedAmount: {
        amountValue: Number(input.amount.toFixed(2)),
        currency: (input.currency || "EUR").toUpperCase(),
      },
      endToEnd: { variableSymbol: input.reference },
    },
    userData: {
      firstName: meno,
      lastName: priezvisko,
      ...(input.customer.email ? { email: input.customer.email.slice(0, 50) } : {}),
      // Telefón musí byť v medzinárodnom tvare; iný by požiadavku zhodil.
      ...(/^\+[0-9]{7,15}$/.test(input.customer.phone || "")
        ? { phone: input.customer.phone }
        : {}),
    },
    bankTransfer: {
      remittanceInformationUnstructured: ocisti(input.description, POZNAMKA_ZNAKY, 100),
    },
    // cardHolder je pri platbe kartou povinný; bez neho by sa karta neponúkla.
    cardDetail: { cardHolder: drzitel.length >= 2 ? drzitel : "Zakaznik Vstupenky" },
  };
}

export const tatraPayPlusGateway: PaymentGateway = {
  id: "tatrapayplus",
  label: "tatrapay+ (prevod z účtu alebo karta)",
  hint: "Platba z účtu vo vybraných slovenských bankách, kartou alebo cez QR kód.",
  isConfigured: jeNakonfigurovany,

  async start(input: StartPaymentInput): Promise<StartPaymentResult> {
    const telo = postavTeloPlatby(input);
    const { status, data, text } = await volaj("/v1/payments", {
      method: "POST",
      headers: {
        "Redirect-URI": input.returnUrl,
        // Banka hlavičku vyžaduje. Keď IP zákazníka nepoznáme, pošleme IP
        // servera — inak by požiadavka neprešla validáciou vôbec.
        "IP-Address": input.clientIp || "0.0.0.0",
        "Accept-Language": (input.lang || "sk").toLowerCase(),
      },
      body: JSON.stringify(telo),
    });
    if (status !== 201 && status !== 200) {
      throw new Error(`tatrapay+ vytvorenie platby zlyhalo (${status}): ${text}`);
    }
    const odpoved = data as { paymentId?: string; tatraPayPlusUrl?: string };
    if (!odpoved?.paymentId || !odpoved?.tatraPayPlusUrl) {
      throw new Error(`tatrapay+ nevrátil adresu platby: ${text}`);
    }
    return {
      providerRef: odpoved.paymentId,
      redirectUrl: odpoved.tatraPayPlusUrl,
      raw: data as Json,
    };
  },

  async getStatus(providerRef: string): Promise<GatewayStatus | null> {
    const { status, data, text } = await volaj(
      `/v1/payments/${encodeURIComponent(providerRef)}/status`,
      { method: "GET" },
    );
    if (status === 404) {
      // Zámer platby banka po expirácii zahodí — pre nás je to neúspech.
      return { state: "failed", raw: { status, text } as Json };
    }
    if (status !== 200) throw new Error(`tatrapay+ stav platby zlyhal (${status}): ${text}`);
    return { state: stavPlatby(data as StavTatrapay), raw: data as Json };
  },

  supportsRefund: true,
  async refund(providerRef: string, amount: number): Promise<{ raw: Json }> {
    const { status, data, text } = await volaj(`/v1/payments/${encodeURIComponent(providerRef)}`, {
      method: "PATCH",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ operationType: "CHARGEBACK", amount: Number(amount.toFixed(2)) }),
    });
    if (status !== 200 && status !== 202) {
      throw new Error(
        `tatrapay+ refund zlyhal (${status}): ${text}. ` +
          "Vrátenie cez API funguje len pri platbe kartou — prevod z účtu treba vrátiť z banky.",
      );
    }
    return { raw: (data ?? { status }) as Json };
  },

  async zrus(providerRef: string): Promise<boolean> {
    const { status } = await volaj(`/v1/payments/${encodeURIComponent(providerRef)}`, {
      method: "DELETE",
    });
    // 404 znamená, že zámer už neexistuje — pre nás rovnaký výsledok.
    return status === 200 || status === 202 || status === 204 || status === 404;
  },

  konfiguracia(): PolozkaKonfiguracie[] {
    return [
      polozka("tatrapayplus", {
        premenna: "TATRAPAYPLUS_CLIENT_ID",
        nazov: "Client ID",
        popis: "Z aplikácie na developer.tatrabanka.sk",
        povinna: true,
      }),
      polozka("tatrapayplus", {
        premenna: "TATRAPAYPLUS_CLIENT_SECRET",
        nazov: "Client Secret",
        popis: "Z tej istej aplikácie, záložka autentifikácia",
        povinna: true,
        tajna: true,
      }),
      polozka("tatrapayplus", {
        premenna: "TATRAPAYPLUS_API_URL",
        nazov: "Adresa API",
        popis:
          "Ostrá je https://api.tatrabanka.sk/tatrapayplus/production; bez vyplnenia sa použije sandbox",
        povinna: false,
      }),
    ];
  },

  endpoint(): string {
    return (hodnota("tatrapayplus", "TATRAPAYPLUS_API_URL") || SANDBOX).replace(/\/+$/, "");
  },

  async test(): Promise<TestBrany> {
    // Token je jediné, čo sa dá vyskúšať bez zakladania platby — a prístupy
    // overí naozaj.
    zabudniToken();
    try {
      await ziskajToken();
      zabudniToken();
      return { ok: true, detail: "Prístupy platia, token sa podarilo získať." };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "Spojenie zlyhalo" };
    }
  },
};
