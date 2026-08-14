// Nastavenie wallet passov (Apple / Google).
//
// Predtým to bol localStorage, takže nastavenie platilo pre jeden prehliadač
// a server o ňom nevedel — pass sa preto nedal vygenerovať podľa toho, čo bolo
// v admine nastavené.
//
// BEZPEČNOSŤ: certifikáty a servisné kľúče sem nepatria. Tie sú v secrets
// (`GOOGLE_WALLET_*`); v databáze je len to, čo sa smie ukázať v admine.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type WalletSettingsRecord = {
  apple: {
    enabled: boolean;
    pass_type_identifier: string;
    team_identifier: string;
    organization_name: string;
    /** Prítomnosť certifikátu v secrets — do databázy sa nezapisuje. */
    cert_configured: boolean;
  };
  google: {
    enabled: boolean;
    issuer_id: string;
    issuer_name: string;
    service_account_configured: boolean;
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
        organization_name: data?.apple_organization_name ?? "vipky.sk",
        // Apple pass sa podpisuje .p12 certifikátom; ten na serveri zatiaľ nie je.
        cert_configured: !!process.env.APPLE_WALLET_CERT_P12,
      },
      google: {
        enabled: data?.google_enabled ?? false,
        issuer_id: data?.google_issuer_id ?? "",
        issuer_name: data?.google_issuer_name ?? "vipky.sk",
        service_account_configured: !!process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON,
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
        apple_organization_name: z.string().max(200).default("vipky.sk"),
        google_enabled: z.boolean(),
        google_issuer_id: z.string().max(200).optional().nullable(),
        google_issuer_name: z.string().max(200).default("vipky.sk"),
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
    return { ok: true };
  });
