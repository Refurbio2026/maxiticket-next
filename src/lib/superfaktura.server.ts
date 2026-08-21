// Server-only SuperFaktúra REST client. Never import from client code.
// Cash register document (pokladničný doklad) endpoint.
// Docs: https://github.com/superfaktura/docs

import type { Json } from "@/integrations/supabase/types";

function env() {
  const apiUrl = (process.env.SUPERFAKTURA_API_URL || "https://moja.superfaktura.sk").replace(
    /\/+$/,
    "",
  );
  const email = process.env.SUPERFAKTURA_EMAIL;
  const apiKey = process.env.SUPERFAKTURA_API_KEY;
  const companyId = process.env.SUPERFAKTURA_COMPANY_ID;
  if (!email || !apiKey || !companyId) {
    throw new Error(
      "SuperFaktúra nie je nakonfigurovaná. Doplň SUPERFAKTURA_EMAIL, SUPERFAKTURA_API_KEY a SUPERFAKTURA_COMPANY_ID do secrets.",
    );
  }
  const sandbox = (process.env.SUPERFAKTURA_SANDBOX || "true").toLowerCase() === "true";
  return { apiUrl, email, apiKey, companyId, sandbox };
}

function authHeader() {
  const { email, apiKey, companyId } = env();
  return `SFAPI email=${email}&apikey=${apiKey}&company_id=${companyId}&module=Lovable+vipky.sk`;
}

export type SfCustomer = {
  name: string;
  email: string;
  phone?: string;
};

export type SfItem = {
  name: string;
  description?: string;
  unit_price: number; // bez DPH alebo s DPH podľa nastavenia? V SF: unit_price je bez DPH, tax je %
  quantity: number;
  tax: number; // napr. 20
};

export type SfInvoiceInput = {
  orderId: string;
  variableSymbol: string;
  customer: SfCustomer;
  items: SfItem[];
  paymentType?: "card" | "transfer" | "cash";
  /** Popis faktúry; bez neho sa použije text pre vstupenky. */
  name?: string;
  /**
   * `false` vystaví faktúru so splatnosťou (provízia organizátorovi ešte
   * zaplatená nie je). Predvolene `true` — vstupenky sú zaplatené vopred.
   */
  alreadyPaid?: boolean;
};

export type SfInvoiceResult = {
  invoice_id: string;
  invoice_number: string;
  pdf_url: string;
  raw: Json;
};

/** Faktúra v odpovedi SuperFaktúry — čítame z nej len číslo a token na PDF. */
type SfInvoice = {
  id: string | number;
  invoice_no_formatted?: string;
  invoice_no?: string;
  token?: string;
};

/**
 * Odpoveď SuperFaktúry. Faktúru vracia raz zabalenú v `data`, inokedy priamo —
 * preto sú obe vetvy voliteľné. `error === 0` znamená úspech.
 */
type SfResponse = {
  error?: number | string;
  error_message?: string;
  data?: { Invoice?: SfInvoice };
  Invoice?: SfInvoice;
};

/**
 * Vytvorí faktúru v SuperFaktúre. Predvolene je označená ako zaplatená (pri
 * vstupenkách GoPay zaplatil vopred); pre províziu organizátorovi sa posiela
 * `alreadyPaid: false`, lebo tá sa fakturuje so splatnosťou.
 */
export async function createPaidInvoice(input: SfInvoiceInput): Promise<SfInvoiceResult> {
  const { apiUrl } = env();
  const payload = {
    Invoice: {
      name: input.name || `Vstupenky – objednávka ${input.variableSymbol}`,
      variable: input.variableSymbol,
      type: "regular",
      payment_type: input.paymentType || "card",
      already_paid: input.alreadyPaid !== false,
    },
    Client: {
      name: input.customer.name,
      email: input.customer.email,
      phone: input.customer.phone || "",
    },
    InvoiceItem: input.items.map((it) => ({
      name: it.name,
      description: it.description || "",
      unit: "ks",
      unit_price: it.unit_price,
      quantity: it.quantity,
      tax: it.tax,
    })),
  };

  const body = "data=" + encodeURIComponent(JSON.stringify(payload));
  const res = await fetch(`${apiUrl}/invoices/create`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SuperFaktúra create zlyhalo (${res.status}): ${text}`);
  }
  let data: SfResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`SuperFaktúra: nevalidná JSON odpoveď: ${text.slice(0, 200)}`);
  }
  if (data?.error && data.error !== 0) {
    throw new Error(`SuperFaktúra error: ${data.error_message || JSON.stringify(data)}`);
  }
  const inv = data?.data?.Invoice || data?.Invoice;
  if (!inv) {
    throw new Error(`SuperFaktúra: nečakaná štruktúra odpovede: ${text.slice(0, 200)}`);
  }
  const invoiceId = String(inv.id);
  const invoiceNumber = String(inv.invoice_no_formatted || inv.invoice_no || inv.id);
  const token = inv.token;
  const pdfUrl = token
    ? `${apiUrl}/invoices/pdf/${invoiceId}/token:${token}`
    : `${apiUrl}/invoices/pdf/${invoiceId}`;
  return { invoice_id: invoiceId, invoice_number: invoiceNumber, pdf_url: pdfUrl, raw: data };
}
