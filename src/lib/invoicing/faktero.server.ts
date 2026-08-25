// Faktero — fakturačný systém, ktorý vystavuje faktúry cez REST API.
//
// Zdroj: https://www.faktero.sk/docs/api
//   POST /api/v1/customers            — odberateľ
//   POST /api/v1/invoices             — faktúra
//   POST /api/v1/invoices/{id}/mark-paid
//   GET  /api/v1/invoices/{id}/pdf    — podpísaná adresa, platná 5 minút
//
// Kľúč `fk_test_…` je testovací režim (faktúry sa reálne neodosielajú),
// `fk_live_…` ostrý.
import type { Json } from "@/integrations/supabase/types";
import { hodnota, polozka } from "../pristupy.server";
import type { PolozkaKonfiguracie, TestBrany } from "../payment-gateways/types";
import type { FakturacnySystem, FakturaVstup, FakturaVysledok } from "./types";

const OSTRA = "https://faktero.sk/api/v1";

function nastavenie(): { apiUrl: string; kluc: string } {
  const apiUrl = (hodnota("faktero", "FAKTERO_API_URL") || OSTRA).replace(/\/+$/, "");
  const kluc = hodnota("faktero", "FAKTERO_API_KEY");
  if (!kluc) {
    throw new Error(
      "Faktero nie je nakonfigurované — doplň API kľúč v Systém → Platobné brány, sekcia Fakturácia.",
    );
  }
  return { apiUrl, kluc };
}

export function jeNakonfigurovane(): boolean {
  return !!hodnota("faktero", "FAKTERO_API_KEY");
}

type Odpoved = { status: number; data: unknown; text: string };

