// Apple Wallet — podpísaný `.pkpass` pre jednu vstupenku.
//
// Doteraz tu bola zátka, ktorá vracala „generátor zatiaľ nie je aktivovaný".
// Toto je ten generátor.
//
// ČO NA TO TREBA MAŤ (bez toho sa pass podpísať nedá a je to na Patrikovi):
//   * členstvo v Apple Developer Program,
//   * certifikát typu **Pass Type ID** k identifikátoru `pass.…` (z neho sa
//     exportuje PEM s certifikátom aj privátnym kľúčom),
//   * medzičlánok **Apple WWDR** (tiež PEM).
// Kľúč od Apple sa nedá ničím obísť ani vygenerovať — Wallet neprijme pass,
// ktorý nie je podpísaný certifikátom priradeným k tomu `passTypeIdentifier`.
//
// PREČO openssl A NIE BALÍK: podpis je PKCS#7 odpojený (detached, DER) a node
// to natívne nevie. `openssl` je na stroji a projekt rovnako rieši aj kľúče
// GP webpay — žiadna nová závislosť.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hodnota } from "../pristupy.server";
import { siteUrl } from "../site-url.server";
import { manifest, postavPassJson, suboryPassu, zip, type Subor } from "./pkpass";

const spustit = promisify(execFile);

/** Kde na serveri hľadáme ikony pre pass. */
const IKONA = "ikona-192.png";

export type AppleKonfiguracia = {
  passTypeIdentifier: string;
  teamIdentifier: string;
  organizationName: string;
  /** PEM s certifikátom aj privátnym kľúčom. */
  certifikat: string;
  /** Prázdne, keď kľúč nie je zašifrovaný. */
  heslo: string | undefined;
  /** PEM medzičlánku Apple WWDR. */
  wwdr: string;
};

function zoSuboru(cesta: string | undefined): string | undefined {
  if (!cesta) return undefined;
  try {
    return fs.readFileSync(cesta, "utf8");
  } catch {
    return undefined;
  }
}

/** PEM sa v `.env` zvykne uložiť na jeden riadok s „\n" ako dvoma znakmi. */
function normalizujPem(pem: string | undefined): string | undefined {
  if (!pem) return undefined;
  const t = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
  return t.includes("BEGIN") ? t : undefined;
}

/**
 * Konfigurácia Apple Wallet. `null` znamená „nedá sa podpisovať".
 *
 * Identifikátory sa berú z `wallet_settings` (nastavuje ich admin), certifikáty
 * z prístupov alebo zo súboru na serveri — rovnako ako kľúče GP webpay.
 * Privátny kľúč v databáze nechceme, keď sa dá dať na disk.
 */
export async function appleKonfiguracia(): Promise<AppleKonfiguracia | null> {
  const { data } = await supabaseAdmin
    .from("wallet_settings")
    .select(
      "apple_enabled, apple_pass_type_identifier, apple_team_identifier, apple_organization_name",
    )
    .eq("id", true)
    .maybeSingle();

  if (!data?.apple_enabled) return null;

  const passTypeIdentifier =
    data.apple_pass_type_identifier?.trim() || process.env.APPLE_WALLET_PASS_TYPE_ID?.trim() || "";
  const teamIdentifier =
    data.apple_team_identifier?.trim() || process.env.APPLE_WALLET_TEAM_ID?.trim() || "";
  const organizationName = data.apple_organization_name?.trim() || "MaxiTicket s.r.o.";

  const certifikat =
    normalizujPem(hodnota("apple-wallet", "APPLE_WALLET_CERT")) ??
    normalizujPem(zoSuboru(process.env.APPLE_WALLET_CERT_FILE));
  const wwdr =
    normalizujPem(hodnota("apple-wallet", "APPLE_WALLET_WWDR")) ??
    normalizujPem(zoSuboru(process.env.APPLE_WALLET_WWDR_FILE));

  if (!passTypeIdentifier || !teamIdentifier || !certifikat || !wwdr) return null;

  return {
    passTypeIdentifier,
    teamIdentifier,
    organizationName,
    certifikat,
    wwdr,
    heslo: hodnota("apple-wallet", "APPLE_WALLET_CERT_PASSPHRASE") || undefined,
  };
}

export async function jeAppleNastavene(): Promise<boolean> {
  return (await appleKonfiguracia()) !== null;
}

/** Čo konkrétne chýba — aby admin nehádal. */
export async function coChybaAppleWallet(): Promise<string[]> {
  const chyby: string[] = [];
  const { data } = await supabaseAdmin
    .from("wallet_settings")
    .select("apple_enabled, apple_pass_type_identifier, apple_team_identifier")
    .eq("id", true)
    .maybeSingle();

  if (!data?.apple_enabled) chyby.push("Apple Wallet je v nastaveniach vypnutý.");
  if (!data?.apple_pass_type_identifier?.trim() && !process.env.APPLE_WALLET_PASS_TYPE_ID) {
    chyby.push("Chýba Pass Type ID (napr. pass.eu.eticketo.vstupenka).");
  }
  if (!data?.apple_team_identifier?.trim() && !process.env.APPLE_WALLET_TEAM_ID) {
    chyby.push("Chýba Team ID z Apple Developer účtu.");
  }
  if (
    !normalizujPem(hodnota("apple-wallet", "APPLE_WALLET_CERT")) &&
    !normalizujPem(zoSuboru(process.env.APPLE_WALLET_CERT_FILE))
  ) {
    chyby.push("Chýba certifikát Pass Type ID v PEM (certifikát aj privátny kľúč).");
  }
  if (
    !normalizujPem(hodnota("apple-wallet", "APPLE_WALLET_WWDR")) &&
    !normalizujPem(zoSuboru(process.env.APPLE_WALLET_WWDR_FILE))
  ) {
    chyby.push("Chýba medzičlánok Apple WWDR v PEM.");
  }
  return chyby;
}

