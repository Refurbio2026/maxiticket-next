// Fiscal adapter — VRP2 / eKasa (Finančná správa SR).
// Mock implementácia. Reálne napojenie podľa oficiálnej dokumentácie
// Finančnej správy SR alebo poskytovateľa eKasa / VRP2 brány.

export type FiscalReceipt = {
  id: string;
  receipt_number: string;
  ico: string;
  dkp: string;
  total: number;
  vat_rate: number;
  payment_method: string;
  created_at: string;
  signature?: string; // OKP / UID
  qr_url?: string;
};

export interface FiscalAdapter {
  createFiscalReceipt(input: {
    organizer_ico: string;
    total: number;
    payment_method: string;
    items: { name: string; qty: number; unit_price: number }[];
  }): Promise<FiscalReceipt>;
  sendReceiptToFiscalSystem(receipt: FiscalReceipt): Promise<{ ok: boolean; error?: string }>;
  getReceiptNumber(): string;
  cancelFiscalReceipt(receiptId: string): Promise<boolean>;
  printFiscalReceipt(receipt: FiscalReceipt): Promise<boolean>;
}

let counter = 1;

export const fiscal: FiscalAdapter = {
  getReceiptNumber() {
    const y = new Date().getFullYear();
    return `eKasa-${y}-${String(counter++).padStart(6, "0")}`;
  },
  async createFiscalReceipt(input) {
    await wait(150);
    const receipt_number = this.getReceiptNumber();
    return {
      id: "FR-" + Date.now(),
      receipt_number,
      ico: input.organizer_ico || "00000000",
      dkp: "0000",
      total: input.total,
      vat_rate: 20,
      payment_method: input.payment_method,
      created_at: new Date().toISOString(),
      signature: "OKP-" + Math.random().toString(36).slice(2, 10).toUpperCase(),
      qr_url: "https://ekasa.financnasprava.sk/?r=" + receipt_number,
    };
  },
  async sendReceiptToFiscalSystem() { await wait(200); return { ok: true }; },
  async cancelFiscalReceipt() { await wait(150); return true; },
  async printFiscalReceipt() { await wait(150); return true; },
};

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
