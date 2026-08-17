// Server-only customer-support assistant. Calls an OpenAI-compatible Chat
// Completions API. Activates automatically once an API key is configured;
// until then it returns a graceful "not configured" result.
//
// Secrets (set in Lovable Cloud / project env):
//   OPENAI_API_KEY        required to enable the bot
//   OPENAI_MODEL          optional, default "gpt-4o-mini"
//   OPENAI_BASE_URL       optional, default "https://api.openai.com/v1"
//                         (any OpenAI-compatible gateway works)
//
// The .server.ts suffix keeps the API key out of the client bundle.

import { SUPPORT_KB } from "./support-kb";

export type ChatMsg = { role: "user" | "assistant"; content: string };

export type BotResult =
  | { ok: true; reply: string }
  | { ok: false; reason: "not_configured" | "error"; message: string };

function readConfig() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.SUPPORT_AI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  return { apiKey, baseUrl, model };
}

export function isSupportConfigured(): boolean {
  return readConfig() !== null;
}

const LANG_NAME: Record<string, string> = {
  sk: "Slovak",
  en: "English",
  de: "German",
  hu: "Hungarian",
};

export async function askSupportBot(messages: ChatMsg[], lang: string): Promise<BotResult> {
  const config = readConfig();
  if (!config) {
    return {
      ok: false,
      reason: "not_configured",
      message:
        "Chat podpora zatiaľ nie je aktivovaná. Administrátor musí doplniť OPENAI_API_KEY do Secrets.",
    };
  }

  const langName = LANG_NAME[lang] ?? "Slovak";
  const system =
    `You are the friendly virtual customer-support assistant for the Slovak online ticketing ` +
    `platform vipky.sk (MaxiTicket). Help visitors with buying tickets, payments, QR tickets, ` +
    `wallets, invoices, accounts, entry and refunds. Rules:\n` +
    `- ALWAYS reply in ${langName}.\n` +
    `- Be concise, warm and practical. Prefer short answers and clear steps.\n` +
    `- Answer ONLY topics about this platform, tickets, orders, payments and events. Politely ` +
    `decline unrelated topics.\n` +
    `- You have NO access to the user's account or a specific order. Never invent order numbers, ` +
    `prices, dates or policies. If asked about a specific order, explain where they can find it ` +
    `(Môj účet / email) or point them to the contact page.\n` +
    `- Base every factual answer on the knowledge base below.\n\n` +
    `KNOWLEDGE BASE:\n${SUPPORT_KB}`;

  const body = {
    model: config.model,
    messages: [
      { role: "system", content: system },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    temperature: 0.3,
    max_tokens: 500,
  };

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, reason: "error", message: `AI odpoveď zlyhala (${res.status}).` };
    }
    const data = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) return { ok: false, reason: "error", message: "Asistent vrátil prázdnu odpoveď." };
    return { ok: true, reply };
  } catch (e) {
    return { ok: false, reason: "error", message: (e as Error).message || "Neznáma chyba" };
  }
}
