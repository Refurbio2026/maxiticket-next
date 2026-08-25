// Spoločné rozhranie fakturačných systémov. Aplikácia nesmie vedieť, ktorý
// systém faktúru vystavil — vie len, že ju vystaviť vie a že sa k nej dá
// dostať PDF.
import type { Json } from "@/integrations/supabase/types";
import type { PolozkaKonfiguracie, TestBrany } from "../payment-gateways/types";

export type InvoicingId = "superfaktura" | "faktero";

export type FakturaZakaznik = {
  name: string;
  email: string;
  phone?: string;
};

export type FakturaPolozka = {
  name: string;
  description?: string;
  /** Cena za jednotku bez DPH. */
  unit_price: number;
  quantity: number;
  /** Sadzba DPH v percentách. */
  tax: number;
};

export type FakturaVstup = {
  orderId: string;
  /** Variabilný symbol — ten istý, ktorý šiel do banky. */
  variableSymbol: string;
  customer: FakturaZakaznik;
  items: FakturaPolozka[];
  paymentType?: "card" | "transfer" | "cash";
  /** Popis faktúry; bez neho sa použije text pre vstupenky. */
  name?: string;
  /**
   * `false` vystaví faktúru so splatnosťou (provízia organizátorovi ešte
   * zaplatená nie je). Predvolene `true` — vstupenky sú zaplatené vopred.
   */
  alreadyPaid?: boolean;
};

export type FakturaVysledok = {
  invoice_id: string;
  invoice_number: string;
  /**
   * Adresa, ktorá sa dá uložiť a zákazníkovi poslať. Systém, ktorý vydáva len
   * krátkodobo platné odkazy, sem dá adresu na náš vlastný endpoint.
   */
  pdf_url: string;
  raw: Json;
};

export interface FakturacnySystem {
  id: InvoicingId;
  label: string;
  hint: string;
  isConfigured(): boolean;
  vystav(input: FakturaVstup): Promise<FakturaVysledok>;
  /**
   * Čerstvá adresa na stiahnutie PDF. `null` znamená, že uložená adresa
   * z `vystav()` platí natrvalo a nič doťahovať netreba.
   */
  pdfAdresa(invoiceId: string): Promise<string | null>;
  konfiguracia(): PolozkaKonfiguracie[];
  endpoint(): string;
  /**
   * Testovacia či ostrá prevádzka. Nedá sa vždy odvodiť z adresy — Faktero
   * rozlišuje režim prefixom API kľúča.
   */
  rezim(): "test" | "ostrá" | "neznáma";
  test(): Promise<TestBrany>;
}
