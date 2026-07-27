// HMAC-signed QR token utilities (server only).
// Token format: MT2.<ticketUuidNoDashes>.<base64urlHmac8>
import crypto from "crypto";

function getSecret(): string {
  // SECURITY: never fall back to a hard-coded default — a known signing key
  // would let anyone forge valid ticket tokens. Require a real secret.
  const secret = process.env.TICKET_QR_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "Chýba TICKET_QR_SECRET (alebo SUPABASE_SERVICE_ROLE_KEY) — podpisovanie vstupeniek je vypnuté.",
    );
  }
  return secret;
}

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function signTicket(ticketId: string): string {
  const id = ticketId.replace(/-/g, "");
  const sig = crypto.createHmac("sha256", getSecret()).update(id).digest().slice(0, 8);
  return `MT2.${id}.${b64url(sig)}`;
}

// Mint a fresh ticket id + its signed QR token together. Used by the payment
// settlement paths so every ticket gets a verifiable MT2.* token (never a
// plain random string).
export function newSignedTicket(): { id: string; token: string } {
  const id = crypto.randomUUID();
  return { id, token: signTicket(id) };
}

/** Returns full UUID with dashes if valid, else null. */
export function verifyTicket(token: string): string | null {
  if (!token) return null;
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "MT2") return null;
  const [, id, sig] = parts;
  if (!/^[0-9a-f]{32}$/i.test(id)) return null;
  const expected = b64url(
    crypto.createHmac("sha256", getSecret()).update(id.toLowerCase()).digest().slice(0, 8),
  );
  // Constant-time comparison to avoid leaking signature bytes via timing.
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  // reformat to UUID
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`.toLowerCase();
}
