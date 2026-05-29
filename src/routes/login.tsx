import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Flame } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Prihlásenie · MAXITICKET" }] }),
  component: LoginPage,
});

function routeForRole(role: string) {
  if (role === "admin") return "/admin" as const;
  if (role === "organizer") return "/organizer" as const;
  return "/account" as const;
}

function LoginPage() {
  const navigate = useNavigate();
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    navigate({ to: routeForRole(user.role) });
  }, [user, loading, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await signIn(email, password);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Prihlásený");
    navigate({ to: routeForRole(res.user.role) });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
      <Toaster />
      <Card className="w-full max-w-md p-8 bg-card/60 backdrop-blur-xl border-border/50">
        <Link to="/" className="flex items-center gap-2 mb-6">
          <div className="size-9 rounded-xl bg-gradient-flame grid place-items-center shadow-glow">
            <Flame className="size-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold">
            maxi<span className="text-gradient-flame">ticket</span>
          </span>
        </Link>
        <h1 className="font-display text-2xl font-bold mb-1">Prihlásenie</h1>
        <p className="text-sm text-muted-foreground mb-6">Vitaj späť. Prihlás sa do svojho účtu.</p>
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
    </div>
  );
}
