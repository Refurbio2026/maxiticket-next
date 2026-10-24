// Nastavenie wallet passov (Apple / Google).
//
// Predtým to bol localStorage, takže nastavenie platilo pre jeden prehliadač
// a server o ňom nevedel — pass sa preto nedal vygenerovať podľa toho, čo bolo
// v admine nastavené.
//
// Certifikáty a servisné kľúče sa ukladajú šifrovane medzi prístupy
// (`integration_credentials`, rovnako ako platobné brány), nie do
// `wallet_settings` — tá tabuľka je na údaje, ktoré sa v admine aj ukazujú.
// Hodnoty sa odtiaľ nikdy nevracajú späť do formulára; admin vidí len to,
// či sú vyplnené a odkiaľ pochádzajú.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hodnota, pripravPristupy, ulozPristupy, zdroj } from "./pristupy.server";
import {
  skontrolujApplePem,
  skontrolujServisnyUcet,
  skontrolujWwdr,
} from "./wallet/pristupy-wallet";
import { coChybaAppleWallet } from "./wallet/apple-wallet.server";

export type WalletSettingsRecord = {
  apple: {
    enabled: boolean;
    pass_type_identifier: string;
    team_identifier: string;
    organization_name: string;
    /** Či je podpisový certifikát vyplnený a odkiaľ pochádza. */
    cert_configured: boolean;
    cert_zdroj: "admin" | "server" | null;
    wwdr_configured: boolean;
    wwdr_zdroj: "admin" | "server" | null;
    /** Čo konkrétne ešte chýba, aby sa pass dal podpísať. */
    chyba: string[];
  };
  google: {
    enabled: boolean;
    issuer_id: string;
    issuer_name: string;
    service_account_configured: boolean;
    service_account_zdroj: "admin" | "server" | null;
  };
  updated_at: string | null;
};

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

export const getWalletSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WalletSettingsRecord> => {
    await assertAdmin(context.userId);
    await pripravPristupy();
    const { data } = await supabaseAdmin
      .from("wallet_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();

    return {
      apple: {
        enabled: data?.apple_enabled ?? false,
        pass_type_identifier: data?.apple_pass_type_identifier ?? "",
        team_identifier: data?.apple_team_identifier ?? "",
        organization_name: data?.apple_organization_name ?? "eticketo.eu",
        // Pôvodne sa tu pozeralo na premennú APPLE_WALLET_CERT_P12, ktorú
        // ale nečíta nikto — stav v admine preto nikdy nesedel so skutočnosťou.
        cert_configured: !!hodnota("apple-wallet", "APPLE_WALLET_CERT"),
        cert_zdroj: zdroj("apple-wallet", "APPLE_WALLET_CERT"),
        wwdr_configured: !!hodnota("apple-wallet", "APPLE_WALLET_WWDR"),
        wwdr_zdroj: zdroj("apple-wallet", "APPLE_WALLET_WWDR"),
        chyba: await coChybaAppleWallet(),
      },
      google: {
        enabled: data?.google_enabled ?? false,
        issuer_id: data?.google_issuer_id ?? "",
        issuer_name: data?.google_issuer_name ?? "eticketo.eu",
        service_account_configured: !!hodnota(
          "google-wallet",
          "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON",
        ),
        service_account_zdroj: zdroj("google-wallet", "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON"),
      },
      updated_at: data?.updated_at ?? null,
    };
  });

export const updateWalletSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        apple_enabled: z.boolean(),
        apple_pass_type_identifier: z.string().max(200).optional().nullable(),
        apple_team_identifier: z.string().max(200).optional().nullable(),
        apple_organization_name: z.string().max(200).default("eticketo.eu"),
        google_enabled: z.boolean(),
        google_issuer_id: z.string().max(200).optional().nullable(),
        google_issuer_name: z.string().max(200).default("eticketo.eu"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("wallet_settings")
      .update({
        apple_enabled: data.apple_enabled,
        apple_pass_type_identifier: data.apple_pass_type_identifier || null,
        apple_team_identifier: data.apple_team_identifier || null,
        apple_organization_name: data.apple_organization_name,
        google_enabled: data.google_enabled,
        google_issuer_id: data.google_issuer_id || null,
        google_issuer_name: data.google_issuer_name,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    if (error) throw new Error(error.message);

    // Issuer ID a názov číta podpisovanie z prístupov, nie z tejto tabuľky.
    // Bez tohto by sa v admine dali prepísať a pass by sa podpisoval starým.
    await ulozPristupy(
      "google-wallet",
      {
        GOOGLE_WALLET_ISSUER_ID: data.google_issuer_id || null,
        GOOGLE_WALLET_ISSUER_NAME: data.google_issuer_name || null,
      },
      context.userId,
    );
    return { ok: true };
  });

/**
 * Certifikáty a servisné kľúče.
 *
 * Prázdna hodnota znamená „nemeniť", `null` znamená „zmazať" — vďaka tomu sa
 * dá formulár odoslať bez toho, aby do neho bolo treba znovu vkladať
 * certifikát, ktorý sa v ňom aj tak nezobrazuje.
 */
export const saveWalletCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        // Certifikát má aj pár tisíc znakov, servisný účet ešte viac.
        apple_cert: z.string().max(20000).optional().nullable(),
        apple_wwdr: z.string().max(20000).optional().nullable(),
        apple_passphrase: z.string().max(500).optional().nullable(),
        google_service_account: z.string().max(20000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; ulozene: string[] }> => {
    await assertAdmin(context.userId);
    await pripravPristupy();

    const apple: Record<string, string | null> = {};
    const google: Record<string, string | null> = {};
    const ulozene: string[] = [];

    const vloz = (
      kam: Record<string, string | null>,
      kluc: string,
      popis: string,
      hodnotaPola: string | null | undefined,
      kontrola?: (t: string) => { ok: true } | { ok: false; sprava: string },
    ) => {
      if (hodnotaPola === undefined) return;
      if (hodnotaPola === null) {
        kam[kluc] = null;
        ulozene.push(`${popis} (zmazané)`);
        return;
      }
      const t = hodnotaPola.trim();
      if (!t) return; // prázdne pole = nechať, čo tam je
      const v = kontrola?.(t);
      if (v && !v.ok) throw new Error(`${popis}: ${v.sprava}`);
      kam[kluc] = t;
      ulozene.push(popis);
    };

    vloz(apple, "APPLE_WALLET_CERT", "Apple certifikát", data.apple_cert, skontrolujApplePem);
    vloz(apple, "APPLE_WALLET_WWDR", "Apple WWDR", data.apple_wwdr, skontrolujWwdr);
    vloz(apple, "APPLE_WALLET_CERT_PASSPHRASE", "Heslo k certifikátu", data.apple_passphrase);
    vloz(
      google,
      "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON",
      "Servisný účet Google",
      data.google_service_account,
      skontrolujServisnyUcet,
    );

    if (Object.keys(apple).length) await ulozPristupy("apple-wallet", apple, context.userId);
    if (Object.keys(google).length) await ulozPristupy("google-wallet", google, context.userId);
    return { ok: true, ulozene };
  });
