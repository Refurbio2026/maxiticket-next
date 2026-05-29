import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { User, Ticket, LogOut, Calendar } from "lucide-react";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Môj účet · MAXITICKET" }] }),
  component: AccountPage,
});

function AccountPage() {
  const { user, roles, loading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading || !user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 pt-32 pb-20">
        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight">Môj účet</h1>
            <p className="text-muted-foreground mt-1">{user.email}</p>
            <div className="flex gap-2 mt-3">
              {roles.map((r) => (
                <span key={r} className="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/15 text-primary border border-primary/30">
                  {r}
                </span>
              ))}
            </div>
          </div>
          <Button variant="outline" onClick={() => signOut().then(() => navigate({ to: "/" }))}>
            <LogOut className="size-4 mr-2" /> Odhlásiť
          </Button>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Card className="p-6 bg-card/60 border-border/50">
            <Ticket className="size-6 text-primary mb-3" />
            <div className="font-semibold">Moje vstupenky</div>
            <p className="text-sm text-muted-foreground mt-1">Vstupenky sa zobrazia po prvom nákupe.</p>
          </Card>
          <Card className="p-6 bg-card/60 border-border/50">
            <Calendar className="size-6 text-primary mb-3" />
            <div className="font-semibold">Objavuj podujatia</div>
            <Link to="/events" className="text-sm text-primary hover:underline mt-2 inline-block">
              Prejsť na podujatia →
            </Link>
          </Card>
          <Card className="p-6 bg-card/60 border-border/50">
            <User className="size-6 text-primary mb-3" />
            <div className="font-semibold">Profil</div>
            <p className="text-sm text-muted-foreground mt-1">Bezpečné a šifrované údaje.</p>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
