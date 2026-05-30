import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, lazy, Suspense } from "react";
import { getLayout, type HallLayout } from "@/lib/layouts-db";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronRight, Loader2 } from "lucide-react";

const SeatingEditor = lazy(() =>
  import("@/components/admin/SeatingEditor").then((m) => ({ default: m.SeatingEditor })),
);

export const Route = createFileRoute("/admin/events/hall-layouts/$id")({
  head: () => ({ meta: [{ title: "Editor haly · MAXITICKET Admin" }] }),
  component: EditorPage,
});

function EditorPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [layout, setLayout] = useState<HallLayout | null | undefined>(undefined);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const l = getLayout(id);
    setLayout(l ?? null);
  }, [id]);

  if (layout === undefined) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (layout === null) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-xl font-semibold">Rozloženie sa nenašlo</h1>
        <Button variant="outline" onClick={() => navigate({ to: "/admin/events/hall-layouts" })}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Späť na zoznam
        </Button>
      </div>
    );
  }

  return (
    <div className="-m-4 md:-m-6 flex h-[calc(100vh-4rem)] flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 border-b border-border/40 bg-card/60 px-4 py-2 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link to="/admin/events/hall-layouts">
              <ArrowLeft className="h-4 w-4" />
              Späť
            </Link>
          </Button>
          <nav className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground truncate">
            <Link to="/admin" className="hover:text-foreground">
              Admin
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span>Podujatia</span>
            <ChevronRight className="h-3 w-3" />
            <Link to="/admin/events/hall-layouts" className="hover:text-foreground">
              Definície rozloženia haly
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium truncate">{layout.name}</span>
          </nav>
        </div>
      </header>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        {mounted ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            }
          >
            <SeatingEditor initial={layout} onChange={setLayout} />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
