// Zakladanie organizátora na jeden priechod.
//
// Predtým to boli dve nesúvisiace obrazovky: v *Systém → Používatelia* sa
// vytvoril účet s heslom, ktoré vymyslel admin, a vo *eticketo → Organizátori*
// sa doplnila firma, IBAN a provízia. Druhý krok nič nevynucovalo, a tak
// z desiatich organizátorov nemal výplatný IBAN ani jeden — vyúčtovanie nemalo
// kam platiť. Heslo navyše putovalo mimo systému, cez čokoľvek, čím to admin
// poslal.
//
// Tu sú obidve veci jeden úkon: účet, rola, fakturačné údaje, provízia,
// nepovinná subdoména a pozvánka, v ktorej si organizátor nastaví **vlastné**
// heslo. Admin heslo nikdy nevidí.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { siteUrl } from "./site-url.server";
import { renderEmail } from "./email-templates.server";
import { sendMail, isMailConfigured } from "./mailer.server";
import {
  REZERVOVANE_SUBDOMENY,
  TVAR_SUBDOMENY,
  chybaSubdomeny,
  zakladnaDomena,
} from "./subdomena";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

/** Zápis do auditu. Zakladanie účtov sa dosiaľ nikde neevidovalo. */
async function zapisAudit(
  actor: string,
  action: string,
  entityId: string,
  after: Record<string, unknown>,
  reason?: string,
) {
  const { error } = await supabaseAdmin.from("audit_log").insert({
    actor,
    action,
    entity: "organizer",
    entity_id: entityId,
    after: after as never,
    reason: reason ?? null,
  });
  // Audit nesmie zhodiť samotnú operáciu — účet je už založený, strata riadku
  // v logu je menšie zlo než polovičný stav.
  if (error) console.error("audit_log zápis zlyhal", action, entityId, error.message);
}

const FakturacneUdaje = z.object({
  company_name: z.string().trim().max(300).optional().nullable(),
  ico: z.string().trim().max(40).optional().nullable(),
  dic: z.string().trim().max(40).optional().nullable(),
  ic_dph: z.string().trim().max(40).optional().nullable(),
  billing_address: z.string().trim().max(500).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  payout_iban: z.string().trim().max(60).optional().nullable(),
  commission_rate: z.number().min(0).max(100).optional().nullable(),
});

const Subdomena = z
  .string()
  .trim()
  .toLowerCase()
  .regex(TVAR_SUBDOMENY, "Subdoména smie mať 3–32 znakov: malé písmená, číslice a spojovník.")
  .refine((s) => !REZERVOVANE_SUBDOMENY.includes(s), "Táto subdoména je rezervovaná.");

export type NovyOrganizator = {
  id: string;
  email: string;
  pozvanka: "odoslana" | "neodoslana" | "mail_nenastaveny";
  odkaz_na_heslo: string | null;
  subdomena: string | null;
};

/**
 * Založí organizátora. Heslo si nastaví sám z odkazu v pozvánke — `generateLink`
 * ho vráti nám, Supabase e-mail neposiela, takže pozvánka ide našou šablónou
 * cez Resend a vyzerá ako od eticketa.
 */
