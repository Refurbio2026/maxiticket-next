import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Pencil, Plus, Trash2, RotateCcw } from "lucide-react";
import {
  listRefundReasons,
  upsertRefundReason,
  deleteRefundReason,
  type RefundReasonRecord,
} from "@/lib/refund-reasons.functions";

export const Route = createFileRoute("/admin/maxiticket/refund-types")({
  head: () => ({ meta: [{ title: "Typy refundácií · vipky.sk Admin" }] }),
  component: Page,
});

type Form = {
  id?: string;
  code: string;
  name: string;
  description: string;
  requires_note: boolean;
  organizer_fault: boolean;
  active: boolean;
  sort_order: string;
};

const emptyForm: Form = {
  code: "",
  name: "",
  description: "",
  requires_note: false,
  organizer_fault: false,
  active: true,
  sort_order: "100",
};

function toForm(r: RefundReasonRecord): Form {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description ?? "",
    requires_note: r.requires_note,
    organizer_fault: r.organizer_fault,
    active: r.active,
    sort_order: String(r.sort_order),
  };
}

/** Z názvu urobí kód — obsluha ho tak nemusí vymýšľať. */
function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function Page() {
  const qc = useQueryClient();
  const fetchReasons = useServerFn(listRefundReasons);
  const saveReason = useServerFn(upsertRefundReason);
  const removeReason = useServerFn(deleteRefundReason);

  const [editing, setEditing] = useState<Form | null>(null);

  const reasons = useQuery({
    queryKey: ["refund-reasons"],
    queryFn: () => fetchReasons({ data: {} }),
  });

  const saveMutation = useMutation({
    mutationFn: (form: Form) =>
      saveReason({
        data: {
          id: form.id,
          code: form.code || slugify(form.name),
          name: form.name,
          description: form.description || null,
          requires_note: form.requires_note,
          organizer_fault: form.organizer_fault,
          active: form.active,
          sort_order: Number(form.sort_order) || 100,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refund-reasons"] });
      toast.success("Dôvod uložený");
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeReason({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refund-reasons"] });
      toast.success("Dôvod zmazaný");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const rows = reasons.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Typy refundácií</h1>
          <p className="text-muted-foreground mt-1">
            Číselník dôvodov, z ktorého sa vyberá pri vrátení peňazí. Vďaka nemu sa dá povedať,
            koľko refundácií išlo na vrub zrušených podujatí a koľko na žiadosť zákazníka.
          </p>
        </div>
        <Button
          onClick={() => setEditing({ ...emptyForm })}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          <Plus className="size-4 mr-2" /> Nový dôvod
        </Button>
      </div>

      {reasons.isLoading && (
        <Card className="bg-card/60 border-border/50 p-10 text-center text-muted-foreground">
          <Loader2 className="mx-auto size-5 animate-spin" />
        </Card>
      )}

      {!reasons.isLoading && rows.length === 0 && (
        <Card className="bg-card/60 border-dashed p-10 text-center text-muted-foreground">
          Číselník je prázdny.
        </Card>
      )}

      {rows.length > 0 && (
        <Card className="bg-card/60 border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Dôvod</th>
                  <th className="px-4 py-3 font-medium">Kód</th>
                  <th className="px-4 py-3 font-medium">Na vrub</th>
                  <th className="px-4 py-3 font-medium text-right">Použité</th>
                  <th className="px-4 py-3 font-medium">Stav</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/30 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {r.name}
                        {r.requires_note && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            vyžaduje poznámku
                          </Badge>
                        )}
                      </div>
                      {r.description && (
                        <div className="text-xs text-muted-foreground mt-0.5">{r.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.code}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.organizer_fault ? "organizátora" : "platformy"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.used_count || "—"}</td>
                    <td className="px-4 py-3">
                      {r.active ? (
                        <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 text-[10px]">
                          v ponuke
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          skrytý
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setEditing(toForm(r))}>
                          <Pencil className="size-3.5 mr-1.5" /> Upraviť
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title={r.active ? "Skryť z ponuky" : "Vrátiť do ponuky"}
                          onClick={() => saveMutation.mutate({ ...toForm(r), active: !r.active })}
                        >
                          <RotateCcw className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={r.used_count > 0}
                          title={
                            r.used_count > 0
                              ? "Dôvod sa už použil — radšej ho skry, nech ostane v histórii"
                              : "Zmazať"
                          }
                          onClick={() => {
                            if (confirm(`Zmazať dôvod ${r.name}?`)) deleteMutation.mutate(r.id);
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
      )}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Upraviť dôvod" : "Nový dôvod"}</DialogTitle>
            <DialogDescription>
              Názov uvidí obsluha v refundačnom dialógu a uloží sa k refundácii.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Názov</Label>
                <Input
                  placeholder="Zrušené podujatie"
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      name: e.target.value,
                      // Kód dopĺňame len pri novom dôvode — meniť ho pri existujúcom
                      // by rozbilo väzbu na už zapísané refundácie.
                      code: editing.id ? editing.code : slugify(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Kód</Label>
                <Input
                  className="font-mono"
                  value={editing.code}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Poradie v zozname</Label>
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
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Switch
                  checked={editing.requires_note}
                  onCheckedChange={(v) => setEditing({ ...editing, requires_note: v })}
                />
                Vyžaduje doplňujúcu poznámku
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Switch
                  checked={editing.organizer_fault}
                  onCheckedChange={(v) => setEditing({ ...editing, organizer_fault: v })}
                />
                Ide na vrub organizátora
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Switch
                  checked={editing.active}
                  onCheckedChange={(v) => setEditing({ ...editing, active: v })}
                />
                Ponúkať pri refundácii
              </label>
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
