// Auditný záznam ručných zásahov.
//
// Starý systém menil variabilný symbol a označoval platby za náklad cez
// obyčajný GET odkaz a bez akéhokoľvek záznamu — spätne sa nedalo zistiť, kto
// platbu prepísal ani prečo. Každá ručná zmena v tomto module preto ide sem.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

export type AuditVstup = {
  actor: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

/**
 * Zapíše zásah. Zlyhanie auditu nesmie zhodiť samotnú operáciu — peniaze
 * a vstupenky sú dôležitejšie než záznam o tom, kto klikol.
 */
export async function zapisAudit(vstup: AuditVstup): Promise<void> {
  try {
    await supabaseAdmin.from("audit_log").insert({
      actor: vstup.actor,
      action: vstup.action,
      entity: vstup.entity,
      entity_id: vstup.entityId,
      before: (vstup.before ?? null) as Json,
      after: (vstup.after ?? null) as Json,
      reason: vstup.reason ?? null,
    });
  } catch (e) {
    console.error("Auditný záznam sa nepodarilo zapísať", vstup.action, vstup.entityId, e);
  }
}
