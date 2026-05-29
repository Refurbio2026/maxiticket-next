// Fiscal adapter — VRP2 / eKasa (Finančná správa SR).
// Mock implementácia. Reálne napojenie podľa oficiálnej dokumentácie
// Finančnej správy SR alebo poskytovateľa eKasa / VRP2 brány.

import {
  addFiscalReceipt, cancelFiscalReceiptInStore, getFiscalReceipts,
  getFiscalSettings, saveFiscalSettings,
  type FiscalReceipt as StoredFiscalReceipt,
} from "./pos-db";

export type FiscalReceipt = StoredFiscalReceipt;

export interface FiscalAdapter {
  testConnection(): Promise<{ ok: boolean; latency_ms: number; error?: string }>;
  createReceipt(input: {
    organizer_id: string;
    organizer_ico?: string;
    sale_id?: string;
    total: number;
    payment_method: string;
    items: { name: string; qty: number; unit_price: number }[];
  }): Promise<FiscalReceipt>;
  // Legacy alias for older callers
  createFiscalReceipt(input: {
    organizer_id?: string;
    organizer_ico?: string;
    sale_id?: string;
    total: number;
    payment_method: string;
    items: { name: string; qty: number; unit_price: number }[];
  }): Promise<FiscalReceipt>;
  sendReceiptToFiscalSystem(receipt: FiscalReceipt): Promise<{ ok: boolean; error?: string }>;
  getReceiptNumber(): string;
  cancelReceipt(receiptId: string): Promise<boolean>;
  cancelFiscalReceipt(receiptId: string): Promise<boolean>;
  getReceiptStatus(receiptId: string): Promise<"issued" | "cancelled" | "unknown">;
  printFiscalReceipt(receipt: FiscalReceipt): Promise<boolean>;
}

let counter = 1;

export const fiscal: FiscalAdapter = {
  getReceiptNumber() {
    const y = new Date().getFullYear();
    return `eKasa-${y}-${String(counter++).padStart(6, "0")}`;
  },
  async testConnection() {
    const start = Date.now();
    await wait(250);
    const s = getFiscalSettings();
    saveFiscalSettings({ ...s, connected: true, last_tested_at: new Date().toISOString() });
    return { ok: true, latency_ms: Date.now() - start };
  },
  async createReceipt(input) {
    await wait(150);
    const settings = getFiscalSettings();
    const receipt_number = this.getReceiptNumber();
    const r: FiscalReceipt = {
      id: "FR-" + Date.now(),
      receipt_number,
      organizer_id: input.organizer_id,
      sale_id: input.sale_id,
      ico: input.organizer_ico || settings.dic || "00000000",
      dkp: settings.pos_code || "0000",
      total: input.total,
      vat_rate: 20,
      payment_method: input.payment_method,
      signature: "OKP-" + Math.random().toString(36).slice(2, 10).toUpperCase(),
      qr_url: "https://ekasa.financnasprava.sk/?r=" + receipt_number,
      status: "issued",
      created_at: new Date().toISOString(),
    };
    addFiscalReceipt(r);
    return r;
  },
  async createFiscalReceipt(input) {
    return this.createReceipt({
      organizer_id: input.organizer_id || "unknown",
      organizer_ico: input.organizer_ico,
      sale_id: input.sale_id,
      total: input.total,
      payment_method: input.payment_method,
      items: input.items,
    });
  },
  async sendReceiptToFiscalSystem() { await wait(200); return { ok: true }; },
  async cancelReceipt(id) {
    await wait(150);
    cancelFiscalReceiptInStore(id);
    return true;
  },
  async cancelFiscalReceipt(id) { return this.cancelReceipt(id); },
  async getReceiptStatus(id) {
    const r = getFiscalReceipts().find((x) => x.id === id);
    return r?.status || "unknown";
  },
  async printFiscalReceipt() { await wait(150); return true; },
};

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
