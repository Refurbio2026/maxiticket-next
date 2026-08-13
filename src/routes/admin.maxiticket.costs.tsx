import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  listOrganizerCosts,
  upsertOrganizerCost,
  deleteOrganizerCost,
  type OrganizerCost,
} from "@/lib/organizer-costs.functions";
import { listOrganizerAccounts } from "@/lib/settlements.functions";
import { useEvents } from "@/hooks/use-events";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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
import { Loader2, Plus, Pencil, Trash2, Wallet, Lock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/maxiticket/costs")({
  head: () => ({ meta: [{ title: "Náklady organizátorov · vipky.sk Admin" }] }),
  component: Page,
});

const STATES = [
  { value: "all", label: "Všetky" },
  { value: "open", label: "Nevyúčtované" },
  { value: "settled", label: "Vo vyúčtovaní" },
];

const fmtEur = (n: number) =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

type Form = {
  id?: string;
  organizer_id: string;
  event_id: string;
  title: string;
  amount: string;
  cost_date: string;
  note: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): Form => ({
  organizer_id: "",
  event_id: "",
  title: "",
  amount: "",
  cost_date: today(),
  note: "",
});

function Page() {
  const qc = useQueryClient();
  const fetchCosts = useServerFn(listOrganizerCosts);
  const fetchOrganizers = useServerFn(listOrganizerAccounts);
  const saveCost = useServerFn(upsertOrganizerCost);
  const removeCost = useServerFn(deleteOrganizerCost);

  const [organizer, setOrganizer] = useState("all");
  const [state, setState] = useState("all");
  const [editing, setEditing] = useState<Form | null>(null);

  const costs = useQuery({
    queryKey: ["organizer-costs", organizer, state],
    queryFn: () =>
      fetchCosts({
        data: {
          organizer_id: organizer === "all" ? null : organizer,
          state: state as "all" | "open" | "settled",
        },
      }),
  });
  const organizers = useQuery({
    queryKey: ["organizer-accounts"],
    queryFn: () => fetchOrganizers({ data: undefined as never }),
  });
  const { data: events = [] } = useEvents({ scope: "all" });

  // Ponuka podujatí sa zúži na vybraného organizátora — náklad cudzieho
  // podujatia by v jeho vyúčtovaní nedával zmysel.
  const formEvents = useMemo(
    () => events.filter((e) => !editing?.organizer_id || e.organizer_id === editing.organizer_id),
    [events, editing?.organizer_id],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["organizer-costs"] });
    // Vyúčtovanie odpočítava nevyúčtované náklady, takže sa mení aj náhľad.
    qc.invalidateQueries({ queryKey: ["settlement-preview"] });
  };

  const save = useMutation({
    mutationFn: (f: Form) =>
      saveCost({
        data: {
          id: f.id,
          organizer_id: f.organizer_id,
          event_id: f.event_id || null,
          title: f.title,
          amount: Number(f.amount.replace(",", ".")),
          cost_date: f.cost_date,
          note: f.note || null,
        },
      }),
    onSuccess: (_r, f) => {
      invalidate();
      toast.success(f.id ? "Náklad upravený" : "Náklad pridaný");
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeCost({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Náklad zmazaný");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const rows = costs.data?.rows ?? [];

  const toForm = (c: OrganizerCost): Form => ({
    id: c.id,
    organizer_id: c.organizer_id,
    event_id: c.event_id ?? "",
    title: c.title,
    amount: c.amount.toFixed(2),
    cost_date: c.cost_date,
    note: c.note ?? "",
  });

  const valid =
    !!editing?.organizer_id &&
    !!editing?.title.trim() &&
    Number(editing?.amount.replace(",", ".")) > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Náklady organizátorov</h1>
          <p className="text-muted-foreground mt-1">
            Položky, ktoré sa organizátorovi sťahujú z výplaty — tlač vstupeniek, prenájom čítačiek,
            dohodnutá reklama. Nevyúčtované sa odpočítajú v najbližšom{" "}
            <Link to="/admin/maxiticket/protocols" className="text-primary hover:underline">
              vyúčtovacom protokole
            </Link>
            .
          </p>
        </div>
        <Button
          className="bg-gradient-flame text-primary-foreground shadow-glow"
          onClick={() => setEditing(emptyForm())}
        >
          <Plus className="size-4 mr-1.5" /> Pridať náklad
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Nevyúčtované" value={fmtEur(costs.data?.open_amount ?? 0)} accent />
        <Tile label="Už vo vyúčtovaní" value={fmtEur(costs.data?.settled_amount ?? 0)} />
        <Tile label="Položiek" value={String(rows.length)} />
      </div>

      <Card className="p-4 bg-card/60 border-border/50">
        <div className="grid gap-3 sm:grid-cols-2 max-w-2xl">
          <div className="space-y-1.5">
            <Label className="text-xs">Organizátor</Label>
            <Select value={organizer} onValueChange={setOrganizer}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Všetci organizátori</SelectItem>
                {(organizers.data ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.company_name || o.full_name || o.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Stav</Label>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="bg-card/60 border-border/50 overflow-x-auto">
        {costs.isLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <Wallet className="mx-auto size-6 text-muted-foreground mb-2" />
            <div className="font-semibold">Žiadne náklady</div>
            <p className="text-sm text-muted-foreground mt-1">
              Pridaj položku, ktorá sa má organizátorovi stiahnuť z výplaty.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left p-3">Dátum</th>
                <th className="text-left p-3">Organizátor</th>
                <th className="text-left p-3">Položka</th>
                <th className="text-left p-3">Podujatie</th>
                <th className="text-right p-3">Suma</th>
                <th className="text-left p-3">Stav</th>
                <th className="text-right p-3">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-border/20 hover:bg-muted/10 align-top">
                  <td className="p-3 whitespace-nowrap text-xs">{c.cost_date}</td>
                  <td className="p-3">{c.organizer_name}</td>
                  <td className="p-3 max-w-[260px]">
                    <div>{c.title}</div>
                    {c.note && (
                      <div className="text-xs text-muted-foreground line-clamp-2">{c.note}</div>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground max-w-[200px] truncate">
                    {c.event_title ?? "— všetky —"}
                  </td>
                  <td className="p-3 text-right font-semibold tabular-nums whitespace-nowrap">
                    {fmtEur(c.amount)}
                  </td>
                  <td className="p-3">
                    {c.settled ? (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Lock className="size-2.5" /> vo vyúčtovaní
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px]">
                        nevyúčtované
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap space-x-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={c.settled}
                      onClick={() => setEditing(toForm(c))}
                    >
                      <Pencil className="size-3.5 mr-1" /> Upraviť
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={c.settled}
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Zmazať náklad „${c.title}"?`)) remove.mutate(c.id);
                      }}
                    >
                      <Trash2 className="size-3.5 mr-1" /> Zmazať
                    </Button>
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
            <DialogTitle>{editing?.id ? "Upraviť náklad" : "Nový náklad"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Organizátor</Label>
                <Select
                  value={editing.organizer_id}
                  onValueChange={(v) => setEditing({ ...editing, organizer_id: v, event_id: "" })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Vyber organizátora" />
                  </SelectTrigger>
                  <SelectContent>
                    {(organizers.data ?? []).map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.company_name || o.full_name || o.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Položka</Label>
                <Input
                  maxLength={200}
                  placeholder="napr. Tlač vstupeniek — 500 ks"
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Suma (€)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={editing.amount}
                    onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Dátum</Label>
                  <Input
                    type="date"
                    value={editing.cost_date}
                    onChange={(e) => setEditing({ ...editing, cost_date: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Podľa neho sa náklad zaradí do obdobia protokolu.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Podujatie (nepovinné)</Label>
                <Select
                  value={editing.event_id || "none"}
                  onValueChange={(v) => setEditing({ ...editing, event_id: v === "none" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— nezaradené k podujatiu —</SelectItem>
                    {formEvents.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.title} · {e.event_date}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Poznámka</Label>
                <Textarea
                  rows={2}
                  maxLength={2000}
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
              onClick={() => editing && save.mutate(editing)}
              disabled={save.isPending || !valid}
              className="bg-gradient-flame text-primary-foreground shadow-glow"
            >
              {save.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              {editing?.id ? "Uložiť" : "Pridať"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className={`p-5 bg-card/60 ${accent ? "border-primary/40" : "border-border/50"}`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-bold mt-1 tabular-nums">{value}</div>
    </Card>
  );
}
