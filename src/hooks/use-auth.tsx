import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureSeed, type Role } from "@/lib/local-db";

// AUTH — now backed by Supabase Auth (was localStorage demo before).
// The public interface (user/roles/loading/isAdmin/isOrganizer/signIn/signUp/
// signOut) is unchanged, so login.tsx / register.tsx need no edits. Roles come
// from the `user_roles` table; a fresh sign-up is always role "user" (the
// handle_new_user DB trigger), and organizer/admin must be granted by an admin
// (enforced by RLS) — self-assignment is intentionally not possible.

export type AppRole = Role;

export type AuthUser = {
  id: string;
  email: string;
  full_name?: string;
  role: AppRole;
};

type SignUpInput = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: "user" | "organizer";
  company_name?: string;
  ico?: string;
  dic?: string;
  ic_dph?: string;
  billing_address?: string;
  phone?: string;
};

type AuthResult = { ok: true; user: AuthUser } | { ok: false; error: string };

type AuthCtx = {
  user: AuthUser | null;
  roles: AppRole[];
  loading: boolean;
  isAdmin: boolean;
  isOrganizer: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (input: SignUpInput) => Promise<AuthResult>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  roles: [],
  loading: true,
  isAdmin: false,
  isOrganizer: false,
  signIn: async () => ({ ok: false, error: "not-ready" }),
  signUp: async () => ({ ok: false, error: "not-ready" }),
  signOut: async () => {},
});

// Pick the highest-privilege role the user holds.
async function fetchPrimaryRole(userId: string): Promise<AppRole> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  if (roles.includes("admin")) return "admin";
  if (roles.includes("organizer")) return "organizer";
  return "user";
}

type SupabaseUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: { full_name?: string } | null;
};

async function toAuthUser(u: SupabaseUserLike | null | undefined): Promise<AuthUser | null> {
  if (!u) return null;
  const role = await fetchPrimaryRole(u.id);
  return {
    id: u.id,
    email: u.email ?? "",
    full_name: u.user_metadata?.full_name,
    role,
  };
}

function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "Nesprávny email alebo heslo";
  if (m.includes("email not confirmed")) return "Email ešte nie je potvrdený. Skontroluj si schránku.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "Účet s týmto emailom už existuje";
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Keep seeding demo events/categories so public pages still have content.
    ensureSeed();

    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      const au = await toAuthUser(data.session?.user);
      if (active) {
        setUser(au);
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const au = await toAuthUser(session?.user);
      if (active) setUser(au);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn: AuthCtx["signIn"] = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      return { ok: false, error: translateAuthError(error?.message ?? "Prihlásenie zlyhalo") };
    }
    const au = await toAuthUser(data.user);
    if (!au) return { ok: false, error: "Prihlásenie zlyhalo" };
    setUser(au);
    return { ok: true, user: au };
  };

  const signUp: AuthCtx["signUp"] = async (input) => {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          full_name: `${input.first_name} ${input.last_name}`.trim(),
          first_name: input.first_name,
          last_name: input.last_name,
          requested_role: input.role, // organizer requests need admin approval
          company_name: input.company_name,
          ico: input.ico,
          dic: input.dic,
          ic_dph: input.ic_dph,
          billing_address: input.billing_address,
          phone: input.phone,
        },
      },
    });
    if (error) return { ok: false, error: translateAuthError(error.message) };

    // Email-confirmation ON → no session yet; user must confirm before login.
    if (!data.session) {
      return {
        ok: false,
        error: "Účet vytvorený. Skontroluj si email a potvrď registráciu, potom sa prihlás.",
      };
    }
    const au = await toAuthUser(data.user);
    if (!au) return { ok: false, error: "Registrácia zlyhala" };
    setUser(au);
    return { ok: true, user: au };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const roles: AppRole[] = user ? [user.role] : [];
  const isAdmin = user?.role === "admin";
  const isOrganizer = user?.role === "organizer" || user?.role === "admin";

  return (
    <Ctx.Provider value={{ user, roles, loading, isAdmin, isOrganizer, signIn, signUp, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
