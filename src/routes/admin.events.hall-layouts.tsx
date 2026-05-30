import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  listLayouts,
  deleteLayout,
  duplicateLayout,
  emptyLayout,
  upsertLayout,
  computeCapacity,
  HALL_TYPE_LABEL,
  LAYOUTS_EVENT,
  type HallLayout,
} from "@/lib/layouts-db";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/events/hall-layouts")({
  head: () => ({ meta: [{ title: "Definície rozloženia haly · MAXITICKET Admin" }] }),
  component: Page,
});

function Page() {
  const navigate = useNavigate();
  const [items, setItems] = useState<HallLayout[]>([]);

  useEffect(() => {
    const refresh = () => setItems(listLayouts());
    refresh();
    window.addEventListener(LAYOUTS_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LAYOUTS_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const handleCreate = () => {
    const l = emptyLayout();
    upsertLayout(l);
    navigate({ to: "/admin/events/hall-layouts/$id", params: { id: l.id } });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Definície rozloženia haly</h1>
          <p className="text-sm text-muted-foreground">
            Vizuálny editor sektorov, radov a sedadiel pre podujatia.
          </p>
        </div>
        <Button onClick={handleCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Nová hala
        </Button>
      </div>

      <div className="rounded-lg border border-border/40 bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Názov</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead>Mesto</TableHead>
              <TableHead className="text-right">Kapacita</TableHead>
              <TableHead>Aktualizované</TableHead>
              <TableHead className="text-right">Akcie</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">
                  Zatiaľ žiadne haly. Klikni na „Nová hala“ a otvor editor.
                </TableCell>
              </TableRow>
            )}
            {items.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.name}</TableCell>
                <TableCell>{HALL_TYPE_LABEL[l.type]}</TableCell>
                <TableCell>{l.city ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.capacity ?? computeCapacity(l.shapes)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(l.updated_at).toLocaleString("sk-SK")}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/admin/events/hall-layouts/$id" params={{ id: l.id }}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        duplicateLayout(l.id);
                        toast.success("Hala duplikovaná");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Zmazať halu „${l.name}“?`)) {
                          deleteLayout(l.id);
                          toast.success("Hala zmazaná");
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
