// Server-only per-order access token.
//
// Order summaries (customer PII, invoice links) must not be readable by anyone
// who merely guesses/obtains an order UUID. We derive a short HMAC token from
// the order id and require it to reveal personal data. The token is generated
// server-side (embedded in the GoPay return URL) so the buyer's own device can
// see their details, while a stranger with just the order id cannot.
import crypto from "crypto";

function getSecret(): string {
  const secret = process.env.TICKET_QR_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("Chýba TICKET_QR_SECRET (alebo SUPABASE_SERVICE_ROLE_KEY) pre prístupové tokeny.");
  }
  return secret;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function signOrderAccess(orderId: string): string {
  const sig = crypto.createHmac("sha256", getSecret()).update("order:" + orderId).digest().slice(0, 16);
  return b64url(sig);
}

export function verifyOrderAccess(orderId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = signOrderAccess(orderId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
