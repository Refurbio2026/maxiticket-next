// Načítanie emailovej šablóny z databázy.
//
// Odosielanie nesmie závisieť od toho, či šablóna v tabuľke existuje — keď
// chýba alebo je vypnutá, vráti sa vstavané znenie z `email-templates.ts`.
// Vďaka tomu sa e-mail so vstupenkami odošle aj na čerstvej databáze.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_TEMPLATES,
  renderTemplate,
  type TemplateKey,
  type TemplateVars,
} from "./email-templates";

export type ResolvedTemplate = {
  subject: string;
  html: string;
  text: string;
  /** `true` = použilo sa znenie z databázy, `false` = vstavané. */
  from_db: boolean;
};

/** Zloží predmet, HTML aj čistý text pre daný kľúč a premenné. */
export async function renderEmail(key: TemplateKey, vars: TemplateVars): Promise<ResolvedTemplate> {
  const fallback = DEFAULT_TEMPLATES[key];
  let source = { subject: fallback.subject, html: fallback.html, text: fallback.text };
  let fromDb = false;

  try {
    const { data } = await supabaseAdmin
      .from("email_templates")
      .select("subject, html, text_body, enabled")
      .eq("key", key)
      .maybeSingle();
    if (data?.enabled) {
      source = {
        subject: data.subject || fallback.subject,
        html: data.html || fallback.html,
        text: data.text_body || fallback.text,
      };
      fromDb = true;
    }
  } catch (e) {
    // Výpadok čítania šablóny nesmie zastaviť e-mail — pošleme vstavané znenie.
    console.error("Šablónu sa nepodarilo načítať, použijem vstavanú", key, e);
  }

  return {
    // Predmet nie je HTML, escapovať ho netreba.
    subject: renderTemplate(source.subject, vars, { escape: false }),
    html: renderTemplate(source.html, vars),
    text: renderTemplate(source.text, vars, { escape: false }),
    from_db: fromDb,
  };
}
