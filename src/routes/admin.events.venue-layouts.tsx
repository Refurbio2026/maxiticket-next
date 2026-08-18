import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, lazy, Suspense } from "react";
import {
  useLayouts,
  useLayout,
  useUpsertLayout,
  useDeleteLayout,
  toLayoutInput,
} from "@/hooks/use-layouts";
import { emptyLayout, type HallLayout } from "@/lib/layout-types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronRight, Loader2, Plus, Trash2, LayoutGrid } from "lucide-react";
import { toast } from "sonner";

const SeatingEditor = lazy(() =>
  import("@/components/admin/SeatingEditor").then((m) => ({ default: m.SeatingEditor })),
);

export const Route = createFileRoute("/admin/events/venue-layouts")({
  head: () => ({ meta: [{ title: "Editor hál · vipky.sk Admin" }] }),
  component: VenueLayoutsPage,
});

function VenueLayoutsPage() {
  const [mounted, setMounted] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: layouts = [], isLoading } = useLayouts();
  const upsert = useUpsertLayout();
  const del = useDeleteLayout();
  // Zoznam je bez plánu; samotné tvary sa doťahujú až pre otvorenú sálu —
  // po importe zo starého systému majú všetky sály dokopy vyše 45 MB tvarov.
  const { data: activeLayout } = useLayout(activeId ?? undefined);
  const active: HallLayout | null = activeLayout ?? null;

  useEffect(() => setMounted(true), []);

  // Prvá sála sa už nezakladá automaticky — v databáze by sa tak tvorili
  // prázdne záznamy pri každom otvorení editora. Používateľ ju vytvorí sám.
  useEffect(() => {
    if (!activeId && layouts.length > 0) setActiveId(layouts[0].id);
  }, [layouts, activeId]);

  const createNew = async () => {
    try {
      const fresh = emptyLayout(`Nová hala ${layouts.length + 1}`);
      const { id } = await upsert.mutateAsync(toLayoutInput(fresh, { id: undefined }));
      setActiveId(id);
      toast.success("Vytvorené nové rozloženie");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rozloženie sa nepodarilo vytvoriť");
    }
  };

  const deleteActive = async () => {
    if (!active) return;
    if (!confirm(`Zmazať rozloženie „${active.name}"?`)) return;
    try {
      await del.mutateAsync(active.id);
      setActiveId(null);
      toast.success("Rozloženie zmazané");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Zmazanie zlyhalo");
    }
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
              <Link to="/admin" className="hover:text-foreground">
                Admin
              </Link>
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
              // Editor ukladá cez `useUpsertLayout`, ktorý invaliduje cache —
              // zoznam sa obnoví sám.
              onChange={() => {}}
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
