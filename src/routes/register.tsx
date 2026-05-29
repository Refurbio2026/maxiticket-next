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
  head: () => ({ meta: [{ title: "Registrácia · MAXITICKET" }] }),
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
    company_name: "",
    ico: "",
    dic: "",
    ic_dph: "",
    billing_address: "",
    phone: "",
  });
  const [busy, setBusy] = useState(false);

  const upd = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

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
    if (accountType === "organizer" && !form.company_name.trim()) {
      toast.error("Vyplňte názov spoločnosti");
      return;
    }
    setBusy(true);
    const res = await signUp({
      email: form.email,
      password: form.password,
      first_name: form.first_name,
      last_name: form.last_name,
      role: accountType,
      company_name: form.company_name || undefined,
      ico: form.ico || undefined,
      dic: form.dic || undefined,
      ic_dph: form.ic_dph || undefined,
      billing_address: form.billing_address || undefined,
      phone: form.phone || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Účet vytvorený");
    navigate({ to: accountType === "organizer" ? "/organizer" : "/account" });
  };

  return (
    <div className="dark min-h-screen flex items-center justify-center bg-background text-foreground px-4 py-10">
      <Toaster />
      <Card className="w-full max-w-xl p-8 bg-card/60 backdrop-blur-xl border-border/50">
        <Link to="/" className="flex items-center gap-2 mb-6">
          <div className="size-9 rounded-xl bg-gradient-flame grid place-items-center shadow-glow">
            <Flame className="size-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold">
            maxi<span className="text-gradient-flame">ticket</span>
          </span>
        </Link>
        <h1 className="font-display text-2xl font-bold mb-1">Vytvor si účet</h1>
        <p className="text-sm text-muted-foreground mb-6">Pridaj sa k MAXITICKET v pár sekundách.</p>

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
                <div className="font-semibold">{t === "user" ? "Bežný používateľ" : "Organizátor"}</div>
                <div className="text-xs mt-1 opacity-80">
                  {t === "user" ? "Nákup vstupeniek a správa účtu." : "Pridávanie a správa podujatí."}
                </div>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">Meno</Label>
              <Input id="first_name" required value={form.first_name} onChange={(e) => upd("first_name", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Priezvisko</Label>
              <Input id="last_name" required value={form.last_name} onChange={(e) => upd("last_name", e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={form.email} onChange={(e) => upd("email", e.target.value)} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="password">Heslo</Label>
              <Input id="password" type="password" required minLength={6} value={form.password} onChange={(e) => upd("password", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Potvrdenie hesla</Label>
              <Input id="confirm" type="password" required minLength={6} value={form.confirm} onChange={(e) => upd("confirm", e.target.value)} />
            </div>
          </div>

          {accountType === "organizer" && (
            <div className="space-y-4 p-4 rounded-xl border border-border/50 bg-muted/10">
              <div className="font-semibold text-sm">Fakturačné údaje organizátora</div>
              <div className="space-y-2">
                <Label htmlFor="company_name">Názov spoločnosti</Label>
                <Input id="company_name" required value={form.company_name} onChange={(e) => upd("company_name", e.target.value)} />
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ico">IČO</Label>
                  <Input id="ico" value={form.ico} onChange={(e) => upd("ico", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dic">DIČ</Label>
                  <Input id="dic" value={form.dic} onChange={(e) => upd("dic", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ic_dph">IČ DPH</Label>
                  <Input id="ic_dph" value={form.ic_dph} onChange={(e) => upd("ic_dph", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="billing_address">Fakturačná adresa</Label>
                <Input id="billing_address" value={form.billing_address} onChange={(e) => upd("billing_address", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefón</Label>
                <Input id="phone" value={form.phone} onChange={(e) => upd("phone", e.target.value)} />
              </div>
            </div>
          )}

          <Button type="submit" disabled={busy} className="w-full bg-gradient-flame text-primary-foreground shadow-glow">
            {busy ? "Registrujem…" : "Vytvoriť účet"}
          </Button>
        </form>
        <div className="mt-6 text-sm text-muted-foreground text-center">
          Už máš účet?{" "}
          <Link to="/login" className="text-primary hover:underline">Prihlás sa</Link>
        </div>
      </Card>
    </div>
  );
}