export const createOrganizer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    FakturacneUdaje.extend({
      email: z.string().trim().toLowerCase().email(),
      full_name: z.string().trim().min(1).max(200),
      subdomain: Subdomena.optional().nullable(),
      poslat_pozvanku: z.boolean().default(true),
    }).parse(input),
  )
  .handler(async ({ data, context }): Promise<NovyOrganizator> => {
    await assertAdmin(context.userId);

    if (data.subdomain) {
      const obsadena = await jeSubdomenaObsadena(data.subdomain);
      if (obsadena) throw new Error(`Subdoménu „${data.subdomain}" už má iný organizátor.`);
    }

    const { email, full_name, subdomain, poslat_pozvanku, ...fakturacia } = data;

    // `invite` účet vytvorí a vráti odkaz; nepošle nič. Keby sme zakladali
    // účet s heslom, musel by ho admin niekam prepísať a tým by sa dostalo
    // mimo systému.
    const { data: odkaz, error: chybaOdkazu } = await supabaseAdmin.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: { full_name, requested_role: "organizer", invited_as: "organizer" },
        redirectTo: `${siteUrl()}/login?pozvanka=1`,
      },
    });
    if (chybaOdkazu || !odkaz?.user) {
      const text = chybaOdkazu?.message ?? "Účet sa nepodarilo vytvoriť";
      throw new Error(
        /already been registered|already exists/i.test(text)
          ? `Účet s e-mailom ${email} už existuje. Rolu organizátora mu pridaj v Systém → Používatelia alebo schváľ jeho žiadosť.`
          : text,
      );
    }
    const userId = odkaz.user.id;

    // `handle_new_user()` profil aj rolu `user` založí sám; dopĺňame zvyšok.
    const { error: chybaProfilu } = await supabaseAdmin.from("profiles").upsert(
      {
        id: userId,
        full_name,
        subdomain: subdomain ?? null,
        ...fakturacia,
      },
      { onConflict: "id" },
    );
    if (chybaProfilu) throw new Error(chybaProfilu.message);

    const { error: chybaRoly } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "organizer" }, { onConflict: "user_id,role" });
    if (chybaRoly) throw new Error(chybaRoly.message);

    await zapisAudit(context.userId, "organizer.created", userId, {
      email,
      full_name,
      subdomain: subdomain ?? null,
      company_name: fakturacia.company_name ?? null,
      commission_rate: fakturacia.commission_rate ?? null,
    });

    let pozvanka: NovyOrganizator["pozvanka"] = "neodoslana";
    if (poslat_pozvanku) {
      pozvanka = await poslatPozvanku({
        email,
        full_name,
        odkaz: odkaz.properties.action_link,
        subdomena: subdomain ?? null,
      });
    }

    return {
      id: userId,
      email,
      pozvanka,
      // Odkaz vracíme vždy: keď e-mail nedorazí, admin ho vie podať inak.
      odkaz_na_heslo: odkaz.properties.action_link,
      subdomena: subdomain ?? null,
    };
  });

async function poslatPozvanku(vstup: {
  email: string;
  full_name: string;
  odkaz: string;
  subdomena: string | null;
}): Promise<NovyOrganizator["pozvanka"]> {
  if (!isMailConfigured()) return "mail_nenastaveny";

  const adresa = siteUrl();
  const sablona = await renderEmail("organizer_invite", {
    organizer_name: vstup.full_name.split(" ")[0] || vstup.full_name,
    set_password_url: vstup.odkaz,
    login_url: `${adresa}/login`,
    organizer_url: `${adresa}/organizer`,
    subdomain_url: vstup.subdomena ? `https://${vstup.subdomena}.${zakladnaDomena(adresa)}` : null,
  });

  const vysledok = await sendMail({
    to: vstup.email,
    subject: sablona.subject,
    html: sablona.html,
    text: sablona.text,
  });

  const { error } = await supabaseAdmin.from("email_logs").insert({
    recipient: vstup.email,
    subject: sablona.subject,
    provider: "resend",
    status: vysledok.ok ? "ok" : "error",
    provider_message_id: vysledok.ok ? vysledok.id : null,
    error_message: vysledok.ok ? null : vysledok.message,
  });
  if (error) console.error("email_logs zápis zlyhal", error.message);

  return vysledok.ok ? "odoslana" : "neodoslana";
}

async function jeSubdomenaObsadena(subdomena: string, okremId?: string): Promise<boolean> {
  let q = supabaseAdmin.from("profiles").select("id").ilike("subdomain", subdomena).limit(1);
  if (okremId) q = q.neq("id", okremId);
  const { data } = await q;
  return (data?.length ?? 0) > 0;
}

export type StavSubdomeny = {
  subdomena: string;
  adresa: string;
  tvar_ok: boolean;
  volna: boolean;
  chyba: string | null;
  /** Odpovedá už tá adresa naživo? Bez zástupného DNS a certifikátu nie. */
  dns_ok: boolean;
  https_ok: boolean;
  /** Čo z toho vyplýva pre obsluhu. */
  hlaska: string;
};