/** Ikony passu. Apple vyžaduje `icon.png`; logo je voliteľné, ale pekné. */
function ikony(): Subor[] {
  const kandidati = [
    path.join(process.cwd(), ".output", "public", IKONA),
    path.join(process.cwd(), "public", IKONA),
  ];
  for (const c of kandidati) {
    try {
      const obsah = fs.readFileSync(c);
      return [
        { nazov: "icon.png", obsah },
        { nazov: "icon@2x.png", obsah },
        { nazov: "logo.png", obsah },
      ];
    } catch {
      /* skúsi sa ďalšia cesta */
    }
  }
  // Bez ikony Wallet pass odmietne, tak to povieme zrozumiteľne.
  throw new Error(`Ikona ${IKONA} sa nenašla — bez nej Apple pass neprijme.`);
}

/**
 * Podpíše manifest. Výsledok je odpojený PKCS#7 v DER, ako Apple čaká.
 *
 * Certifikát ani kľúč sa nikam neukladajú natrvalo: idú do priečinka
 * s právami 700 a hneď po podpise sa maže celý.
 */
async function podpis(manifestJson: Buffer, k: AppleKonfiguracia): Promise<Buffer> {
  const priecinok = fs.mkdtempSync(path.join(os.tmpdir(), "pkpass-"), { encoding: "utf8" });
  try {
    fs.chmodSync(priecinok, 0o700);
    const cesty = {
      manifest: path.join(priecinok, "manifest.json"),
      cert: path.join(priecinok, "cert.pem"),
      wwdr: path.join(priecinok, "wwdr.pem"),
      podpis: path.join(priecinok, "signature"),
    };
    fs.writeFileSync(cesty.manifest, manifestJson, { mode: 0o600 });
    fs.writeFileSync(cesty.cert, k.certifikat, { mode: 0o600 });
    fs.writeFileSync(cesty.wwdr, k.wwdr, { mode: 0o600 });

    const argumenty = [
      "smime",
      "-binary",
      "-sign",
      "-certfile",
      cesty.wwdr,
      "-signer",
      cesty.cert,
      "-inkey",
      cesty.cert,
      "-in",
      cesty.manifest,
      "-out",
      cesty.podpis,
      "-outform",
      "DER",
    ];
    // Heslo ide cez `env:`, nie ako argument — argumenty vidno v `ps`.
    if (k.heslo) argumenty.push("-passin", "env:PKPASS_HESLO");

    await spustit("openssl", argumenty, {
      env: { ...process.env, ...(k.heslo ? { PKPASS_HESLO: k.heslo } : {}) },
      timeout: 20000,
    });

    return fs.readFileSync(cesty.podpis);
  } finally {
    fs.rmSync(priecinok, { recursive: true, force: true });
  }
}

export type VstupenkaNaPass = {
  id: string;
  qrKod: string;
  sedadlo: string | null;
  podujatie: string;
  datum: string;
  cas: string | null;
  miesto: string | null;
  mesto: string | null;
  kupujuci: string | null;
  objednavka: string | null;
  organizator: string | null;
};

/**
 * Zloží a podpíše `.pkpass`.
 *
 * Vracia hotový súbor. Keď nie je čím podpisovať, vyhodí chybu s tým, čo
 * chýba — volajúci to má ukázať adminovi, nie zákazníkovi.
 */
export async function vytvorPkpass(
  v: VstupenkaNaPass,
  /** Len pre testy: podstrčená konfigurácia namiesto čítania z nastavení. */
  konfig?: AppleKonfiguracia,
): Promise<Buffer> {
  const k = konfig ?? (await appleKonfiguracia());
  if (!k) {
    const chyby = await coChybaAppleWallet();
    throw new Error(`Apple Wallet nie je nastavený: ${chyby.join(" ")}`);
  }

  const passJson = postavPassJson({
    passTypeIdentifier: k.passTypeIdentifier,
    teamIdentifier: k.teamIdentifier,
    organizationName: k.organizationName,
    serialNumber: v.id,
    qrKod: v.qrKod,
    podujatie: v.podujatie,
    datum: v.datum,
    cas: v.cas,
    miesto: v.miesto,
    mesto: v.mesto,
    sedadlo: v.sedadlo,
    kupujuci: v.kupujuci,
    objednavka: v.objednavka,
    odkaz: `${siteUrl().replace(/\/$/, "")}/account`,
    organizator: v.organizator,
  });

  const zaklad = suboryPassu(passJson, ikony());
  const manifestJson = Buffer.from(JSON.stringify(manifest(zaklad), null, 1), "utf8");
  const signature = await podpis(manifestJson, k);

  return zip([
    ...zaklad,
    { nazov: "manifest.json", obsah: manifestJson },
    { nazov: "signature", obsah: signature },
  ]);
}

/** Náhľad podpisu pre admina — nikdy nie kľúč, len čím je podpísaný. */
export function odtlacokCertifikatu(pem: string): string | null {
  const m = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/);
  if (!m) return null;
  const der = Buffer.from(m[1].replace(/\s+/g, ""), "base64");
  return crypto.createHash("sha1").update(der).digest("hex").match(/.{2}/g)?.join(":") ?? null;
}
