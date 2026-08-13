// Správa emailových šablón v admine.
// Renderovanie je v `email-templates.ts` / `email-templates.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, renderTemplate } from "./email-templates";

export type EmailTemplateRecord = {
  key: string;
  name: string;
  description: string;
  subject: string;
  html: string;
  text: string;
  enabled: boolean;
  /** `false` = beží vstavané znenie z kódu, riadok v databáze ešte nie je. */
  customized: boolean;
  updated_at: string | null;
  variables: { key: string; label: string; example: string }[];
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

const KeySchema = z.enum(TEMPLATE_KEYS as [string, ...string[]]);

/**
 * Zoznam šablón. Vždy vráti všetky známe kľúče — aj tie, ktoré ešte nikto
 * neupravoval; pri nich sa ukáže vstavané znenie z kódu.
 */
export const listEmailTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EmailTemplateRecord[]> => {
    await assertAdmin(context.userId);

    const { data: rows } = await supabaseAdmin
      .from("email_templates")
      .select("key, name, subject, html, text_body, enabled, updated_at");
    const byKey = new Map((rows || []).map((r) => [r.key, r]));

    return TEMPLATE_KEYS.map((key) => {
      const fallback = DEFAULT_TEMPLATES[key];
      const row = byKey.get(key);
      return {
        key,
        name: row?.name || fallback.name,
        description: fallback.description,
        subject: row?.subject ?? fallback.subject,
        html: row?.html ?? fallback.html,
        text: row?.text_body ?? fallback.text,
        enabled: row ? row.enabled : true,
        customized: !!row,
        updated_at: row?.updated_at ?? null,
        variables: fallback.variables,
      };
    });
  });

const TemplateInput = z.object({
  key: KeySchema,
  subject: z.string().min(1).max(300),
  html: z.string().min(1).max(100_000),
  text: z.string().max(20_000).optional().nullable(),
  enabled: z.boolean().default(true),
});

export type EmailTemplateInputData = z.input<typeof TemplateInput>;

export const saveEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => TemplateInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    const fallback = DEFAULT_TEMPLATES[data.key as keyof typeof DEFAULT_TEMPLATES];
    const { error } = await supabaseAdmin.from("email_templates").upsert(
      {
        key: data.key,
        name: fallback.name,
        subject: data.subject,
        html: data.html,
        text_body: data.text || null,
        enabled: data.enabled,
        updated_by: context.userId,
      },
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Zmaže úpravu — e-maily sa vrátia k vstavanému zneniu z kódu. */
export const resetEmailTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ key: KeySchema }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("email_templates").delete().eq("key", data.key);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Skúšobné odoslanie na zadanú adresu. Ide cez ten istý mailer ako ostrý
 * e-mail, takže sa zároveň overí, či je Resend vôbec nastavený.
 */
export const sendTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        key: KeySchema,
        to: z.string().email(),
        subject: z.string().min(1).max(300),
        html: z.string().min(1).max(100_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; message?: string }> => {
    await assertAdmin(context.userId);

    const fallback = DEFAULT_TEMPLATES[data.key as keyof typeof DEFAULT_TEMPLATES];
    // Do testu ide ukážková hodnota z definície premennej — adresát tak vidí
    // presne to, čo uvidí zákazník, len s vymyslenými údajmi.
    const vars = Object.fromEntries(fallback.variables.map((v) => [v.key, v.example]));

    const { sendMail, isMailConfigured } = await import("./mailer.server");
    if (!isMailConfigured()) {
      return {
        ok: false,
        message: "Odosielanie e-mailov nie je nastavené (chýba RESEND_API_KEY).",
      };
    }

    const result = await sendMail({
      to: data.to,
      subject: `[TEST] ${renderTemplate(data.subject, vars, { escape: false })}`,
      html: renderTemplate(data.html, vars),
      text: renderTemplate(fallback.text, vars, { escape: false }),
    });
    return result.ok ? { ok: true } : { ok: false, message: result.message };
  });
