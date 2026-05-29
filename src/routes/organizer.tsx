import { createFileRoute, Outlet, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { OrganizerSidebar } from "@/components/organizer/OrganizerSidebar";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { LogOut, ShoppingCart, User } from "lucide-react";

export const Route = createFileRoute("/organizer")({
  head: () => ({ meta: [{ title: "Organizer · MAXITICKET" }] }),
  component: OrganizerLayout,
});

function OrganizerLayout() {
  const { user, loading, isOrganizer, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login" });
    else if (!isOrganizer) navigate({ to: "/account" });
  }, [loading, user, isOrganizer, navigate]);

  if (loading || !user || !isOrganizer) {
    return (
      <div className="min-h-screen bg-background text-foreground grid place-items-center">
        <div className="text-sm text-muted-foreground">Overujem prístup…</div>
      </div>
    );
  }

  return (
    <div className="">
      <SidebarProvider style={{ "--sidebar-width": "16rem", "--sidebar-width-icon": "3.5rem" } as React.CSSProperties}>
        <div className="flex min-h-screen w-full bg-background text-foreground">
          <OrganizerSidebar />
          <SidebarInset className="flex flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/40 bg-background/80 px-4 backdrop-blur-xl md:px-6">
              <SidebarTrigger className="-ml-1" />
              <div className="ml-auto flex items-center gap-2">
                <Button asChild className="bg-gradient-flame text-primary-foreground shadow-glow">
                  <Link to="/organizer/pos"><ShoppingCart className="size-4 mr-2" /> Pokladňa</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/account"><User className="size-4 mr-1.5" /> {user.full_name || user.email}</Link>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => signOut()}>
                  <LogOut className="size-4 mr-1.5" /> Odhlásiť
                </Button>
              </div>
            </header>
            <main className="flex-1 p-4 md:p-6 lg:p-8">
              <Outlet />
            </main>
          </SidebarInset>
        </div>
        <Toaster />
      </SidebarProvider>
    </div>
  );
}
