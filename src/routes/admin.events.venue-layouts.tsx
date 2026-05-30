import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, lazy, Suspense } from "react";
import {
  listLayouts,
  getLayout,
  emptyLayout,
  upsertLayout,
  deleteLayout,
  LAYOUTS_EVENT,
  type HallLayout,
} from "@/lib/layouts-db";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  LayoutGrid,
} from "lucide-react";
import { toast } from "sonner";

const SeatingEditor = lazy(() =>
  import("@/components/admin/SeatingEditor").then((m) => ({ default: m.SeatingEditor })),
);

export const Route = createFileRoute("/admin/events/venue-layouts")({
  head: () => ({ meta: [{ title: "Editor hál · MAXITICKET Admin" }] }),
  component: VenueLayoutsPage,
});

function VenueLayoutsPage() {
  const [mounted, setMounted] = useState(false);
  const [layouts, setLayouts] = useState<HallLayout[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<HallLayout | null>(null);

  // load list and pick the most recent (or create one)
  useEffect(() => {
    setMounted(true);
    const refresh = () => setLayouts(listLayouts());
    refresh();
    window.addEventListener(LAYOUTS_EVENT, refresh);
    return () => window.removeEventListener(LAYOUTS_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (activeId) return;
    const list = listLayouts();
    if (list.length > 0) {
      setActiveId(list[0].id);
    } else {
      const l = emptyLayout("Nová hala");
      upsertLayout(l);
      setActiveId(l.id);
    }
  }, [mounted, activeId]);

  useEffect(() => {
    if (!activeId) return;
    setActive(getLayout(activeId) ?? null);
  }, [activeId]);

  const createNew = () => {
    const l = emptyLayout(`Nová hala ${layouts.length + 1}`);
    upsertLayout(l);
    setActiveId(l.id);
    toast.success("Vytvorené nové rozloženie");
  };

  const deleteActive = () => {
    if (!active) return;
    if (!confirm(`Zmazať rozloženie „${active.name}"?`)) return;
    deleteLayout(active.id);
    const remaining = listLayouts();
    if (remaining.length > 0) {
      setActiveId(remaining[0].id);
    } else {
      const l = emptyLayout("Nová hala");
      upsertLayout(l);
      setActiveId(l.id);
    }
    toast.success("Rozloženie zmazané");
  };

  return (
    <div className="-m-4 md:-m-6 flex h-[calc(100vh-4rem)] flex-col">
      {/* Top bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 bg-card/60 px-4 py-2 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
            <LayoutGrid className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold leading-tight">Editor hál</h1>
            <nav className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Link to="/admin" className="hover:text-foreground">Admin</Link>
              <ChevronRight className="h-3 w-3" />
              <span>Podujatia</span>
              <ChevronRight className="h-3 w-3" />
              <span className="text-foreground font-medium">Editor hál</span>
            </nav>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {layouts.length > 0 && activeId && (
            <Select value={activeId} onValueChange={setActiveId}>
              <SelectTrigger className="h-8 w-56 text-xs">
                <SelectValue placeholder="Vyber rozloženie" />
              </SelectTrigger>
              <SelectContent>
                {layouts.map((l) => (
                  <SelectItem key={l.id} value={l.id} className="text-xs">
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="outline" onClick={createNew} className="gap-1.5 h-8">
            <Plus className="h-3.5 w-3.5" />
            Nové rozloženie
          </Button>
          {active && (
            <Button
              size="sm"
              variant="ghost"
              onClick={deleteActive}
              className="gap-1.5 h-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </header>

      {/* Editor canvas */}
      <div className="flex-1 min-h-0">
        {mounted && active ? (
          <Suspense fallback={<EditorLoader />}>
            <SeatingEditor
              key={active.id}
              initial={active}
              onChange={(l) => {
                setLayouts(listLayouts());
              }}
            />
          </Suspense>
        ) : (
          <EditorLoader />
        )}
      </div>
    </div>
  );
}

function EditorLoader() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}
