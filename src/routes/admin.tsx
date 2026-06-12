import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminTopbar } from "@/components/admin/AdminTopbar";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "vstupenky.sk Admin Console" },
      { name: "description", content: "Interný admin systém pre ticketing platformu vstupenky.sk." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const { user, loading, isAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login" });
    else if (!isAdmin) navigate({ to: "/account" });
  }, [loading, user, isAdmin, navigate]);

  if (loading || !user || !isAdmin) {
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
          <AdminSidebar />
          <SidebarInset className="flex flex-1 flex-col">
            <AdminTopbar />
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

