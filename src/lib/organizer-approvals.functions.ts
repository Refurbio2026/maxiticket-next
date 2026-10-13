// Schvaľovanie organizátorských účtov (admin).
//
// Registrácia organizátora je verejná, takže bez tohto kroku by si hocikto
// založil účet, pripravil podujatie a začal pod hlavičkou eticketa prijímať
// platby cez jeho platobnú bránu. Preto: `signUp` nikomu rolu neudeľuje,
// žiadosť pristane tu a `organizer` sa prideľuje až schválením. Zverejnenie
// podujatia neschválenému organizátorovi odmieta aj databáza (trigger
// `trg_events_organizator_schvaleny`), nie len toto UI.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { zabudni } from "./cache.server";
import { sendMail } from "./mailer.server";
import { siteUrl } from "./site-url.server";
import type { OrganizerStatus } from "./organizer-profile";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

export type OrganizerApplication = {
  id: string;
  email: string;
  full_name: string | null;
  display_name: string | null;
  subdomain: string | null;
  bio: string | null;
  logo_url: string | null;
  website: string | null;
  city: string | null;
  company_name: string | null;
  ico: string | null;
  dic: string | null;
  ic_dph: string | null;
  vat_payer: boolean;
  billing_address: string | null;
  phone: string | null;
  payout_iban: string | null;
  cancellation_policy: string | null;
  complaint_contact: string | null;
  listed_in_catalog: boolean;
  organizer_status: OrganizerStatus;
  organizer_requested_at: string | null;
  organizer_approved_at: string | null;
  organizer_review_note: string | null;
  onboarding_step: number;
  links: { platform: string; url: string }[];
  events_count: number;
};

// Jediný reťazec, nie spojenie `+` — inak supabase-js neodvodí tvar riadku.
const ZIADOST_STLPCE =
  "id, full_name, display_name, subdomain, bio, logo_url, website, city, company_name, ico, dic, ic_dph, vat_payer, billing_address, phone, payout_iban, cancellation_policy, complaint_contact, listed_in_catalog, organizer_status, organizer_requested_at, organizer_approved_at, organizer_review_note, onboarding_step";

/**
 * Žiadosti o organizátorský účet. Predvolene to, čo čaká na rozhodnutie —
 * pri `all` aj schválení a zamietnutí, nech sa dá rozhodnutie vrátiť.
 */
export const listOrganizerApplications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        status: z
          .enum(["pending", "onboarding", "approved", "rejected", "suspended", "all", "open"])
          .default("open"),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<OrganizerApplication[]> => {
    await assertAdmin(context.userId);

    let q = supabaseAdmin.from("profiles").select(ZIADOST_STLPCE);
    if (data.status === "open") {
      // Všetko okrem bežných kupujúcich: aj rozpracované, aby admin videl,
      // že sa niekto registruje a zasekol sa.
      q = q.in("organizer_status", ["onboarding", "pending", "rejected", "suspended"]);
    } else if (data.status === "all") {
      q = q.neq("organizer_status", "none");
    } else {
      q = q.eq("organizer_status", data.status);
    }

    const { data: rows, error } = await q.order("organizer_requested_at", {
      ascending: false,
      nullsFirst: false,
    });
    if (error) throw new Error(error.message);
    const profily = rows ?? [];
    if (profily.length === 0) return [];

    const ids = profily.map((p) => p.id);
    const [{ data: authList }, { data: links }, { data: events }] = await Promise.all([
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      supabaseAdmin
        .from("organizer_links")
        .select("organizer_id, platform, url, sort_order")
        .in("organizer_id", ids)
        .order("sort_order", { ascending: true }),
      supabaseAdmin.from("events").select("organizer_id").in("organizer_id", ids),
    ]);

    const emaily = new Map((authList?.users || []).map((u) => [u.id, u.email || ""]));
    const odkazy = new Map<string, { platform: string; url: string }[]>();
    for (const l of links || []) {
      const zoznam = odkazy.get(l.organizer_id) || [];
      zoznam.push({ platform: l.platform, url: l.url });
      odkazy.set(l.organizer_id, zoznam);
    }
    const pocty = new Map<string, number>();
    for (const e of events || []) {
      pocty.set(e.organizer_id, (pocty.get(e.organizer_id) || 0) + 1);
    }

    return profily.map((p) => ({
      ...p,
      organizer_status: p.organizer_status as OrganizerStatus,
      email: emaily.get(p.id) || "",
      links: odkazy.get(p.id) || [],
      events_count: pocty.get(p.id) || 0,
    })) as OrganizerApplication[];
  });

type Rozhodnutie = "approve" | "reject" | "suspend" | "reinstate";

const CIELOVY_STAV: Record<Rozhodnutie, OrganizerStatus> = {
  approve: "approved",
  reject: "rejected",
  suspend: "suspended",
  reinstate: "approved",
};

/**
 * Rozhodnutie o žiadosti. Schválenie je jediné miesto v aplikácii, ktoré
 * prideľuje rolu `organizer`.
 *
 * Pozastavenie **neskrýva už zverejnené podujatia** — tie môžu mať predané
 * vstupenky a ich stiahnutie je samostatné rozhodnutie. Zabráni len tomu, aby
 * organizátor zverejnil ďalšie.
 */
