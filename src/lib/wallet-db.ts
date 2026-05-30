// LocalStorage layer for Wallet (Apple/Google) settings and generator stubs.
// Real signing requires Apple Pass Type cert + WWDR (PKCS#7) and Google
// service account JWT. This module exposes a single source of truth for
// configuration status so UI can show graceful "not configured" states until
// credentials are wired (Phase 2/3).

import type { IssuedTicket } from "./ticketing-db";

const SETTINGS_KEY = "mt_wallet_settings";

export type WalletSettings = {
  apple: {
    enabled: boolean;
    pass_type_identifier: string;   // e.g. "pass.com.maxiticket.event"
    team_identifier: string;
    organization_name: string;
    cert_uploaded: boolean;         // tracks if .p12 was provided (server-side)
    wwdr_uploaded: boolean;
  };
  google: {
    enabled: boolean;
    issuer_id: string;
    issuer_name: string;
    service_account_uploaded: boolean;
  };
};

const defaultSettings: WalletSettings = {
  apple: {
    enabled: false,
    pass_type_identifier: "",
    team_identifier: "",
    organization_name: "MAXITICKET",
    cert_uploaded: false,
    wwdr_uploaded: false,
  },
  google: {
    enabled: false,
    issuer_id: "",
    issuer_name: "MAXITICKET",
    service_account_uploaded: false,
  },
};

const isBrowser = () => typeof window !== "undefined";

export function getWalletSettings(): WalletSettings {
  if (!isBrowser()) return defaultSettings;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<WalletSettings>;
    return {
      apple: { ...defaultSettings.apple, ...(parsed.apple ?? {}) },
      google: { ...defaultSettings.google, ...(parsed.google ?? {}) },
    };
  } catch {
    return defaultSettings;
  }
}

export function setWalletSettings(s: WalletSettings) {
  if (!isBrowser()) return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function isAppleConfigured(s = getWalletSettings()) {
  return (
    s.apple.enabled &&
    !!s.apple.pass_type_identifier &&
    !!s.apple.team_identifier &&
    s.apple.cert_uploaded &&
    s.apple.wwdr_uploaded
  );
}

export function isGoogleConfigured(s = getWalletSettings()) {
  return s.google.enabled && !!s.google.issuer_id && s.google.service_account_uploaded;
}

// -------- Generator stubs (Phase 1) --------
// In Phase 2/3 these become server functions that produce a signed .pkpass /
// JWT-signed Google Wallet save link. For now they return a structured
// "not configured" result so UI flows are wired correctly end-to-end.

export type WalletPassResult =
  | { ok: true; url: string }
  | { ok: false; reason: "not_configured" | "error"; message: string };

export async function generateApplePass(_ticket: IssuedTicket): Promise<WalletPassResult> {
  if (!isAppleConfigured()) {
    return {
      ok: false,
      reason: "not_configured",
      message:
        "Apple Wallet zatiaľ nie je nakonfigurovaný. Administrátor musí pridať Pass Type ID, Team ID a certifikáty v Systém → Wallet nastavenia.",
    };
  }
  // Placeholder until real .pkpass signing is wired
  return { ok: false, reason: "error", message: "Apple Wallet generator zatiaľ nie je aktivovaný." };
}

export async function generateGoogleWalletLink(_ticket: IssuedTicket): Promise<WalletPassResult> {
  if (!isGoogleConfigured()) {
    return {
      ok: false,
      reason: "not_configured",
      message:
        "Google Wallet zatiaľ nie je nakonfigurovaný. Administrátor musí pridať Issuer ID a service account v Systém → Wallet nastavenia.",
    };
  }
  return { ok: false, reason: "error", message: "Google Wallet generator zatiaľ nie je aktivovaný." };
}
