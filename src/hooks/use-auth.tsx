import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  ensureSeed,
  getCurrentUser,
  setCurrentUserId,
  findUserByEmail,
  getUsers,
  saveUsers,
  uid,
  emit,
  AUTH_EVENT,
  type Role,
  type StoredUser,
} from "@/lib/local-db";

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

type AuthCtx = {
  user: AuthUser | null;
  roles: AppRole[];
  loading: boolean;
  isAdmin: boolean;
  isOrganizer: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }>;
  signUp: (input: SignUpInput) => Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }>;
  signOut: () => Promise<void>;
};

function toAuthUser(u: StoredUser | null): AuthUser | null {
  if (!u) return null;
  return { id: u.id, email: u.email, full_name: u.full_name, role: u.role };
}

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ensureSeed();
    setUser(toAuthUser(getCurrentUser()));
    setLoading(false);

    const refresh = () => setUser(toAuthUser(getCurrentUser()));
    window.addEventListener(AUTH_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(AUTH_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const signIn: AuthCtx["signIn"] = async (email, password) => {
    const found = findUserByEmail(email);
    if (!found || found.password !== password) {
      return { ok: false, error: "Nesprávny email alebo heslo" };
    }
    setCurrentUserId(found.id);
    const au = toAuthUser(found)!;
    setUser(au);
    emit(AUTH_EVENT);
    return { ok: true, user: au };
  };

  const signUp: AuthCtx["signUp"] = async (input) => {
    if (findUserByEmail(input.email)) {
      return { ok: false, error: "Účet s týmto emailom už existuje" };
    }
    const newUser: StoredUser = {
      id: uid(),
      email: input.email,
      password: input.password,
      role: input.role,
      first_name: input.first_name,
      last_name: input.last_name,
      full_name: `${input.first_name} ${input.last_name}`.trim(),
      company_name: input.company_name,
      ico: input.ico,
      dic: input.dic,
      ic_dph: input.ic_dph,
      billing_address: input.billing_address,
      phone: input.phone,
      created_at: new Date().toISOString(),
    };
    const users = getUsers();
    users.push(newUser);
    saveUsers(users);
    setCurrentUserId(newUser.id);
    const au = toAuthUser(newUser)!;
    setUser(au);
    emit(AUTH_EVENT);
    return { ok: true, user: au };
  };

  const signOut = async () => {
    setCurrentUserId(null);
    setUser(null);
    emit(AUTH_EVENT);
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
