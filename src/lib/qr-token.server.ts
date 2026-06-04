// HMAC-signed QR token utilities (server only).
// Token format: MT2.<ticketUuidNoDashes>.<base64urlHmac8>
import crypto from "crypto";

function getSecret(): string {
  return (
    process.env.TICKET_QR_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "dev-fallback-secret-change-me"
  );
}

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function signTicket(ticketId: string): string {
  const id = ticketId.replace(/-/g, "");
  const sig = crypto.createHmac("sha256", getSecret()).update(id).digest().slice(0, 8);
  return `MT2.${id}.${b64url(sig)}`;
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
  if (sig !== expected) return null;
  // reformat to UUID
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`.toLowerCase();
}
