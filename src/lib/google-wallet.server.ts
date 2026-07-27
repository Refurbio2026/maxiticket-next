// Server-only Google Wallet helper.
//
// Builds a signed "Add to Google Wallet" save link (RS256 JWT) for an event
// ticket. Uses only Node's built-in crypto — no external dependency and no
// outbound API call: the EventTicketClass and EventTicketObject are embedded
// in the JWT payload, so Google creates/updates them when the user taps the
// link. This keeps the flow fully self-contained and testable.
//
// Activation: set two secrets in Lovable Cloud (Project → Settings → Secrets):
//   GOOGLE_WALLET_ISSUER_ID              e.g. 3388000000022123456
//   GOOGLE_WALLET_SERVICE_ACCOUNT_JSON   the full service-account JSON (one line)
// Optional:
//   GOOGLE_WALLET_ISSUER_NAME            display name (default "Vipky.sk")
//
// Until both secrets exist, buildGoogleWalletSaveLink() returns a graceful
// { ok: false, reason: "not_configured" } result and the UI shows a toast
// instead of crashing.
//
// The .server.ts suffix keeps this file (and the private key handling) out of
// the client bundle.

import crypto from "node:crypto";

export type GoogleWalletTicketInput = {
  ticketId: string;
  qrValue: string;
  eventTitle: string;
  eventDateISO?: string;
  venue?: string;
  city?: string;
  seatLabel?: string;
  holderName?: string;
  originUrl?: string;
};

export type WalletLinkResult =
  | { ok: true; url: string }
  | { ok: false; reason: "not_configured" | "error"; message: string };

type GoogleConfig = {
  issuerId: string;
  clientEmail: string;
  privateKey: string;
  issuerName: string;
};

// Read per-request (Cloudflare Workers bind env at request time — never read
// process.env at module scope). Returns null when not configured; throws only
// when the provided credentials are malformed.
function readGoogleConfig(): GoogleConfig | null {
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
  const saJson = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON;
  if (!issuerId || !saJson) return null;

  let sa: { client_email?: string; private_key?: string };
  try {
    sa = JSON.parse(saJson);
  } catch {
    throw new Error("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON nie je platný JSON.");
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service account JSON neobsahuje client_email alebo private_key.");
  }
  // In env vars newlines are often escaped as literal \n — normalize them.
  const privateKey = sa.private_key.replace(/\\n/g, "\n");
  return {
    issuerId,
    clientEmail: sa.client_email,
    privateKey,
    issuerName: process.env.GOOGLE_WALLET_ISSUER_NAME || "Vipky.sk",
  };
}

export function isGoogleWalletConfigured(): boolean {
  try {
    return readGoogleConfig() !== null;
  } catch {
    // Malformed credentials count as "configured but broken" — surface as not
    // configured for status checks; buildGoogleWalletSaveLink reports the error.
    return false;
  }
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// Google Wallet class/object ids must match [A-Za-z0-9._-].
function idSuffix(raw: string): string {
  const cleaned = String(raw).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100);
  return cleaned || "x";
}

export function buildGoogleWalletSaveLink(input: GoogleWalletTicketInput): WalletLinkResult {
  let config: GoogleConfig | null;
  try {
    config = readGoogleConfig();
  } catch (e) {
    return { ok: false, reason: "error", message: (e as Error).message };
  }
  if (!config) {
    return {
      ok: false,
      reason: "not_configured",
      message:
        "Google Wallet zatiaľ nie je nakonfigurovaný. Administrátor musí doplniť GOOGLE_WALLET_ISSUER_ID a GOOGLE_WALLET_SERVICE_ACCOUNT_JSON do Secrets.",
    };
  }

  try {
    const { issuerId, clientEmail, privateKey, issuerName } = config;

    const classId = `${issuerId}.${idSuffix("evt_" + input.eventTitle)}`;
    const objectId = `${issuerId}.${idSuffix("tkt_" + input.ticketId)}`;

    // Only include dateTime if we got a parseable date — an invalid value would
    // make Google reject the whole pass.
    const hasValidDate = !!input.eventDateISO && !Number.isNaN(Date.parse(input.eventDateISO));

    const eventTicketClass: Record<string, unknown> = {
      id: classId,
      issuerName,
      reviewStatus: "UNDER_REVIEW",
      eventName: {
        defaultValue: { language: "sk", value: input.eventTitle || "Podujatie" },
      },
    };
    if (input.venue) {
      eventTicketClass.venue = {
        name: { defaultValue: { language: "sk", value: input.venue } },
        address: { defaultValue: { language: "sk", value: input.city || input.venue } },
      };
    }
    if (hasValidDate) {
      eventTicketClass.dateTime = { start: input.eventDateISO };
    }

    const eventTicketObject: Record<string, unknown> = {
      id: objectId,
      classId,
      state: "ACTIVE",
      hexBackgroundColor: "#e11d2a",
      barcode: { type: "QR_CODE", value: input.qrValue, alternateText: input.qrValue },
    };
    if (input.seatLabel) {
      eventTicketObject.seatInfo = {
        seat: { defaultValue: { language: "sk", value: input.seatLabel } },
      };
    }
    if (input.holderName) {
      eventTicketObject.ticketHolderName = input.holderName;
    }

    const claims = {
      iss: clientEmail,
      aud: "google",
      typ: "savetowallet",
      iat: Math.floor(Date.now() / 1000),
      origins: input.originUrl ? [input.originUrl] : [],
      payload: {
        eventTicketClasses: [eventTicketClass],
        eventTicketObjects: [eventTicketObject],
      },
    };

    const header = { alg: "RS256", typ: "JWT" };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(privateKey);
    const jwt = `${signingInput}.${b64url(signature)}`;

    return { ok: true, url: `https://pay.google.com/gp/v/save/${jwt}` };
  } catch (e) {
    return {
      ok: false,
      reason: "error",
      message: "Google Wallet: podpísanie zlyhalo — skontroluj private_key v service account JSON.",
    };
  }
}
