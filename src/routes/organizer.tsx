import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Navbar } from "@/components/site/Navbar";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/organizer")({
  head: () => ({ meta: [{ title: "Organizer · MAXITICKET" }] }),
  component: OrganizerLayout,
});

function OrganizerLayout() {
  const { user, loading, isOrganizer } = useAuth();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login" });
    else if (!isOrganizer) navigate({ to: "/account" });
  }, [loading, user, isOrganizer, navigate]);

  if (loading || !user || !isOrganizer) return null;

  const tabs: { to: string; label: string; exact?: boolean }[] = [
    { to: "/organizer", label: "Prehľad", exact: true },
    { to: "/organizer/events/new", label: "Pridať podujatie" },
    { to: "/organizer/pos", label: "Pokladňa" },
  ];


  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster />
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 pt-28 pb-20">
        <div className="flex items-center gap-2 border-b border-border/40 mb-8 overflow-x-auto">
          {tabs.map((t) => {
            const active = t.exact ? path === t.to : path.startsWith(t.to);
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition ${
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
        <Outlet />
      </main>
    </div>
  );
}
