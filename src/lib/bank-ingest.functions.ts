// Nahrávanie bankových výpisov a správa zdrojov.
//
// Nahratý súbor je cudzí vstup, takže platia tri pravidlá:
//  1. formát sa určuje **podľa účtu**, nie podľa názvu súboru,
//  2. veľkosť je obmedzená (parsuje sa v procese, ktorý obsluhuje web),
//  3. XML sa parsuje s vypnutými entitami (XXE).
//
// Starý systém púšťal na nahratý súbor `PhpSpreadsheet::load()` a heslo
// k archívu odovzdával cez `exec("7z -p<heslo>")`, takže bolo vidieť
// v zozname procesov.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { zasifruj, nahlad } from "./secrets.server";
import { zapisAudit } from "./bank/audit.server";
import { sparujTransakcie } from "./bank/matching.server";
import {
  MAX_VELKOST,
  PARSERY,
  parserPodlaId,
  stiahniZoZdrojov,
  ulozVysledok,
} from "./bank/ingest/index.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

/** Podporované formáty pre výber v admine. */
export const listStatementFormats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    return PARSERY.map((p) => ({ id: p.id, nazov: p.nazov, pripony: p.pripony }));
  });

/**
 * Nahratie mesačného výpisu.
 *
 * Obsah chodí ako base64, aby prešiel serverovou funkciou bez multipartu.
 * Limit sa kontroluje na dekódovanej veľkosti — base64 je o tretinu väčšie
 * a strop by tak bol v skutočnosti nižší, než sa zdá.
 */
export const importStatementFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        account_id: z.string().uuid(),
        format: z.string().min(1).max(40),
        file_name: z.string().max(255).optional().nullable(),
        content_base64: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    const parser = parserPodlaId(data.format);
    if (!parser) throw new Error(`Neznámy formát výpisu: ${data.format}`);

    let obsah: string;
    try {
      const bajty = Buffer.from(data.content_base64, "base64");
      if (bajty.length === 0) throw new Error("Súbor je prázdny.");
      if (bajty.length > MAX_VELKOST) {
        throw new Error(
          `Súbor má ${(bajty.length / 1024 / 1024).toFixed(1)} MB, povolené sú najviac ` +
            `${(MAX_VELKOST / 1024 / 1024).toFixed(0)} MB.`,
        );
      }
      // Väčšina slovenských výpisov je UTF-8; staršie textové bývajú CP1250,
      // ale tie tento parser zatiaľ neprijíma (camt.053 a Fio sú UTF-8).
      obsah = bajty.toString("utf8");
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Súbor sa nepodarilo prečítať.");
    }

    const vysledok = parser.parsuj(obsah);

    // Súbor, z ktorého nevyšla ani jedna transakcia, je takmer isto zlý
    // formát. Radšej to povieme rovno, než aby účtovník čakal na pohyby,
    // ktoré nikdy neprídu.
    if (vysledok.transakcie.length === 0) {
      throw new Error(
        vysledok.chyby[0]?.chyba ??
          "Zo súboru sa nedal prečítať ani jeden pohyb. Skontroluj, či formát sedí s účtom.",
      );
    }

    const ulozene = await ulozVysledok(data.account_id, null, vysledok, {
      fileName: data.file_name ?? undefined,
      userId: context.userId,
      ukladajOriginal: true,
    });

    await zapisAudit({
      actor: context.userId,
      action: "banka.import_vypisu",
      entity: "bank_account",
      entityId: data.account_id,
      after: {
        format: data.format,
        file_name: data.file_name,
        transakcii: ulozene.transakcii,
        novych: ulozene.novych,
        chyb: ulozene.chyb,
      },
    });

    // Nové pohyby sa rovno skúsia spárovať — účtovník nemá dôvod klikať dvakrát.
    const parovanie = await sparujTransakcie({ accountId: data.account_id });
    return { ...ulozene, parovanie };
  });

/** Ručné spustenie sťahovania z API zdrojov (inak to robí cron). */
export const fetchFromSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const stiahnute = await stiahniZoZdrojov();
    const parovanie = await sparujTransakcie();
    return { stiahnute, parovanie };
  });

// --- Zdroje -------------------------------------------------------------

export type ZdrojRecord = {
  id: string;
  account_id: string;
  name: string;
  kind: string;
  provider: string;
  enabled: boolean;
  window_days: number;
  /** Len náhľad `••••1234`; samotný token sa do prehliadača nevracia nikdy. */
  secret_preview: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
};

