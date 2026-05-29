// Payment terminal adapter (USB / BT / LAN).
// Mock implementácia. Reálne napojenie sa doplní cez WebUSB / WebHID alebo
// natívneho bridge daemon-a poskytovateľa terminálu (napr. SumUp, Worldline, GP Tom).

import { addTerminalTx, updateTerminalTx, type PaymentTerminalTx } from "./pos-db";
import { uid } from "./local-db";

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
  disconnectTerminal(): Promise<TerminalStatus>;
  sendPayment(amount: number, currency: string, orderId: string, organizerId?: string): Promise<TerminalPaymentResult>;
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
  async disconnectTerminal() {
    await wait(150);
    status = "disconnected";
    return status;
  },
  async sendPayment(amount, currency, order_id, organizerId) {
    if (status !== "connected") await this.connectTerminal();
    status = "busy";
    await wait(700);
    status = "connected";
    const tx_id = "TX-" + Date.now();
    const auth_code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const card_brand = "VISA";
    const card_last4 = String(1000 + Math.floor(Math.random() * 8999));
    const record: PaymentTerminalTx = {
      id: tx_id,
      organizer_id: organizerId || "unknown",
      order_id,
      amount, currency,
      status: "approved",
      auth_code, card_brand, card_last4,
      created_at: new Date().toISOString(),
    };
    addTerminalTx(record);
    return {
      ok: true, tx_id, amount, currency, order_id,
      auth_code, card_brand, card_last4,
      finished_at: record.created_at,
    };
  },
  async checkPaymentStatus() { return status; },
  async cancelPayment(txId: string) {
    await wait(200);
    status = "connected";
    updateTerminalTx(txId, { status: "cancelled" });
    return true;
  },
  async printTerminalReceipt() { await wait(200); return true; },
};

export { uid as _uid };

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
