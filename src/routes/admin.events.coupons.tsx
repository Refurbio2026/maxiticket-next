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
import { Loader2, Pencil, Plus, Trash2, Ban, RotateCcw, Tag, Users } from "lucide-react";
import {
  listCoupons,
  upsertCoupon,
  deleteCoupon,
  listCouponRedemptions,
  type CouponRecord,
} from "@/lib/coupons.functions";
import { useEvents } from "@/hooks/use-events";

export const Route = createFileRoute("/admin/events/coupons")({
  head: () => ({ meta: [{ title: "Zľavové kupóny · vipky.sk Admin" }] }),
  component: Page,
});

const ALL_EVENTS = "__all__";

type Form = {
  id?: string;
  code: string;
  event_id: string;
  discount_type: "percent" | "amount";
  discount_value: string;
  max_uses: string;
  max_uses_per_email: string;
  min_order_amount: string;
  valid_from: string;
  valid_until: string;
  status: "active" | "paused";
  note: string;
};

const emptyForm: Form = {
  code: "",
  event_id: ALL_EVENTS,
  discount_type: "percent",
  discount_value: "10",
  max_uses: "",
  max_uses_per_email: "1",
  min_order_amount: "",
  valid_from: "",
  valid_until: "",
  status: "active",
  note: "",
};

function toForm(c: CouponRecord): Form {
  return {
    id: c.id,
    code: c.code,
    event_id: c.event_id ?? ALL_EVENTS,
    discount_type: c.discount_type,
    discount_value: String(c.discount_value),
    max_uses: c.max_uses ? String(c.max_uses) : "",
    max_uses_per_email: c.max_uses_per_email ? String(c.max_uses_per_email) : "",
    min_order_amount: c.min_order_amount ? String(c.min_order_amount) : "",
    valid_from: c.valid_from ?? "",
    valid_until: c.valid_until ?? "",
    status: c.status,
    note: c.note ?? "",
  };
}

function formatValue(c: CouponRecord) {
  return c.discount_type === "percent"
    ? `−${c.discount_value} %`
    : `−€${c.discount_value.toFixed(2)}`;
}

/** Kupón môže byť platný, no už neupotrebiteľný — to treba vidieť na prvý pohľad. */
function usability(c: CouponRecord): { label: string; tone: "ok" | "warn" | "off" } {
  if (c.status === "paused") return { label: "pozastavený", tone: "off" };
  const today = new Date().toISOString().slice(0, 10);
  if (c.valid_until && c.valid_until < today) return { label: "po platnosti", tone: "off" };
  if (c.valid_from && c.valid_from > today) return { label: "ešte neplatí", tone: "warn" };
  if (c.max_uses && c.used_count >= c.max_uses) return { label: "vyčerpaný", tone: "off" };
  return { label: "aktívny", tone: "ok" };
}