export const listStatementSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ZdrojRecord[]> => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("bank_statement_sources")
      .select("*")
      .order("name");
    if (error) throw new Error(error.message);

    const { desifruj } = await import("./secrets.server");
    return (data || []).map((z) => {
      const otvorene = z.secret_enc ? desifruj(z.secret_enc) : null;
      return {
        id: z.id,
        account_id: z.account_id,
        name: z.name,
        kind: z.kind,
        provider: z.provider,
        enabled: z.enabled,
        window_days: z.window_days,
        secret_preview: otvorene ? nahlad(otvorene) : null,
        last_success_at: z.last_success_at,
        last_error: z.last_error,
        last_error_at: z.last_error_at,
      };
    });
  });

export const upsertStatementSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        account_id: z.string().uuid(),
        name: z.string().min(1).max(200),
        kind: z.enum(["api", "upload", "manual"]),
        provider: z.string().min(1).max(40),
        enabled: z.boolean().default(true),
        window_days: z.number().int().min(1).max(31).default(2),
        /** Prázdny reťazec = nemeniť; `null` = zmazať. */
        secret: z.string().max(500).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    // Token sa prepisuje len keď naozaj prišla nová hodnota — inak by úprava
    // názvu zdroja vymazala prístup.
    const tajomstvo: { secret_enc?: string | null } =
      data.secret === null
        ? { secret_enc: null }
        : data.secret && data.secret.trim()
          ? { secret_enc: zasifruj(data.secret.trim()) }
          : {};

    const row = {
      account_id: data.account_id,
      name: data.name.trim(),
      kind: data.kind,
      provider: data.provider,
      enabled: data.enabled,
      window_days: data.window_days,
      ...tajomstvo,
    };

    if (data.id) {
      const { error } = await supabaseAdmin
        .from("bank_statement_sources")
        .update(row)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      await zapisAudit({
        actor: context.userId,
        action: "banka.zdroj_upraveny",
        entity: "bank_statement_source",
        entityId: data.id,
        // Token sa do auditu nikdy nedostane, ani zašifrovaný.
        after: { name: row.name, enabled: row.enabled, zmeneny_token: data.secret != null },
      });
      return { id: data.id };
    }

    const { data: created, error } = await supabaseAdmin
      .from("bank_statement_sources")
      .insert(row)
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message || "Zdroj sa nepodarilo založiť");
    await zapisAudit({
      actor: context.userId,
      action: "banka.zdroj_zalozeny",
      entity: "bank_statement_source",
      entityId: created.id,
      after: { name: row.name, provider: row.provider, kind: row.kind },
    });
    return { id: created.id };
  });

export const deleteStatementSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("bank_statement_sources").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await zapisAudit({
      actor: context.userId,
      action: "banka.zdroj_zmazany",
      entity: "bank_statement_source",
      entityId: data.id,
    });
    return { ok: true };
  });

/** Mesačné súhrny účtu — podklad pre tabuľku výpisov a kontrolu zostatkov. */
export const listStatements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ account_id: z.string().uuid().optional(), year: z.number().int().optional() })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    let q = supabaseAdmin
      .from("bank_statements")
      .select("*")
      .order("period_from", { ascending: false });
    if (data.account_id) q = q.eq("account_id", data.account_id);
    if (data.year) {
      q = q.gte("period_from", `${data.year}-01-01`).lte("period_from", `${data.year}-12-31`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    return (rows || []).map((s) => {
      const opening = s.opening_balance != null ? Number(s.opening_balance) : null;
      const closing = s.closing_balance != null ? Number(s.closing_balance) : null;
      const credit = Number(s.credit_sum);
      const debit = Number(s.debit_sum);
      const charges = Number(s.charges_sum);
      // Kontrola zo špecifikácie: počiatočný + kredity − debety − poplatky
      // musí dať koncový stav. Keď nie, výpis je neúplný.
      const ocakavanyKoncovy = opening != null ? opening + credit - debit - charges : null;
      return {
        id: s.id,
        account_id: s.account_id,
        period_from: s.period_from,
        period_to: s.period_to,
        opening_balance: opening,
        closing_balance: closing,
        credit_sum: credit,
        debit_sum: debit,
        charges_sum: charges,
        credit_count: s.credit_count,
        debit_count: s.debit_count,
        currency: s.currency,
        file_name: s.file_name,
        imported_at: s.imported_at,
        zostatky_sedia:
          ocakavanyKoncovy == null || closing == null
            ? null
            : Math.abs(ocakavanyKoncovy - closing) < 0.01,
        ocakavany_koncovy: ocakavanyKoncovy,
      };
    });
  });
