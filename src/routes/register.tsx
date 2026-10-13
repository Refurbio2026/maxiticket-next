import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Flame } from "lucide-react";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "Registrácia · eticketo.eu" }] }),
  component: RegisterPage,
});

type AccountType = "user" | "organizer";

function RegisterPage() {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [accountType, setAccountType] = useState<AccountType>("user");
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [busy, setBusy] = useState(false);

  const upd = <K extends keyof typeof form>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 6) {
      toast.error("Heslo musí mať aspoň 6 znakov");
      return;
    }
    if (form.password !== form.confirm) {
      toast.error("Heslá sa nezhodujú");
      return;
    }
    setBusy(true);
    const res = await signUp({
      email: form.email,
      password: form.password,
      first_name: form.first_name,
      last_name: form.last_name,
      role: accountType,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Účet vytvorený");
    // Organizátora vedieme rovno do sprievodcu — rolu dostane až po schválení,
    // takže do `/organizer` by ho stráž pustiť nemohla.
    navigate({ to: accountType === "organizer" ? "/onboarding" : "/account" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4 py-10">
      <Toaster />
      <Card className="w-full max-w-xl p-8 bg-card/60 backdrop-blur-xl border-border/50">
        <Link to="/" className="flex items-center gap-2 mb-6">
          <div className="size-9 rounded-xl bg-gradient-flame grid place-items-center shadow-glow">
            <Flame className="size-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold">
            eticketo<span className="text-gradient-flame">.sk</span>
          </span>
        </Link>
        <h1 className="font-display text-2xl font-bold mb-1">Vytvor si účet</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Stačí e-mail a heslo. Organizátora potom prevedieme nastavením účtu.
        </p>

        <div className="mb-6">
          <Label className="mb-2 block">Typ účtu</Label>
          <div className="grid grid-cols-2 gap-3">
            {(["user", "organizer"] as AccountType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setAccountType(t)}
                className={`p-4 rounded-xl border text-left transition ${
                  accountType === t
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/50 bg-muted/20 text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="font-semibold">
                  {t === "user" ? "Bežný používateľ" : "Organizátor"}
                </div>
                <div className="text-xs mt-1 opacity-80">
                  {t === "user"
                    ? "Nákup vstupeniek a správa účtu."
                    : "Predaj vstupeniek, vlastná adresa profilu."}
                </div>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">Meno</Label>
              <Input
                id="first_name"
                required
                value={form.first_name}
                onChange={(e) => upd("first_name", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Priezvisko</Label>
              <Input
                id="last_name"
                required
                value={form.last_name}
                onChange={(e) => upd("last_name", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={form.email}
              onChange={(e) => upd("email", e.target.value)}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="password">Heslo</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={form.password}
                onChange={(e) => upd("password", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Potvrdenie hesla</Label>
              <Input
                id="confirm"
                type="password"
                required
                minLength={6}
                value={form.confirm}
                onChange={(e) => upd("confirm", e.target.value)}
              />
            </div>
          </div>

          {accountType === "organizer" && (
            <div className="space-y-2 rounded-xl border border-border/50 bg-muted/10 p-4 text-sm">
              <div className="font-semibold">Čo bude po registrácii</div>
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>Prevedieme ťa nastavením profilu — názov, logo, vlastná adresa, siete.</li>
                <li>Doplníš fakturačné údaje a číslo účtu na výplatu tržby.</li>
                <li>Žiadosť si pozrieme a účet schválime; ozveme sa e-mailom.</li>
              </ol>
              <p className="text-xs text-muted-foreground">
                Rozpracované sa ukladá, takže to nemusíš stihnúť naraz.
              </p>
            </div>
          )}

          <Button
            type="submit"
            disabled={busy}
            className="w-full bg-gradient-flame text-primary-foreground shadow-glow"
          >
            {busy ? "Registrujem…" : "Vytvoriť účet"}
          </Button>
        </form>
        <div className="mt-6 text-sm text-muted-foreground text-center">
          Už máš účet?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Prihlás sa
          </Link>
        </div>
      </Card>
    </div>
  );
}