export const decideOrganizerApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        user_id: z.string().uuid(),
        decision: z.enum(["approve", "reject", "suspend", "reinstate"]),
        note: z.string().max(2000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ status: OrganizerStatus }> => {
    await assertAdmin(context.userId);

    const { data: profil, error: chybaCitania } = await supabaseAdmin
      .from("profiles")
      .select("id, organizer_status, display_name, company_name, full_name, subdomain")
      .eq("id", data.user_id)
      .maybeSingle();
    if (chybaCitania) throw new Error(chybaCitania.message);
    if (!profil) throw new Error("Profil sa nenašiel");

    const poznamka = data.note?.trim() || null;
    if ((data.decision === "reject" || data.decision === "suspend") && !poznamka) {
      // Bez dôvodu organizátor nevie, čo opraviť, a admin si po mesiaci
      // nespomenie, prečo to zamietol.
      throw new Error("Pri zamietnutí a pozastavení treba napísať dôvod.");
    }

    const novyStav = CIELOVY_STAV[data.decision];

    const zmena: Database["public"]["Tables"]["profiles"]["Update"] = {
      organizer_status: novyStav,
      organizer_review_note: data.decision === "approve" ? null : poznamka,
      updated_at: new Date().toISOString(),
    };
    if (novyStav === "approved") {
      zmena.organizer_approved_at = new Date().toISOString();
      zmena.organizer_approved_by = context.userId;
    }

    const { error } = await supabaseAdmin.from("profiles").update(zmena).eq("id", data.user_id);
    if (error) throw new Error(error.message);

    if (novyStav === "approved") {
      // Rola je to, čo organizátorovi otvorí jeho časť aplikácie. `upsert` kvôli
      // opakovanému schváleniu — druhý klik nesmie spadnúť na unikátnom kľúči.
      const { error: chybaRole } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.user_id, role: "organizer" }, { onConflict: "user_id,role" });
      if (chybaRole) throw new Error(chybaRole.message);
    }

    await supabaseAdmin.from("audit_log").insert({
      entity: "organizer",
      entity_id: data.user_id,
      action: `ziadost_${data.decision}`,
      actor: context.userId,
      before: { organizer_status: profil.organizer_status },
      after: { organizer_status: novyStav },
      reason: poznamka,
    });

    zabudni("organizator:");
    await posliOznamenie(data.user_id, data.decision, poznamka, profil.subdomain);

    return { status: novyStav };
  });

/**
 * Oznámenie organizátorovi. Keď Resend nie je nastavený, `sendMail` vráti
 * `not_configured` a schválenie prejde aj tak — rozhodnutie admina nesmie
 * padnúť na tom, že nie je dokončená pošta.
 */
async function posliOznamenie(
  userId: string,
  rozhodnutie: Rozhodnutie,
  poznamka: string | null,
  subdomena: string | null,
) {
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = data.user?.email;
    if (!email) return;

    const zaklad = siteUrl().replace(/\/$/, "");
    const texty: Record<Rozhodnutie, { subject: string; html: string }> = {
      approve: {
        subject: "Tvoj organizátorský účet je schválený",
        html:
          `<p>Dobrý deň,</p><p>organizátorský účet na eticketo.eu je schválený. ` +
          `Môžeš vytvárať a zverejňovať podujatia.</p>` +
          (subdomena
            ? `<p>Tvoj verejný profil: <a href="${zaklad}/o/${subdomena}">${zaklad}/o/${subdomena}</a></p>`
            : "") +
          `<p><a href="${zaklad}/organizer">Prejsť do administrácie</a></p>`,
      },
      reject: {
        subject: "Žiadosť o organizátorský účet — treba doplniť údaje",
        html:
          `<p>Dobrý deň,</p><p>žiadosť sme zatiaľ neschválili. Dôvod:</p>` +
          `<blockquote>${poznamka ?? ""}</blockquote>` +
          `<p>Údaje môžeš opraviť a požiadať znova: ` +
          `<a href="${zaklad}/onboarding">${zaklad}/onboarding</a></p>`,
      },
      suspend: {
        subject: "Organizátorský účet je pozastavený",
        html:
          `<p>Dobrý deň,</p><p>organizátorský účet je pozastavený. Dôvod:</p>` +
          `<blockquote>${poznamka ?? ""}</blockquote>` +
          `<p>Už zverejnené podujatia bežia ďalej; nové sa zverejniť nedá.</p>`,
      },
      reinstate: {
        subject: "Organizátorský účet je znovu aktívny",
        html: `<p>Dobrý deň,</p><p>pozastavenie účtu sme zrušili, môžeš pokračovať.</p>`,
      },
    };

    const t = texty[rozhodnutie];
    await sendMail({ to: email, subject: t.subject, html: t.html });
  } catch (e) {
    // Oznámenie je príjemnosť, nie podmienka. Nech sa rozhodnutie uloží aj tak.
    console.error("[organizer-approvals] oznámenie sa neodoslalo", e);
  }
}