function Page() {
  const qc = useQueryClient();
  const fetchCoupons = useServerFn(listCoupons);
  const saveCoupon = useServerFn(upsertCoupon);
  const removeCoupon = useServerFn(deleteCoupon);
  const fetchRedemptions = useServerFn(listCouponRedemptions);
  const { data: events = [] } = useEvents({ scope: "mine" });

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Form | null>(null);
  const [detail, setDetail] = useState<CouponRecord | null>(null);

  const coupons = useQuery({
    queryKey: ["coupons"],
    queryFn: () => fetchCoupons({ data: undefined as never }),
  });

  const redemptions = useQuery({
    queryKey: ["coupon-redemptions", detail?.id],
    queryFn: () => fetchRedemptions({ data: { coupon_id: detail!.id } }),
    enabled: !!detail,
  });

  const saveMutation = useMutation({
    mutationFn: (form: Form) =>
      saveCoupon({
        data: {
          id: form.id,
          code: form.code,
          event_id: form.event_id === ALL_EVENTS ? null : form.event_id,
          discount_type: form.discount_type,
          discount_value: Number(form.discount_value) || 0,
          max_uses: form.max_uses ? Number(form.max_uses) : null,
          max_uses_per_email: form.max_uses_per_email ? Number(form.max_uses_per_email) : null,
          min_order_amount: form.min_order_amount ? Number(form.min_order_amount) : 0,
          valid_from: form.valid_from || null,
          valid_until: form.valid_until || null,
          status: form.status,
          note: form.note || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coupons"] });
      toast.success("Kupón uložený");
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeCoupon({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coupons"] });
      toast.success("Kupón zmazaný");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = coupons.data ?? [];
    if (!needle) return list;
    return list.filter(
      (c) =>
        c.code.toLowerCase().includes(needle) ||
        (c.event_title || "").toLowerCase().includes(needle) ||
        (c.note || "").toLowerCase().includes(needle),
    );
  }, [coupons.data, search]);

  const totals = useMemo(
    () => ({
      used: rows.reduce((s, c) => s + c.used_count, 0),
      money: rows.reduce((s, c) => s + c.discount_total, 0),
    }),
    [rows],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Zľavové kupóny</h1>
          <p className="text-muted-foreground mt-1">
            Kód zadá kupujúci v pokladni webu alebo pokladník na mieste. Zľavu počíta server, takže
            s ňou v prehliadači nikto nepohne.
          </p>
        </div>
        <Button
          onClick={() => setEditing({ ...emptyForm })}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          <Plus className="size-4 mr-2" /> Nový kupón
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Hľadať kód, podujatie alebo poznámku…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <span className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "kupón" : rows.length < 5 ? "kupóny" : "kupónov"} ·
          uplatnené {totals.used}× · rozdané €{totals.money.toFixed(2)}
        </span>
      </div>

      {coupons.isLoading && (
        <Card className="bg-card/60 border-border/50 p-10 text-center text-muted-foreground">
          <Loader2 className="mx-auto size-5 animate-spin" />
        </Card>
      )}

      {!coupons.isLoading && rows.length === 0 && (
        <Card className="bg-card/60 border-dashed p-10 text-center text-muted-foreground">
          Zatiaľ žiadne kupóny. Založ prvý — napríklad 10 % na celý katalóg.
        </Card>
      )}

      {rows.length > 0 && (
        <Card className="bg-card/60 border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Kód</th>
                  <th className="px-4 py-3 font-medium">Platí na</th>
                  <th className="px-4 py-3 font-medium text-right">Zľava</th>
                  <th className="px-4 py-3 font-medium">Platnosť</th>
                  <th className="px-4 py-3 font-medium text-right">Použité</th>
                  <th className="px-4 py-3 font-medium text-right">Rozdané</th>
                  <th className="px-4 py-3 font-medium">Stav</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const state = usability(c);
                  return (
                    <tr key={c.id} className="border-b border-border/30 last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-mono font-semibold">
                          <Tag className="size-3.5 text-muted-foreground" />
                          {c.code}
                        </div>
                        {c.note && (
                          <div className="text-xs text-muted-foreground mt-0.5">{c.note}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {c.event_title ?? (
                          <span className="text-muted-foreground">
                            {c.organizer_id ? "všetky svoje podujatia" : "celý katalóg"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {formatValue(c)}
                        {c.min_order_amount > 0 && (
                          <div className="text-[11px] text-muted-foreground">
                            od €{c.min_order_amount.toFixed(2)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {c.valid_from || c.valid_until
                          ? `${c.valid_from ?? "…"} → ${c.valid_until ?? "…"}`
                          : "bez obmedzenia"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {c.used_count}
                        {c.max_uses ? (
                          <span className="text-muted-foreground"> / {c.max_uses}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {c.discount_total ? `€${c.discount_total.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={state.tone === "off" ? "outline" : "default"}
                          className={
                            state.tone === "ok"
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 text-[10px]"
                              : state.tone === "warn"
                                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-0 text-[10px]"
                                : "text-[10px]"
                          }
                        >
                          {state.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Kto kupón použil"
                            onClick={() => setDetail(c)}
                            disabled={c.used_count === 0}
                          >
                            <Users className="size-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditing(toForm(c))}>
                            <Pencil className="size-3.5 mr-1.5" /> Upraviť
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title={c.status === "paused" ? "Znovu spustiť" : "Pozastaviť"}
                            onClick={() =>
                              saveMutation.mutate({
                                ...toForm(c),
                                status: c.status === "paused" ? "active" : "paused",
                              })
                            }
                          >
                            {c.status === "paused" ? (
                              <RotateCcw className="size-3.5" />
                            ) : (
                              <Ban className="size-3.5" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm(`Zmazať kupón ${c.code}?`)) deleteMutation.mutate(c.id);
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Upraviť kupón" : "Nový kupón"}</DialogTitle>
            <DialogDescription>
              Prázdny limit znamená „bez obmedzenia". Kód je jedinečný v celej platforme.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Kód</Label>
                <Input
                  className="font-mono"
                  placeholder="LETO25"
                  value={editing.code}
                  onChange={(e) =>
                    setEditing({ ...editing, code: e.target.value.toUpperCase().trim() })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Platí na</Label>
                <Select
                  value={editing.event_id}
                  onValueChange={(v) => setEditing({ ...editing, event_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_EVENTS}>Všetky moje podujatia</SelectItem>
                    {events.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Typ zľavy</Label>
                <Select
                  value={editing.discount_type}
                  onValueChange={(v) =>
                    setEditing({ ...editing, discount_type: v as Form["discount_type"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percento z objednávky</SelectItem>
                    <SelectItem value="amount">Pevná suma v eurách</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{editing.discount_type === "percent" ? "Zľava v %" : "Zľava v €"}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editing.discount_value}
                  onChange={(e) => setEditing({ ...editing, discount_value: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Celkový počet použití</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="bez limitu"
                  value={editing.max_uses}
                  onChange={(e) => setEditing({ ...editing, max_uses: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Použití na jeden e-mail</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="bez limitu"
                  value={editing.max_uses_per_email}
                  onChange={(e) => setEditing({ ...editing, max_uses_per_email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Minimálna suma objednávky</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="bez minima"
                  value={editing.min_order_amount}
                  onChange={(e) => setEditing({ ...editing, min_order_amount: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Stav</Label>
                <Select
                  value={editing.status}
                  onValueChange={(v) => setEditing({ ...editing, status: v as Form["status"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktívny</SelectItem>
                    <SelectItem value="paused">Pozastavený</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Platí od</Label>
                <Input
                  type="date"
                  value={editing.valid_from}
                  onChange={(e) => setEditing({ ...editing, valid_from: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Platí do</Label>
                <Input
                  type="date"
                  value={editing.valid_until}
                  onChange={(e) => setEditing({ ...editing, valid_until: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Poznámka</Label>
                <Textarea
                  rows={2}
                  placeholder="napr. kampaň na Facebooku, jún 2026"
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
              onClick={() => editing && saveMutation.mutate(editing)}
              disabled={
                saveMutation.isPending || !editing?.code || !Number(editing?.discount_value ?? 0)
              }
            >
              {saveMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Uložiť
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Použitie kupónu {detail?.code}</DialogTitle>
            <DialogDescription>
              Každý riadok je jedna objednávka, na ktorú sa kupón uplatnil.
            </DialogDescription>
          </DialogHeader>
          {redemptions.isLoading ? (
            <Loader2 className="mx-auto size-5 animate-spin my-6" />
          ) : (redemptions.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Kupón zatiaľ nikto nepoužil.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-2 font-medium">Kedy</th>
                    <th className="py-2 font-medium">E-mail</th>
                    <th className="py-2 font-medium text-right">Zľava</th>
                    <th className="py-2 font-medium text-right">Objednávka</th>
                  </tr>
                </thead>
                <tbody>
                  {(redemptions.data ?? []).map((r) => (
                    <tr key={r.id} className="border-t border-border/30">
                      <td className="py-2">{new Date(r.created_at).toLocaleString("sk-SK")}</td>
                      <td className="py-2">{r.email ?? "—"}</td>
                      <td className="py-2 text-right tabular-nums">
                        −€{r.discount_amount.toFixed(2)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {r.order_total !== null ? `€${r.order_total.toFixed(2)}` : "—"}
                        {r.order_status === "refunded" && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            refund
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
