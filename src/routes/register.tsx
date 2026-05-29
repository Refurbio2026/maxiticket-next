import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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

function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: name },
      },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Účet vytvorený");
      navigate({ to: "/account" });
    }
  };

  return (
    <div className="dark min-h-screen flex items-center justify-center bg-background text-foreground px-4">
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
        <h1 className="font-display text-2xl font-bold mb-1">Vytvor si účet</h1>
        <p className="text-sm text-muted-foreground mb-6">Pridaj sa k MAXITICKET v pár sekundách.</p>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Celé meno</Label>
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Heslo</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
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