/**
 * Overí subdoménu skôr, než ju admin potvrdí: tvar, či je voľná, a či vôbec
 * odpovedá naživo. Posledné dve nie sú to isté — zapísať sa dá hneď, ale
 * fungovať začne až so zástupným DNS záznamom a wildcard certifikátom
 * (pozri `docs/subdomeny.md`). Radšej to obsluhe povedzme, než aby sľúbila
 * organizátorovi adresu, ktorá sa neotvorí.
 */
export const checkSubdomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        subdomain: z.string().trim().toLowerCase().max(80),
        okrem_id: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<StavSubdomeny> => {
    await assertAdmin(context.userId);

    const adresa = siteUrl();
    const domena = zakladnaDomena(adresa);
    const plna = `${data.subdomain}.${domena}`;
    const chyba = chybaSubdomeny(data.subdomain);

    if (chyba) {
      return {
        subdomena: data.subdomain,
        adresa: plna,
        tvar_ok: false,
        volna: false,
        chyba,
        dns_ok: false,
        https_ok: false,
        hlaska: chyba,
      };
    }

    const obsadena = await jeSubdomenaObsadena(data.subdomain, data.okrem_id);
    if (obsadena) {
      return {
        subdomena: data.subdomain,
        adresa: plna,
        tvar_ok: true,
        volna: false,
        chyba: "Túto subdoménu už má iný organizátor.",
        dns_ok: false,
        https_ok: false,
        hlaska: "Túto subdoménu už má iný organizátor.",
      };
    }

    const { dns_ok, https_ok } = await zivyStav(plna);
    return {
      subdomena: data.subdomain,
      adresa: plna,
      tvar_ok: true,
      volna: true,
      chyba: null,
      dns_ok,
      https_ok,
      hlaska: https_ok
        ? "Voľná a adresa už odpovedá — po uložení funguje hneď."
        : dns_ok
          ? "Voľná, DNS odpovedá, ale HTTPS ešte nie — chýba wildcard certifikát."
          : "Voľná. Adresa zatiaľ neodpovedá: chýba zástupný DNS záznam *." +
            domena +
            " a wildcard certifikát (docs/subdomeny.md). Zapísať ju môžeš už teraz.",
    };
  });

/** Odpovedá adresa naživo? Krátky časový strop — je to nápoveda, nie brána. */
async function zivyStav(plnaAdresa: string): Promise<{ dns_ok: boolean; https_ok: boolean }> {
  let dns_ok = false;
  let https_ok = false;
  try {
    const dns = await import("node:dns/promises");
    const adresy = await dns.resolve4(plnaAdresa).catch(() => dns.resolve6(plnaAdresa));
    dns_ok = (adresy?.length ?? 0) > 0;
  } catch {
    dns_ok = false;
  }
  if (dns_ok) {
    try {
      const odpoved = await fetch(`https://${plnaAdresa}/`, {
        method: "HEAD",
        signal: AbortSignal.timeout(4000),
      });
      https_ok = odpoved.ok || odpoved.status < 500;
    } catch {
      https_ok = false;
    }
  }
  return { dns_ok, https_ok };
}

/** Nastaví alebo zruší subdoménu existujúcemu organizátorovi. */
export const setOrganizerSubdomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        subdomain: Subdomena.nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    if (data.subdomain && (await jeSubdomenaObsadena(data.subdomain, data.id))) {
      throw new Error(`Subdoménu „${data.subdomain}" už má iný organizátor.`);
    }

    const { data: pred } = await supabaseAdmin
      .from("profiles")
      .select("subdomain")
      .eq("id", data.id)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ subdomain: data.subdomain, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await zapisAudit(context.userId, "organizer.subdomain_changed", data.id, {
      z: pred?.subdomain ?? null,
      na: data.subdomain,
    });
    return { ok: true as const };
  });