async function volaj(cesta: string, init?: { method?: string; body?: unknown }): Promise<Odpoved> {
  const { apiUrl, kluc } = nastavenie();
  const res = await fetch(`${apiUrl}${cesta}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: `Bearer ${kluc}`,
      Accept: "application/json",
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Chybu vie vrátiť aj ako obyčajný text; zostáva v `text`.
  }
  return { status: res.status, data, text };
}

/** Chybová odpoveď má podľa dokumentácie jednotný tvar. */
function chybaZOdpovede(o: Odpoved): string {
  const e = (o.data as { error?: { code?: string; message?: string } })?.error;
  if (e?.message) return `${e.code ? `${e.code}: ` : ""}${e.message}`;
  return o.text.slice(0, 300);
}

/**
 * Dokumentácia popisuje len časť polí, ktoré databáza Faktera pozná
 * (variabilný symbol, číslo objednávky, externé id). Posielame ich, ale keď
 * ich API odmietne ako neznáme, zopakujeme požiadavku len s tým, čo je
 * zdokumentované — nech kvôli nepovinnému údaju nespadne fakturácia.
 */
async function posliSNadstavbou(
  cesta: string,
  zaklad: Record<string, unknown>,
  navyse: Record<string, unknown>,
): Promise<Odpoved> {
  const prva = await volaj(cesta, { method: "POST", body: { ...zaklad, ...navyse } });
  if (prva.status !== 400 && prva.status !== 422) return prva;

  const druha = await volaj(cesta, { method: "POST", body: zaklad });
  if (druha.status >= 200 && druha.status < 300) {
    console.warn(
      "Faktero odmietlo nepovinné polia, faktúra vystavená bez nich:",
      Object.keys(navyse).join(", "),
      chybaZOdpovede(prva),
    );
  }
  return druha;
}

function dnes(): string {
  return new Date().toISOString().slice(0, 10);
}

function oDni(pocet: number): string {
  return new Date(Date.now() + pocet * 86_400_000).toISOString().slice(0, 10);
}

type FakteroFaktura = {
  id?: string;
  invoice_number?: string;
  number?: string;
  status?: string;
};

export const fakteroSystem: FakturacnySystem = {
  id: "faktero",
  label: "Faktero",
  hint: "Faktúry cez API Faktera. Kľúč fk_test_… je testovací režim, fk_live_… ostrý.",
  isConfigured: jeNakonfigurovane,

  async vystav(input: FakturaVstup): Promise<FakturaVysledok> {
    // 1) Odberateľ. Faktero chce na faktúre `customer_id`, takže ho treba
    //    založiť; `external_id` drží väzbu na našu objednávku.
    const odberatel = await posliSNadstavbou(
      "/customers",
      { name: input.customer.name || "Zákazník", email: input.customer.email || "" },
      {
        ...(input.customer.phone ? { phone: input.customer.phone } : {}),
        external_id: input.orderId,
      },
    );
    if (odberatel.status < 200 || odberatel.status >= 300) {
      throw new Error(
        `Faktero: odberateľa sa nepodarilo založiť (${odberatel.status}): ${chybaZOdpovede(odberatel)}`,
      );
    }
    const customerId = (odberatel.data as { id?: string })?.id;
    if (!customerId) {
      throw new Error(`Faktero: odpoveď bez id odberateľa: ${odberatel.text.slice(0, 200)}`);
    }

    // 2) Faktúra. Zaplatené vstupenky majú splatnosť dnes, provízia
    //    organizátorovi štrnásť dní.
    const zaplatene = input.alreadyPaid !== false;
    const faktura = await posliSNadstavbou(
      "/invoices",
      {
        customer_id: customerId,
        issue_date: dnes(),
        due_date: zaplatene ? dnes() : oDni(14),
        currency: "EUR",
        items: input.items.map((it) => ({
          name: it.name,
          quantity: it.quantity,
          unit: "ks",
          unit_price: it.unit_price,
          vat_rate: it.tax,
        })),
      },
      {
        variable_symbol: input.variableSymbol,
        order_number: input.variableSymbol,
        external_id: input.orderId,
        payment_method: input.paymentType || "card",
        notes: input.name || `Vstupenky – objednávka ${input.variableSymbol}`,
      },
    );
    if (faktura.status < 200 || faktura.status >= 300) {
      throw new Error(
        `Faktero: faktúru sa nepodarilo vystaviť (${faktura.status}): ${chybaZOdpovede(faktura)}`,
      );
    }
    const inv = faktura.data as FakteroFaktura;
    if (!inv?.id) {
      throw new Error(`Faktero: odpoveď bez id faktúry: ${faktura.text.slice(0, 200)}`);
    }

    // 3) Zaplatené vopred označíme ako uhradené. Zlyhanie tu nesmie zhodiť
    //    fakturáciu — faktúra existuje, stav vie admin doplniť.
    if (zaplatene) {
      const oznacenie = await volaj(`/invoices/${encodeURIComponent(inv.id)}/mark-paid`, {
        method: "POST",
      });
      if (oznacenie.status < 200 || oznacenie.status >= 300) {
        console.error(
          "Faktero: faktúru sa nepodarilo označiť ako uhradenú",
          chybaZOdpovede(oznacenie),
        );
      }
    }

    return {
      invoice_id: inv.id,
      invoice_number: String(inv.invoice_number || inv.number || inv.id),
      // Podpísaná adresa z Faktera platí päť minút, takže sa nedá uložiť ani
      // poslať e-mailom. Ukladáme odkaz na seba a čerstvú si vypýtame až pri
      // kliknutí — pozri /api/public/invoices/$orderId/pdf.
      pdf_url: "",
      raw: faktura.data as Json,
    };
  },

  async pdfAdresa(invoiceId: string): Promise<string | null> {
    const o = await volaj(`/invoices/${encodeURIComponent(invoiceId)}/pdf`);
    if (o.status < 200 || o.status >= 300) {
      throw new Error(`Faktero: PDF sa nepodarilo získať (${o.status}): ${chybaZOdpovede(o)}`);
    }
    const url = (o.data as { signed_url?: string })?.signed_url;
    if (!url) throw new Error(`Faktero: odpoveď bez signed_url: ${o.text.slice(0, 200)}`);
    return url;
  },

  konfiguracia(): PolozkaKonfiguracie[] {
    return [
      polozka("faktero", {
        premenna: "FAKTERO_API_KEY",
        nazov: "API kľúč",
        popis: "Z Faktera, sekcia API kľúče. fk_test_… je testovací režim, fk_live_… ostrý",
        povinna: true,
        tajna: true,
      }),
      polozka("faktero", {
        premenna: "FAKTERO_API_URL",
        nazov: "Adresa API",
        popis: `Bez vyplnenia sa použije ${OSTRA}`,
        povinna: false,
      }),
    ];
  },

  endpoint(): string {
    return (hodnota("faktero", "FAKTERO_API_URL") || OSTRA).replace(/\/+$/, "");
  },

  rezim(): "test" | "ostrá" | "neznáma" {
    const kluc = hodnota("faktero", "FAKTERO_API_KEY") || "";
    if (kluc.startsWith("fk_live_")) return "ostrá";
    if (kluc.startsWith("fk_test_")) return "test";
    return "neznáma";
  },

  async test(): Promise<TestBrany> {
    // Zoznam faktúr nič nevytvorí, ale kľúč aj oprávnenia overí naozaj.
    const o = await volaj("/invoices?limit=1");
    if (o.status === 401) return { ok: false, detail: "Faktero kľúč odmietlo (401)." };
    if (o.status === 403) return { ok: false, detail: "Kľúč nemá oprávnenie (403)." };
    if (o.status < 200 || o.status >= 300) {
      return { ok: false, detail: `Faktero odpovedalo ${o.status}: ${chybaZOdpovede(o)}` };
    }
    const kluc = hodnota("faktero", "FAKTERO_API_KEY") || "";
    const rezim = kluc.startsWith("fk_live_")
      ? "ostrý režim"
      : kluc.startsWith("fk_test_")
        ? "testovací režim"
        : "neznámy režim kľúča";
    return { ok: true, detail: `Kľúč platí — ${rezim}.` };
  },
};
