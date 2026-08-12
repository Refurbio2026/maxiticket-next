// Server-only odosielanie e-mailov cez Resend (HTTP API, žiadna extra závislosť).
// Aktivuje sa automaticky, len čo je nastavený kľúč; dovtedy vracia
// „not_configured" a volajúci to potichu preskočí — rovnako ako support bot.
//
// Secrets:
//   RESEND_API_KEY   povinné, inak je odosielanie vypnuté
//   MAIL_FROM        odosielateľ, default "vipky.sk <listky@vipky.sk>"
//                    (doména musí byť v Resende overená, inak API odmietne)
//   MAIL_REPLY_TO    voliteľné
//
// Prípona .server.ts drží kľúč mimo klientskeho bundlu.

export type MailAttachment = {
  filename: string;
  /** Obsah v base64 (bez data: prefixu). */
  content: string;
};

export type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: MailAttachment[];
};

export type SendMailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: "not_configured" | "error"; message: string };

function readConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    from: process.env.MAIL_FROM || "vipky.sk <listky@vipky.sk>",
    replyTo: process.env.MAIL_REPLY_TO || undefined,
  };
}

export function isMailConfigured(): boolean {
  return readConfig() !== null;
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const cfg = readConfig();
  if (!cfg) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Odosielanie e-mailov nie je aktivované. Doplň RESEND_API_KEY do secrets.",
    };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: cfg.replyTo,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
        })),
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      return { ok: false, reason: "error", message: `Resend (${res.status}): ${body}` };
    }
    let id: string | null = null;
    try {
      id = (JSON.parse(body) as { id?: string }).id ?? null;
    } catch {
      /* odpoveď bez tela je v poriadku */
    }
    return { ok: true, id };
  } catch (e) {
    return { ok: false, reason: "error", message: String((e as Error)?.message || e) };
  }
}
