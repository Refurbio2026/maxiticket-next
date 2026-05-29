import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth, type AppRole } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Flame, User as UserIcon, Building2, ShoppingCart, Shield, ChevronLeft } from "lucide-react";

type Section = "user" | "organizer" | "cashier" | "admin";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Prihlásenie · MAXITICKET" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    section: (s.section as Section | undefined) ?? undefined,
  }),
  component: LoginPage,
});

const SECTIONS: Record<Section, {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  allowedRoles: AppRole[];
  redirect: "/account" | "/organizer" | "/organizer/pos" | "/admin";
}> = {
  user: {
    title: "Používateľský účet",
    description: "Moje vstupenky, objednávky a profil.",
    icon: UserIcon,
    allowedRoles: ["user", "organizer", "admin"],
    redirect: "/account",
  },
  organizer: {
    title: "Organizátor",
    description: "Spravuj svoje podujatia a predaj.",
    icon: Building2,
    allowedRoles: ["organizer", "admin"],
    redirect: "/organizer",
  },
  cashier: {
    title: "Pokladňa",
    description: "POS predaj vstupeniek na mieste.",
    icon: ShoppingCart,
    allowedRoles: ["organizer", "admin"],
    redirect: "/organizer/pos",
  },
  admin: {
    title: "Admin",
    description: "Interná administrácia platformy.",
    icon: Shield,
    allowedRoles: ["admin"],
    redirect: "/admin",
  },
};

function LoginPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const section = search.section as Section | undefined;
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !user || !section) return;
    const cfg = SECTIONS[section];
    if (cfg.allowedRoles.includes(user.role)) {
      navigate({ to: cfg.redirect });
    }
  }, [user, loading, section, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!section) return;
    setBusy(true);
    const res = await signIn(email, password);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const cfg = SECTIONS[section];
    if (!cfg.allowedRoles.includes(res.user.role)) {
      toast.error("Nemáte oprávnenie pre túto sekciu.");
      return;
    }
    toast.success("Prihlásený");
    navigate({ to: cfg.redirect });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4 py-10">
      <Toaster />
      <div className="w-full max-w-3xl">
        <Link to="/" className="flex items-center gap-2 mb-8 justify-center">
          <div className="size-9 rounded-xl bg-gradient-flame grid place-items-center shadow-glow">
            <Flame className="size-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold">
            maxi<span className="text-gradient-flame">ticket</span>
          </span>
        </Link>

        {!section ? <SectionPicker /> : (
          <Card className="max-w-md mx-auto p-8 bg-card/60 backdrop-blur-xl border-border/50">
            <button
              type="button"
              onClick={() => navigate({ to: "/login" })}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
            >
              <ChevronLeft className="size-3.5" /> Späť na výber sekcie
            </button>
            <div className="mb-6">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">
                Prihlásenie · {SECTIONS[section].title}
              </div>
              <h1 className="font-display text-2xl font-bold">{SECTIONS[section].title}</h1>
              <p className="text-sm text-muted-foreground mt-1">{SECTIONS[section].description}</p>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Heslo</Label>
                <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" disabled={busy} className="w-full bg-gradient-flame text-primary-foreground shadow-glow">
                {busy ? "Prihlasujem…" : "Prihlásiť sa"}
              </Button>
            </form>
            <div className="mt-6 text-sm text-muted-foreground text-center">
              Ešte nemáš účet?{" "}
              <Link to="/register" className="text-primary hover:underline">Registruj sa</Link>
            </div>
            <div className="mt-6 p-3 rounded-lg bg-muted/30 border border-border/40 text-xs space-y-1">
              <div className="font-semibold text-foreground mb-1">Demo účty</div>
              <div>admin@maxiticket.sk / admin123</div>
              <div>organizer@maxiticket.sk / organizer123</div>
              <div>user@maxiticket.sk / user123</div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function SectionPicker() {
  return (
    <div>
      <div className="text-center mb-8">
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">Kam sa chceš prihlásiť?</h1>
        <p className="text-sm text-muted-foreground mt-2">Vyber sekciu MAXITICKET, do ktorej patrí tvoj účet.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {(Object.keys(SECTIONS) as Section[]).map((key) => {
          const s = SECTIONS[key];
          const Icon = s.icon;
          return (
            <Link
              key={key}
              to="/login"
              search={{ section: key }}
              className="group rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xl p-6 hover:border-primary/60 hover:bg-card transition-all hover:-translate-y-0.5 hover:shadow-card-premium"
            >
              <div className="flex items-start gap-4">
                <div className="size-12 rounded-xl bg-gradient-flame grid place-items-center shadow-glow shrink-0">
                  <Icon className="size-6 text-primary-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="font-display text-lg font-bold group-hover:text-primary transition-colors">{s.title}</div>
                  <p className="text-sm text-muted-foreground mt-1">{s.description}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="mt-8 text-center text-sm text-muted-foreground">
        Ešte nemáš účet?{" "}
        <Link to="/register" className="text-primary hover:underline">Zaregistrovať sa</Link>
      </div>
    </div>
  );
}
