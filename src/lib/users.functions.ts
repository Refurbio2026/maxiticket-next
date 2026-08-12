// Správa používateľov a rolí (admin).
//
// Do `user_roles` predtým nezapisovalo žiadne miesto v aplikácii okrem seedu
// demo účtov — nového organizátora sa dalo vyrobiť jedine ručným SQL v databáze.
// Tieto funkcie to zavádzajú ako bežnú admin operáciu.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "user" | "organizer" | "admin";
export const APP_ROLES: AppRole[] = ["user", "organizer", "admin"];

export type AdminUserRow = {
  id: string;
  email: string;
  full_name: string | null;
  roles: AppRole[];
  created_at: string | null;
  last_sign_in_at: string | null;
  events_count: number;
};

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

/** Používatelia z auth spojení s profilom a rolami. */
export const listUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        search: z.string().max(200).optional(),
        role: z.enum(["user", "organizer", "admin", "all"]).default("all"),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<AdminUserRow[]> => {
    await assertAdmin(context.userId);

    const { data: authList, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) throw new Error(error.message);
    const users = authList?.users || [];
    const ids = users.map((u) => u.id);
    if (ids.length === 0) return [];

    const [{ data: profiles }, { data: roles }, { data: events }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name").in("id", ids),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
      supabaseAdmin.from("events").select("organizer_id").in("organizer_id", ids),
    ]);

    const names = new Map((profiles || []).map((p) => [p.id, p.full_name]));
    const roleMap = new Map<string, AppRole[]>();
    for (const r of roles || []) {
      const list = roleMap.get(r.user_id) || [];
      list.push(r.role as AppRole);
      roleMap.set(r.user_id, list);
    }
    const eventCounts = new Map<string, number>();
    for (const e of events || []) {
      const id = e.organizer_id as string;
      eventCounts.set(id, (eventCounts.get(id) || 0) + 1);
    }

    const needle = data.search?.trim().toLowerCase();
    return users
      .map((u) => ({
        id: u.id,
        email: u.email || "",
        full_name: names.get(u.id) ?? null,
        // Poradie rolí držíme od najsilnejšej, nech sa dá farbiť podľa prvej.
        roles: APP_ROLES.filter((r) => (roleMap.get(u.id) || []).includes(r)).reverse(),
        created_at: u.created_at ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
        events_count: eventCounts.get(u.id) || 0,
      }))
      .filter((u) => (data.role === "all" ? true : u.roles.includes(data.role as AppRole)))
      .filter((u) =>
        needle
          ? u.email.toLowerCase().includes(needle) ||
            (u.full_name || "").toLowerCase().includes(needle)
          : true,
      )
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  });

/** Pridelí alebo odoberie rolu. Prideľovať smie výhradne admin (vynútené aj RLS). */
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        user_id: z.string().uuid(),
        role: z.enum(["user", "organizer", "admin"]),
        enabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    // Poistka proti zamknutiu sa z konzoly: vlastnú admin rolu si odobrať nedá.
    // Späť by ju vedel vrátiť už len zásah priamo v databáze.
    if (data.user_id === context.userId && data.role === "admin" && !data.enabled) {
      throw new Error("Vlastnú rolu admin si odobrať nemôžeš.");
    }

    if (data.enabled) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.user_id, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.user_id)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/**
 * Založí účet aj s rolou — na organizátora, ktorý sa ešte nezaregistroval.
 * E-mail rovno potvrdzujeme, aby sa vedel prihlásiť bez overovacieho odkazu.
 */
export const createUserWithRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(8).max(200),
        full_name: z.string().min(1).max(200),
        role: z.enum(["user", "organizer", "admin"]).default("organizer"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.userId);

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error || !created?.user) {
      throw new Error(error?.message || "Účet sa nepodarilo vytvoriť");
    }
    const userId = created.user.id;

    // `handle_new_user()` profil aj rolu `user` založí sám; doplníme len meno
    // (trigger ho berie z metadát, ale nespoliehame sa naň) a vyžiadanú rolu.
    await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, full_name: data.full_name }, { onConflict: "id" });
    if (data.role !== "user") {
      const { error: roleErr } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: userId, role: data.role }, { onConflict: "user_id,role" });
      if (roleErr) throw new Error(roleErr.message);
    }
    return { id: userId };
  });
