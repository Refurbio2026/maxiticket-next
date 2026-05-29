// ORP / eKasa fiscal adapter (Finančná správa SR).
// Mock implementácia. Reálne napojenie sa doplní podľa dokumentácie
// poskytovateľa ORP brány alebo eKasa providera.

import {
  addFiscalReceipt, cancelFiscalReceiptInStore, getFiscalReceipts,
  getFiscalSettings, saveFiscalSettings,
  type FiscalReceipt as StoredFiscalReceipt,
  type FiscalSettings,
} from "./pos-db";

export type FiscalReceipt = StoredFiscalReceipt;

export interface OrpAdapter {
  saveSettings(s: FiscalSettings): void;
  testConnection(): Promise<{ ok: boolean; latency_ms: number; error?: string }>;
  connect(): Promise<{ ok: boolean; error?: string }>;
  disconnect(): Promise<{ ok: boolean }>;
  createReceipt(input: {
    organizer_id: string;
    sale_id?: string;
    total: number;
    payment_method: string;
    items: { name: string; qty: number; unit_price: number }[];
  }): Promise<FiscalReceipt>;
  cancelReceipt(receiptId: string): Promise<boolean>;
  getReceiptStatus(receiptId: string): Promise<"issued" | "cancelled" | "unknown">;
  getReceiptNumber(): string;
  sendReceiptToFiscalSystem(receipt: FiscalReceipt): Promise<{ ok: boolean; error?: string }>;
  printFiscalReceipt(receipt: FiscalReceipt): Promise<boolean>;
  // Legacy aliases
  createFiscalReceipt: OrpAdapter["createReceipt"];
  cancelFiscalReceipt(id: string): Promise<boolean>;
}

let counter = 1;

export const orpAdapter: OrpAdapter = {
  saveSettings(s) { saveFiscalSettings(s); },
  getReceiptNumber() {
    const y = new Date().getFullYear();
    return `ORP-${y}-${String(counter++).padStart(6, "0")}`;
  },
  async testConnection() {
    const start = Date.now();
    await wait(250);
    const s = getFiscalSettings();
    saveFiscalSettings({ ...s, connection_status: "connected", last_tested_at: new Date().toISOString(), last_error: undefined });
    return { ok: true, latency_ms: Date.now() - start };
  },
  async connect() {
    await wait(200);
    const s = getFiscalSettings();
    saveFiscalSettings({ ...s, connection_status: "connected", last_tested_at: new Date().toISOString() });
    return { ok: true };
  },
  async disconnect() {
    await wait(150);
    const s = getFiscalSettings();
    saveFiscalSettings({ ...s, connection_status: "disconnected" });
    return { ok: true };
  },
  async createReceipt(input) {
    await wait(120);
    const settings = getFiscalSettings();
    const receipt_number = this.getReceiptNumber();
    const r: FiscalReceipt = {
      id: "ORP-" + Date.now(),
      receipt_number,
      organizer_id: input.organizer_id,
      sale_id: input.sale_id,
      ico: settings.ico || "00000000",
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
  async cancelReceipt(id) {
    await wait(120);
    cancelFiscalReceiptInStore(id);
    return true;
  },
  async getReceiptStatus(id) {
    const r = getFiscalReceipts().find((x) => x.id === id);
    return r?.status || "unknown";
  },
  async sendReceiptToFiscalSystem() { await wait(150); return { ok: true }; },
  async printFiscalReceipt() { await wait(150); return true; },
  createFiscalReceipt(input) { return this.createReceipt(input); },
  async cancelFiscalReceipt(id) { return this.cancelReceipt(id); },
};

// Back-compat alias for older imports.
export const fiscal = orpAdapter;

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
