import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, ExternalLink, Search, Undo2 } from "lucide-react";
import { listAdminOrders, type AdminOrderRow } from "@/lib/admin-stats.functions";
import { refundOrder } from "@/lib/refunds.functions";

export const Route = createFileRoute("/admin/sales/sales")({
  head: () => ({ meta: [{ title: "Predaj · vstupenky.sk Admin" }] }),
  component: Page,
});

const fmtEur = (n: number, c = "EUR") => `${c === "EUR" ? "€ " : ""}${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUSES: { value: string; label: string; cls?: string }[] = [
  { value: "all", label: "Všetky stavy" },
  { value: "paid", label: "Zaplatené", cls: "bg-emerald-500/15 text-emerald-500" },
  { value: "pending", label: "Čaká", cls: "bg-accent/15 text-accent" },
  { value: "awaiting_payment", label: "Čaká na platbu", cls: "bg-amber-500/15 text-amber-500" },
  { value: "refunded", label: "Refundované", cls: "bg-destructive/15 text-destructive" },
  { value: "cancelled", label: "Zrušené" },
  { value: "failed", label: "Zlyhala", cls: "bg-destructive/15 text-destructive" },
  { value: "expired", label: "Expirované" },
];

function Page() {
  const fetchOrders = useServerFn(listAdminOrders);
  const doRefund = useServerFn(refundOrder);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [refundFor, setRefundFor] = useState<AdminOrderRow | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [refunding, setRefunding] = useState(false);

  const q = useQuery({
    queryKey: ["admin-orders", status, activeSearch],
    queryFn: () => fetchOrders({ data: { status, search: activeSearch, limit: 200 } }),
  });

  const rows = q.data || [];
  const totalAmount = rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.total_amount, 0);

  function openRefund(r: AdminOrderRow) {
    setRefundFor(r);
    setRefundAmount(r.total_amount.toFixed(2));
    setRefundReason("");
    setNotifyCustomer(true);
  }

  async function submitRefund() {
    if (!refundFor) return;
    const amt = Number(refundAmount.replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Zadaj platnú sumu");
      return;
    }
    setRefunding(true);
    try {
      const res = await doRefund({
        data: {
          order_id: refundFor.id,
          amount: amt,
          reason: refundReason || null,
          notify_customer: notifyCustomer,
        },
      });
      toast.success(
        `${res.full ? "Plný" : "Čiastočný"} refund ${amt.toFixed(2)} ${refundFor.currency} spracovaný.` +
          (notifyCustomer ? (res.email_queued ? " Email odoslaný." : ` Email preskočený: ${res.email_skipped_reason || "—"}`) : ""),
      );
      setRefundFor(null);
      q.refetch();
    } catch (e: any) {
      toast.error(e?.message || "Refund zlyhal");
    } finally {
      setRefunding(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Predaj</h1>
          <p className="text-muted-foreground text-sm mt-1">Všetky objednávky v systéme.</p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Zaplatené spolu</div>
          <div className="font-display text-2xl font-bold">{fmtEur(totalAmount)}</div>
        </div>
      </div>

      <Card className="bg-card/60 border-border/50 p-3 flex flex-wrap gap-2 items-center">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <form
          onSubmit={(e) => { e.preventDefault(); setActiveSearch(search.trim()); }}
          className="flex items-center gap-2 flex-1 min-w-[260px]"
        >
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Email, meno alebo ID objednávky…"
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">Hľadať</Button>
        </form>
        <Button variant="ghost" size="sm" onClick={() => q.refetch()} className="gap-1.5">
          <RefreshCw className="size-4" /> Obnoviť
        </Button>
      </Card>

      <Card className="bg-card/60 border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="text-left p-3 font-medium">ID</th>
                <th className="text-left p-3 font-medium">Podujatie</th>
                <th className="text-left p-3 font-medium">Zákazník</th>
                <th className="text-right p-3 font-medium">Suma</th>
                <th className="text-center p-3 font-medium">Ks</th>
                <th className="text-left p-3 font-medium">Stav</th>
                <th className="text-left p-3 font-medium">Faktúra</th>
                <th className="text-left p-3 font-medium">Dátum</th>
                <th className="text-right p-3 font-medium">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <tr><td colSpan={9} className="p-10 text-center text-muted-foreground"><Loader2 className="size-5 inline animate-spin mr-2" /> Načítavam…</td></tr>
              ) : q.isError ? (
                <tr><td colSpan={9} className="p-10 text-center text-destructive">{(q.error as any)?.message || "Chyba"}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="p-10 text-center text-muted-foreground">Žiadne objednávky.</td></tr>
              ) : rows.map((r) => {
                const st = STATUSES.find((s) => s.value === r.status);
                return (
                  <tr key={r.id} className="border-b border-border/20 hover:bg-muted/30">
                    <td className="p-3 font-mono text-xs">{r.id.slice(0, 8).toUpperCase()}</td>
                    <td className="p-3 max-w-[220px] truncate">{r.event_title || "—"}</td>
                    <td className="p-3">
                      <div className="font-medium">{r.customer_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.customer_email}</div>
                    </td>
                    <td className="p-3 text-right font-semibold">{fmtEur(r.total_amount, r.currency)}</td>
                    <td className="p-3 text-center">{r.qty}</td>
                    <td className="p-3"><Badge className={`${st?.cls || "bg-muted text-muted-foreground"} border-0`}>{st?.label || r.status}</Badge></td>
                    <td className="p-3">
                      {r.invoice_number ? (
                        r.invoice_pdf_url ? (
                          <a href={r.invoice_pdf_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline text-xs">
                            {r.invoice_number} <ExternalLink className="size-3" />
                          </a>
                        ) : <span className="text-xs">{r.invoice_number}</span>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(r.paid_at || r.created_at).toLocaleString("sk")}</td>
                    <td className="p-3 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={r.status !== "paid"}
                        onClick={() => openRefund(r)}
                        className="gap-1.5"
                      >
                        <Undo2 className="size-3.5" /> Refund
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!refundFor} onOpenChange={(o) => !o && setRefundFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund objednávky</DialogTitle>
            <DialogDescription>
              {refundFor && (
                <>
                  Objednávka <span className="font-mono">#{refundFor.id.slice(0, 8).toUpperCase()}</span> ·{" "}
                  {refundFor.customer_email} · spolu <strong>{fmtEur(refundFor.total_amount, refundFor.currency)}</strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="refund-amount">Suma refundu ({refundFor?.currency || "EUR"})</Label>
              <Input
                id="refund-amount"
                type="number"
                step="0.01"
                min="0.01"
                max={refundFor?.total_amount}
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Pre plný refund nechaj celú sumu. Pre čiastočný zadaj menej.
              </p>
              <div className="flex gap-2 mt-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => refundFor && setRefundAmount(refundFor.total_amount.toFixed(2))}>100 %</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => refundFor && setRefundAmount((refundFor.total_amount / 2).toFixed(2))}>50 %</Button>
              </div>
            </div>
            <div>
              <Label htmlFor="refund-reason">Dôvod (voliteľné)</Label>
              <Textarea
                id="refund-reason"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="napr. zrušené podujatie, požiadavka zákazníka…"
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="notify" checked={notifyCustomer} onCheckedChange={(v) => setNotifyCustomer(!!v)} />
              <Label htmlFor="notify" className="cursor-pointer">Odoslať potvrdenie zákazníkovi emailom</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setRefundFor(null)} disabled={refunding}>Zrušiť</Button>
            <Button onClick={submitRefund} disabled={refunding} className="gap-1.5">
              {refunding && <Loader2 className="size-4 animate-spin" />}
              Spracovať refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
