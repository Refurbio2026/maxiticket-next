import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  listPriceCategories,
  upsertPriceCategory,
  deletePriceCategory,
  type PriceCategoryRecord,
} from "@/lib/price-categories.functions";

export const Route = createFileRoute("/admin/data/price-categories")({
  head: () => ({ meta: [{ title: "Cenové kategórie · vipky.sk Admin" }] }),
  component: Page,
});

type Form = {
  id?: string;
  name: string;
  color: string;
  description: string;
  sort_order: string;
  active: boolean;
};

const emptyForm: Form = {
  name: "",
  color: "#22c55e",
  description: "",
  sort_order: "100",
  active: true,
};

function Page() {
  const qc = useQueryClient();
  const fetchCategories = useServerFn(listPriceCategories);
  const saveCategory = useServerFn(upsertPriceCategory);
  const removeCategory = useServerFn(deletePriceCategory);
  const [editing, setEditing] = useState<Form | null>(null);

  const categories = useQuery({
    queryKey: ["price-categories"],
    queryFn: () => fetchCategories({ data: {} }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["price-categories"] });
    qc.invalidateQueries({ queryKey: ["event-zone-prices"] });
  };

  const saveMutation = useMutation({
    mutationFn: (form: Form) =>
      saveCategory({
        data: {
          id: form.id,
          name: form.name,
          color: form.color || null,
          description: form.description || null,
          sort_order: Number(form.sort_order) || 100,
          active: form.active,
        },
      }),
    onSuccess: (_r, form) => {
      invalidate();
      toast.success(form.id ? "Zóna upravená" : "Zóna pridaná");
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeCategory({ data: { id } }),
    onSuccess: (res) => {
      invalidate();
      toast.success(
        res.deactivated
          ? `Zónu používa ${res.events_count} podujatí — namiesto zmazania je deaktivovaná.`
          : "Zmazané",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const rows = categories.data ?? [];

  const toForm = (c: PriceCategoryRecord): Form => ({
    id: c.id,
    name: c.name,
    color: c.color ?? "#22c55e",
    description: c.description ?? "",
    sort_order: String(c.sort_order),
    active: c.active,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Cenové kategórie</h1>
          <p className="text-muted-foreground mt-1">
            Zóny sály (Regular, VIP, Premium, …). Sedadlám ich priraďuje{" "}
            <Link to="/admin/events/venue-layouts" className="text-primary hover:underline">
              Editor hál
            </Link>
            , konkrétnu cenu dostávajú až v podujatí.
          </p>
        </div>
        <Button
          onClick={() => setEditing({ ...emptyForm })}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          <Plus className="size-4 mr-2" /> Nová zóna
        </Button>
      </div>

      <Card className="bg-card/60 border-border/50 overflow-x-auto">
        {categories.isLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">Žiadne zóny.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Zóna</th>
                <th className="px-4 py-3 font-medium">Popis</th>
                <th className="px-4 py-3 font-medium">Farba v mape</th>
                <th className="px-4 py-3 font-medium text-right">Poradie</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-border/30 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium">
                      <span
                        className="size-3 rounded-full border border-border/50"
                        style={{ background: c.color ?? "transparent" }}
                      />
                      {c.name}
                      {!c.active && (
                        <Badge variant="outline" className="text-[10px]">
                          skrytá
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">{c.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[320px]">
                    {c.description ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {c.color ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {c.sort_order}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(toForm(c))}>
                        <Pencil className="size-3.5 mr-1.5" /> Upraviť
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm(`Zmazať zónu „${c.name}"?`)) deleteMutation.mutate(c.id);
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
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Upraviť zónu" : "Nová zóna"}</DialogTitle>
            <DialogDescription>
              Premenovanie zóny neprepíše už uložené rozloženia sál — tie si názov nesú v sebe.
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
                <Label>Farba v mape</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    className="w-14 p-1"
                    value={editing.color}
                    onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                  />
                  <Input
                    value={editing.color}
                    onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Poradie</Label>
                <Input
                  type="number"
                  min={0}
                  value={editing.sort_order}
                  onChange={(e) => setEditing({ ...editing, sort_order: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Popis</Label>
                <Textarea
                  rows={2}
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Ponúkať v editore hál</Label>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={editing.active}
                    onCheckedChange={(v) => setEditing({ ...editing, active: v })}
                  />
                  <span className="text-xs text-muted-foreground">
                    Skrytá zóna sa nedá priradiť novým sedadlám, existujúce si ju nechajú.
                  </span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => editing && saveMutation.mutate(editing)}
              disabled={saveMutation.isPending || !editing?.name.trim()}
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
