import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Loader2, Plus, Check, Banknote, Trash2, FileText } from "lucide-react";
import {
  listSettlements,
  previewSettlement,
  createSettlement,
  setSettlementStatus,
  deleteSettlement,
  listOrganizerAccounts,
  type SettlementRow,
} from "@/lib/settlements.functions";

export const Route = createFileRoute("/admin/maxiticket/protocols")({
  head: () => ({ meta: [{ title: "Vyúčtovacie protokoly · vipky.sk Admin" }] }),
  component: Page,
});

const fmtEur = (n: number) =>
  `€ ${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("sk-SK") : "—");

const STATUS: Record<SettlementRow["status"], { label: string; cls: string }> = {
  draft: { label: "Návrh", cls: "bg-muted text-muted-foreground" },
  approved: { label: "Schválené", cls: "bg-accent/15 text-accent" },
  paid: { label: "Vyplatené", cls: "bg-emerald-500/15 text-emerald-500" },
};

/** Predvolené obdobie = minulý mesiac, to sa vyúčtováva najčastejšie. */
function lastMonth() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(from), to: iso(to) };
}

function Page() {
  const qc = useQueryClient();
  const fetchSettlements = useServerFn(listSettlements);
  const fetchOrganizers = useServerFn(listOrganizerAccounts);
  const doPreview = useServerFn(previewSettlement);
  const doCreate = useServerFn(createSettlement);
  const doStatus = useServerFn(setSettlementStatus);
  const doDelete = useServerFn(deleteSettlement);

  const [status, setStatus] = useState<"all" | SettlementRow["status"]>("all");
  const [creating, setCreating] = useState(false);
  const [payFor, setPayFor] = useState<SettlementRow | null>(null);
  const [payRef, setPayRef] = useState("");

  const period = useMemo(lastMonth, []);
  const [form, setForm] = useState({
    organizer_id: "",
    period_from: period.from,
    period_to: period.to,
    note: "",
  });

  const settlements = useQuery({
    queryKey: ["settlements", status],
    queryFn: () => fetchSettlements({ data: { status } }),
  });

  const organizers = useQuery({
    queryKey: ["admin-organizers"],
    queryFn: () => fetchOrganizers({ data: undefined as never }),
  });

  const preview = useQuery({
    queryKey: ["settlement-preview", form.organizer_id, form.period_from, form.period_to],
    enabled: creating && !!form.organizer_id,
    queryFn: () =>
      doPreview({
        data: {
          organizer_id: form.organizer_id,
          period_from: form.period_from,
          period_to: form.period_to,
        },
      }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      doCreate({
        data: {
          organizer_id: form.organizer_id,
          period_from: form.period_from,
          period_to: form.period_to,
          note: form.note || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settlements"] });
      toast.success("Protokol vytvorený");
      setCreating(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Vytvorenie zlyhalo"),
  });

  const statusMutation = useMutation({
    mutationFn: (v: {
      id: string;
      status: SettlementRow["status"];
      payout_reference?: string | null;
    }) => doStatus({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settlements"] });
      qc.invalidateQueries({ queryKey: ["admin-organizers"] });
      setPayFor(null);
      setPayRef("");
      toast.success("Stav protokolu zmenený");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmena stavu zlyhala"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => doDelete({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settlements"] });
      toast.success("Protokol zmazaný");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const rows = settlements.data ?? [];
  const p = preview.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Vyúčtovacie protokoly</h1>
          <p className="text-muted-foreground mt-1">
            Koľko organizátorovi patrí z predaja za obdobie — po odpočítaní provízie a refundácií.
          </p>
        </div>
        <Button
          onClick={() => setCreating(true)}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          <Plus className="size-4 mr-2" /> Nový protokol
        </Button>
      </div>

      <Card className="p-4 bg-card/60 border-border/50">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Všetky stavy</SelectItem>
              <SelectItem value="draft">Návrhy</SelectItem>
              <SelectItem value="approved">Schválené</SelectItem>
              <SelectItem value="paid">Vyplatené</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-sm text-muted-foreground">
            {settlements.isLoading ? "Načítavam…" : `${rows.length} protokolov`}
          </span>
        </div>
      </Card>

      <Card className="bg-card/60 border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Organizátor</th>
                <th className="px-4 py-3 font-medium">Obdobie</th>
                <th className="px-4 py-3 font-medium text-right">Vstupenky</th>
                <th className="px-4 py-3 font-medium text-right">Hrubá tržba</th>
                <th className="px-4 py-3 font-medium text-right">Refundácie</th>
                <th className="px-4 py-3 font-medium text-right">Provízia</th>
                <th className="px-4 py-3 font-medium text-right">Na výplatu</th>
                <th className="px-4 py-3 font-medium">Stav</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {settlements.isLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </td>
                </tr>
              )}
              {!settlements.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                    Zatiaľ žiadny protokol. Vytvor prvý tlačidlom hore.
                  </td>
                </tr>
              )}
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-border/30 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{s.organizer_name}</div>
                    {s.event_title && (
                      <div className="text-xs text-muted-foreground">{s.event_title}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {fmtDate(s.period_from)} – {fmtDate(s.period_to)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.tickets_sold}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtEur(s.gross_amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {s.refunded_amount ? `− ${fmtEur(s.refunded_amount)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    − {fmtEur(s.commission_amount)}
                    <div className="text-[10px] text-muted-foreground">{s.commission_rate} %</div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {fmtEur(s.net_amount)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={`border-0 ${STATUS[s.status].cls}`}>
                      {STATUS[s.status].label}
                    </Badge>
                    {s.paid_at && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {fmtDate(s.paid_at)}
                        {s.payout_reference ? ` · ${s.payout_reference}` : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {s.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => statusMutation.mutate({ id: s.id, status: "approved" })}
                        >
                          <Check className="size-3.5 mr-1.5" /> Schváliť
                        </Button>
                      )}
                      {s.status === "approved" && (
                        <Button size="sm" onClick={() => setPayFor(s)}>
                          <Banknote className="size-3.5 mr-1.5" /> Označiť vyplatené
                        </Button>
                      )}
                      {s.status !== "paid" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm("Zmazať protokol?")) deleteMutation.mutate(s.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* --- nový protokol s náhľadom prepočtu --- */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Nový vyúčtovací protokol</DialogTitle>
            <DialogDescription>
              Čísla sa v protokole zmrazia. Neskoršia refundácia už sumu spätne nezmení.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-3">
              <Label>Organizátor</Label>
              <Select
                value={form.organizer_id}
                onValueChange={(v) => setForm({ ...form, organizer_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Vyber organizátora" />
                </SelectTrigger>
                <SelectContent>
                  {(organizers.data ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.company_name || o.full_name || o.email} · {o.effective_rate} %
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Od</Label>
              <Input
                type="date"
                value={form.period_from}
                onChange={(e) => setForm({ ...form, period_from: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Do</Label>
              <Input
                type="date"
                value={form.period_to}
                onChange={(e) => setForm({ ...form, period_to: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Poznámka (voliteľné)</Label>
              <Textarea
                rows={1}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
          </div>

          {form.organizer_id && (
            <Card className="p-4 bg-muted/30 border-border/50">
              {preview.isFetching ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Počítam…
                </div>
              ) : p ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <FileText className="size-4" /> {p.organizer_name}
                  </div>
                  {p.lines.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      V tomto období nemá organizátor žiadny zaplatený predaj.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="py-1 font-medium">Podujatie</th>
                          <th className="py-1 font-medium text-right">Objednávky</th>
                          <th className="py-1 font-medium text-right">Vstupenky</th>
                          <th className="py-1 font-medium text-right">Tržba</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.lines.map((l) => (
                          <tr key={l.event_id} className="border-t border-border/30">
                            <td className="py-1.5">{l.title}</td>
                            <td className="py-1.5 text-right tabular-nums">{l.orders}</td>
                            <td className="py-1.5 text-right tabular-nums">{l.tickets}</td>
                            <td className="py-1.5 text-right tabular-nums">{fmtEur(l.gross)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="grid gap-1 border-t border-border/40 pt-3 text-sm sm:w-72 sm:ml-auto">
                    <Row label="Hrubá tržba" value={fmtEur(p.gross_amount)} />
                    {p.refunded_amount > 0 && (
                      <Row label="Refundácie" value={`− ${fmtEur(p.refunded_amount)}`} muted />
                    )}
                    <Row
                      label={`Provízia ${p.commission_rate} %`}
                      value={`− ${fmtEur(p.commission_amount)}`}
                      muted
                    />
                    <div className="flex justify-between border-t border-border/40 pt-2 font-semibold">
                      <span>Na výplatu</span>
                      <span className="tabular-nums">{fmtEur(p.net_amount)}</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </Card>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !form.organizer_id || !p}
            >
              {createMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Vytvoriť protokol
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- označenie výplaty --- */}
      <Dialog open={!!payFor} onOpenChange={(v) => !v && setPayFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Označiť ako vyplatené</DialogTitle>
            <DialogDescription>
              {payFor && `${payFor.organizer_name} · ${fmtEur(payFor.net_amount)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Referencia platby (variabilný symbol, číslo prevodu)</Label>
            <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayFor(null)}>
              Zrušiť
            </Button>
            <Button
              onClick={() =>
                payFor &&
                statusMutation.mutate({
                  id: payFor.id,
                  status: "paid",
                  payout_reference: payRef || null,
                })
              }
              disabled={statusMutation.isPending}
            >
              {statusMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Potvrdiť výplatu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