export type ZiadostOrganizatora = {
  id: string;
  email: string;
  full_name: string | null;
  company_name: string | null;
  ico: string | null;
  phone: string | null;
  vznik: string;
};

/**
 * Žiadosti z verejnej registrácie.
 *
 * `/register` má prepínač „Organizátor" a želanú rolu odkladá do metadát ako
 * `requested_role`. Rolu z klienta zámerne nikto nepreberá — `handle_new_user()`
 * dá vždy `user`. Doteraz to ale znamenalo, že žiadosť nikto nikdy neuvidel:
 * `requested_role` sa v celom zdroji nečítalo ani raz. Toto je to chýbajúce
 * miesto, kde sa dá schváliť.
 */
export const listOrganizerRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ZiadostOrganizatora[]> => {
    await assertAdmin(context.userId);

    const { data: ucty, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) throw new Error(error.message);

    const ziadatelia = ucty.users.filter((u) => {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      // `invited_as` majú účty, ktoré sme založili sami — tie nie sú žiadosť.
      return meta.requested_role === "organizer" && !meta.invited_as;
    });
    if (ziadatelia.length === 0) return [];

    const ids = ziadatelia.map((u) => u.id);
    const [{ data: roly }, { data: profily }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, company_name, ico, phone")
        .in("id", ids),
    ]);

    const jeOrganizator = new Set(
      (roly ?? []).filter((r) => r.role === "organizer").map((r) => r.user_id),
    );
    const profil = new Map((profily ?? []).map((p) => [p.id, p]));

    return ziadatelia
      .filter((u) => !jeOrganizator.has(u.id))
      .map((u) => ({
        id: u.id,
        email: u.email ?? "",
        full_name: profil.get(u.id)?.full_name ?? null,
        company_name: profil.get(u.id)?.company_name ?? null,
        ico: profil.get(u.id)?.ico ?? null,
        phone: profil.get(u.id)?.phone ?? null,
        vznik: u.created_at,
      }))
      .sort((a, b) => b.vznik.localeCompare(a.vznik));
  });

/** Schválenie žiadosti: pridá rolu, prípadne doplní províziu a subdoménu. */
export const approveOrganizerRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        commission_rate: z.number().min(0).max(100).optional().nullable(),
        subdomain: Subdomena.optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    if (data.subdomain && (await jeSubdomenaObsadena(data.subdomain, data.id))) {
      throw new Error(`Subdoménu „${data.subdomain}" už má iný organizátor.`);
    }

    const { error: chybaRoly } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.id, role: "organizer" }, { onConflict: "user_id,role" });
    if (chybaRoly) throw new Error(chybaRoly.message);

    if (data.commission_rate != null || data.subdomain != null) {
      const zmena: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (data.commission_rate != null) zmena.commission_rate = data.commission_rate;
      if (data.subdomain != null) zmena.subdomain = data.subdomain;
      const { error } = await supabaseAdmin
        .from("profiles")
        .update(zmena as never)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    }

    await zapisAudit(context.userId, "organizer.request_approved", data.id, {
      commission_rate: data.commission_rate ?? null,
      subdomain: data.subdomain ?? null,
    });
    return { ok: true as const };
  });

/** Zamietnutie žiadosti: rolu nedá a z metadát odstráni želanie, nech zoznam nerastie. */
export const rejectOrganizerRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    const { data: ucet, error: chybaCitania } = await supabaseAdmin.auth.admin.getUserById(data.id);
    if (chybaCitania || !ucet?.user) throw new Error(chybaCitania?.message ?? "Účet sa nenašiel");

    const meta = { ...(ucet.user.user_metadata ?? {}) } as Record<string, unknown>;
    meta.requested_role = null;
    meta.organizer_request_rejected_at = new Date().toISOString();

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, {
      user_metadata: meta,
    });
    if (error) throw new Error(error.message);

    await zapisAudit(
      context.userId,
      "organizer.request_rejected",
      data.id,
      { email: ucet.user.email ?? null },
      data.reason,
    );
    return { ok: true as const };
  });
