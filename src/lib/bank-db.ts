// Mock Tatra banka Open Banking module
// Persisted in localStorage. Replaceable with real Tatra OB API later.

export type BankAccount = {
  id: string;
  bankName: string;
  accountName: string;
  iban: string;
  currency: string;
  balance: number;
  connected: boolean;
  lastSyncAt: string | null;
};

export type MatchStatus = "matched" | "unmatched" | "pending";

export type BankTransaction = {
  id: string;
  accountId: string;
  date: string; // ISO
  amount: number;
  currency: string;
  counterpartyName: string;
  counterpartyIban: string;
  variableSymbol: string;
  message: string;
  matchStatus: MatchStatus;
  matchedOrderId?: string;
  organizerId?: string;
};

export type SyncLog = {
  id: string;
  accountId: string;
  at: string;
  added: number;
  matched: number;
  unmatched: number;
};

const ACC_KEY = "bank.accounts.v1";
const TX_KEY = "bank.transactions.v1";
const LOG_KEY = "bank.sync_logs.v1";

const ORGANIZERS = ["org_1", "org_2", "org_3"];
const NAMES = [
  "Ján Novák", "Mária Horváthová", "Peter Kováč", "Eva Tóthová",
  "Lukáš Varga", "Andrea Baláž", "Michal Polák", "Zuzana Krištofová",
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function safeStorage() {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function read<T>(key: string, fallback: T): T {
  const s = safeStorage();
  if (!s) return fallback;
  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  const s = safeStorage();
  if (!s) return;
  s.setItem(key, JSON.stringify(value));
}

export function listAccounts(): BankAccount[] {
  return read<BankAccount[]>(ACC_KEY, []);
}

export function listTransactions(): BankTransaction[] {
  return read<BankTransaction[]>(TX_KEY, []).sort((a, b) => b.date.localeCompare(a.date));
}

export function listLogs(): SyncLog[] {
  return read<SyncLog[]>(LOG_KEY, []).sort((a, b) => b.at.localeCompare(a.at));
}

export function connectTatraBanka(): BankAccount {
  const accounts = listAccounts();
  const existing = accounts.find((a) => a.bankName === "Tatra banka");
  if (existing) {
    existing.connected = true;
    write(ACC_KEY, accounts);
    return existing;
  }
  const acc: BankAccount = {
    id: uid(),
    bankName: "Tatra banka",
    accountName: "vipky.sk – hlavný účet",
    iban: "SK89 1100 0000 0029 4512 8765",
    currency: "EUR",
    balance: 28450.75,
    connected: true,
    lastSyncAt: null,
  };
  accounts.push(acc);
  write(ACC_KEY, accounts);
  return acc;
}

export function disconnectAccount(id: string) {
  const accounts = listAccounts().map((a) => (a.id === id ? { ...a, connected: false } : a));
  write(ACC_KEY, accounts);
}

function tryMatch(tx: Omit<BankTransaction, "matchStatus" | "matchedOrderId" | "organizerId">):
  Pick<BankTransaction, "matchStatus" | "matchedOrderId" | "organizerId"> {
  // Mock matching: if variable symbol is "non-empty 6 digits" → matched
  if (/^\d{6,}$/.test(tx.variableSymbol)) {
    return {
      matchStatus: "matched",
      matchedOrderId: `MT-${tx.variableSymbol}`,
      organizerId: ORGANIZERS[parseInt(tx.variableSymbol.slice(-1)) % ORGANIZERS.length],
    };
  }
  if (tx.message.toLowerCase().includes("objednavka")) {
    return { matchStatus: "pending" };
  }
  return { matchStatus: "unmatched" };
}

export function syncAccount(accountId: string): SyncLog {
  const accounts = listAccounts();
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) throw new Error("Účet nenájdený");

  const txs = listTransactions();
  const added: BankTransaction[] = [];
  const count = 8 + Math.floor(Math.random() * 8);
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const amount = +(Math.random() * 180 + 10).toFixed(2);
    const hasVs = Math.random() > 0.25;
    const vs = hasVs ? String(100000 + Math.floor(Math.random() * 900000)) : "";
    const name = NAMES[Math.floor(Math.random() * NAMES.length)];
    const base = {
      id: uid(),
      accountId,
      date: new Date(now - i * 3600_000 - Math.random() * 86400_000).toISOString(),
      amount,
      currency: acc.currency,
      counterpartyName: name,
      counterpartyIban: `SK${10 + Math.floor(Math.random() * 80)} 1100 ${String(Math.floor(Math.random() * 9000) + 1000)} ${String(Math.floor(Math.random() * 9000) + 1000)} ${String(Math.floor(Math.random() * 9000) + 1000)}`,
      variableSymbol: vs,
      message: Math.random() > 0.5 ? `Objednavka ${vs || "?"}` : "Platba za vstupenky",
    };
    added.push({ ...base, ...tryMatch(base) });
  }
  write(TX_KEY, [...txs, ...added]);

  acc.lastSyncAt = new Date().toISOString();
  acc.balance = +(acc.balance + added.reduce((s, t) => s + t.amount, 0)).toFixed(2);
  write(ACC_KEY, accounts);

  const log: SyncLog = {
    id: uid(),
    accountId,
    at: acc.lastSyncAt,
    added: added.length,
    matched: added.filter((t) => t.matchStatus === "matched").length,
    unmatched: added.filter((t) => t.matchStatus === "unmatched").length,
  };
  write(LOG_KEY, [log, ...listLogs()]);
  return log;
}

export function manualMatch(txId: string, orderId: string) {
  const txs = listTransactions().map((t) =>
    t.id === txId ? { ...t, matchStatus: "matched" as const, matchedOrderId: orderId } : t,
  );
  write(TX_KEY, txs);
}

export function resetBankMock() {
  const s = safeStorage();
  s?.removeItem(ACC_KEY);
  s?.removeItem(TX_KEY);
  s?.removeItem(LOG_KEY);
}

// CSV / XLSX (HTML table) export
export function exportCsv(txs: BankTransaction[]): string {
  const header = ["Dátum", "Suma", "Mena", "Odosielateľ", "IBAN", "VS", "Správa", "Stav", "Objednávka"];
  const rows = txs.map((t) => [
    new Date(t.date).toLocaleString("sk-SK"),
    t.amount.toFixed(2),
    t.currency,
    t.counterpartyName,
    t.counterpartyIban,
    t.variableSymbol,
    t.message,
    t.matchStatus,
    t.matchedOrderId ?? "",
  ]);
  return [header, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportXlsx(txs: BankTransaction[]): string {
  // HTML table — Excel opens .xls natively
  const head = ["Dátum", "Suma", "Mena", "Odosielateľ", "IBAN", "VS", "Správa", "Stav", "Objednávka"];
  const rows = txs
    .map(
      (t) =>
        `<tr><td>${new Date(t.date).toLocaleString("sk-SK")}</td><td>${t.amount.toFixed(2)}</td><td>${t.currency}</td><td>${t.counterpartyName}</td><td>${t.counterpartyIban}</td><td>${t.variableSymbol}</td><td>${t.message}</td><td>${t.matchStatus}</td><td>${t.matchedOrderId ?? ""}</td></tr>`,
    )
    .join("");
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/></head><body><table border="1"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}
