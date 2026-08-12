import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, MapPin, Pencil, Plus, Trash2, LayoutGrid } from "lucide-react";
import { listVenues, upsertVenue, deleteVenue, type VenueRecord } from "@/lib/venues.functions";
import { useLayouts } from "@/hooks/use-layouts";

export const Route = createFileRoute("/admin/events/venues")({
  head: () => ({ meta: [{ title: "Miesta konania · vipky.sk Admin" }] }),
  component: Page,
});

const NO_LAYOUT = "__none__";

type Form = {
  id?: string;
  name: string;
  city: string;
  address: string;
  note: string;
  default_layout_id: string;
};

const emptyForm: Form = {
  name: "",
  city: "",
  address: "",
  note: "",
  default_layout_id: NO_LAYOUT,
};

function Page() {
  const qc = useQueryClient();
  const fetchVenues = useServerFn(listVenues);
  const saveVenue = useServerFn(upsertVenue);
  const removeVenue = useServerFn(deleteVenue);
  const { data: layouts = [] } = useLayouts();

  const [editing, setEditing] = useState<Form | null>(null);

  const venues = useQuery({
    queryKey: ["venues"],
    queryFn: () => fetchVenues({ data: undefined as never }),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("Nie je čo uložiť");
      return saveVenue({
        data: {
          id: editing.id,
          name: editing.name,
          city: editing.city,
          address: editing.address || null,
          note: editing.note || null,
          default_layout_id:
            editing.default_layout_id === NO_LAYOUT ? null : editing.default_layout_id,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["venues"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success("Miesto uložené");
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeVenue({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["venues"] });
      toast.success("Miesto zmazané");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const rows = venues.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Miesta konania</h1>
          <p className="text-muted-foreground mt-1">
            Haly, štadióny a kultúrne miesta. Podujatie si z miesta vezme adresu aj predvolenú
            sálu.
          </p>
        </div>
        <Button
          onClick={() => setEditing({ ...emptyForm })}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          <Plus className="size-4 mr-2" /> Nové miesto
        </Button>
      </div>

      <Card className="bg-card/60 border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Miesto</th>
                <th className="px-4 py-3 font-medium">Adresa</th>
                <th className="px-4 py-3 font-medium">Predvolená sála</th>
                <th className="px-4 py-3 font-medium text-right">Podujatia</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {venues.isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </td>
                </tr>
              )}
              {!venues.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    Zatiaľ žiadne miesto. Pridaj prvé tlačidlom hore.
                  </td>
                </tr>
              )}
              {rows.map((v: VenueRecord) => (
                <tr key={v.id} className="border-b border-border/30 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium">
                      <MapPin className="size-3.5 text-muted-foreground" />
                      {v.name}
                    </div>
                    <div className="text-xs text-muted-foreground">{v.city}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{v.address || "—"}</td>
                  <td className="px-4 py-3">
                    {v.default_layout_name ? (
                      <Link
                        to="/admin/events/venue-layouts"
                        className="inline-flex items-center gap-1.5 text-primary hover:underline"
                      >
                        <LayoutGrid className="size-3.5" />
                        {v.default_layout_name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{v.events_count || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEditing({
                            id: v.id,
                            name: v.name,
                            city: v.city,
                            address: v.address ?? "",
                            note: v.note ?? "",
                            default_layout_id: v.default_layout_id ?? NO_LAYOUT,
                          })
                        }
                      >
                        <Pencil className="size-3.5 mr-1.5" /> Upraviť
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm(`Zmazať miesto „${v.name}"?`)) deleteMutation.mutate(v.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Upraviť miesto" : "Nové miesto"}</DialogTitle>
            <DialogDescription>
              Premenovanie sa prepíše aj do podujatí, ktoré sa tu konajú.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Názov</Label>
                <Input
                  autoFocus
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Mesto</Label>
                <Input
                  value={editing.city}
                  onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Adresa</Label>
                <Input
                  value={editing.address}
                  onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Predvolená sála</Label>
                <Select
                  value={editing.default_layout_id}
                  onValueChange={(v) => setEditing({ ...editing, default_layout_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LAYOUT}>Bez sály (státie)</SelectItem>
                    {layouts.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Nové podujatie na tomto mieste ju dostane predvyplnenú.
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Poznámka</Label>
                <Textarea
                  rows={2}
                  value={editing.note}
                  onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !editing?.name || !editing?.city}
            >
              {saveMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Uložiť
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
