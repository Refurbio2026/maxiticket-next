// Payment terminal adapter (USB).
// Mock implementácia. Reálne napojenie sa doplní cez WebUSB / WebHID alebo
// natívneho bridge daemon-a poskytovateľa terminálu (napr. SumUp, Worldline, GP Tom).

export type TerminalStatus = "disconnected" | "connected" | "busy" | "error";

export type TerminalPaymentResult = {
  ok: boolean;
  tx_id: string;
  amount: number;
  currency: string;
  order_id: string;
  auth_code?: string;
  card_brand?: string;
  card_last4?: string;
  finished_at: string;
  error?: string;
};

export interface PaymentTerminalAdapter {
  connectTerminal(): Promise<TerminalStatus>;
  sendPayment(amount: number, currency: string, orderId: string): Promise<TerminalPaymentResult>;
  checkPaymentStatus(txId: string): Promise<TerminalStatus>;
  cancelPayment(txId: string): Promise<boolean>;
  printTerminalReceipt(txId: string): Promise<boolean>;
}

let status: TerminalStatus = "disconnected";

export const paymentTerminal: PaymentTerminalAdapter = {
  async connectTerminal() {
    await wait(300);
    status = "connected";
    return status;
  },
  async sendPayment(amount, currency, order_id) {
    if (status !== "connected") await this.connectTerminal();
    status = "busy";
    await wait(700);
    status = "connected";
    return {
      ok: true,
      tx_id: "TX-" + Date.now(),
      amount, currency, order_id,
      auth_code: Math.random().toString(36).slice(2, 8).toUpperCase(),
      card_brand: "VISA",
      card_last4: String(1000 + Math.floor(Math.random() * 8999)),
      finished_at: new Date().toISOString(),
    };
  },
  async checkPaymentStatus() { return status; },
  async cancelPayment() { await wait(200); status = "connected"; return true; },
  async printTerminalReceipt() { await wait(200); return true; },
};

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
