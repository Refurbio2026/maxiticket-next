// Platba z brány ako účtovný pohyb.
//
// PREČO: platba kartou neprejde cez bankový účet ako samostatný pohyb —
// na účet príde až súhrnná výplata za mnoho platieb. V účtovnom pohľade
// („Výpisy z banky") tak peniaze z brány úplne chýbali a nedalo sa z neho
// prečítať, koľko za deň prišlo.
//
// Riešenie: brána dostane vlastný účet typu `psp` a každá jej potvrdená
// platba sa doň zapíše ako pohyb. Nie je to výpis z banky, je to kniha
// platieb brány — a presne tú treba, keď sa výplata na bankový účet raz
// bude odsúhlasovať so súčtom platieb, ktoré ju tvoria.
import { normalizujSymbol } from "./normalize";
import type { NormalizovanaTransakcia } from "./normalize";

export type PlatbaBrany = {
  id: string;
  provider: string;
  provider_payment_id: string | null;
  amount: number;
  currency: string | null;
  status: string;
  created_at: string;
};

export type ObjednavkaKPlatbe = {
  payment_vs: number | string | null;
  customer_name: string | null;
  customer_email: string | null;
};

/** Stavy, pri ktorých sa peniaze naozaj pohli. */
export const ZAPISATELNE = new Set(["paid", "refunded"]);

export function zapisatelna(p: PlatbaBrany): boolean {
  return ZAPISATELNE.has(p.status) && Math.abs(p.amount) > 0;
}

/**
 * Platba brány → pohyb.
 *
 * `external_id` stojí na id platby, nie na referencii brány: tá istá
 * referencia sa objaví pri platbe aj pri jej vrátení a dva rôzne pohyby
 * by inak dostali ten istý kľúč.
 */
export function naPohyb(p: PlatbaBrany, o: ObjednavkaKPlatbe | null): NormalizovanaTransakcia {
  const vs = normalizujSymbol(o?.payment_vs ?? null);
  const den = p.created_at.slice(0, 10);
  return {
    external_id: `platba:${p.id}`,
    booked_at: new Date(p.created_at).toISOString(),
    value_date: den,
    amount: p.amount,
    currency: (p.currency || "EUR").toUpperCase(),
    vs_normalized: vs,
    variable_symbol: vs,
    specific_symbol: null,
    constant_symbol: null,
    counterparty_iban: null,
    counterparty_name: o?.customer_name ?? null,
    message:
      `${p.status === "refunded" ? "Vrátenie" : "Platba"} cez bránu` +
      (p.provider_payment_id ? ` · ${p.provider_payment_id}` : "") +
      (o?.customer_email ? ` · ${o.customer_email}` : ""),
    provider_tx_id: p.provider_payment_id,
  };
}
