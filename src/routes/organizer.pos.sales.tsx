import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { getFiscalReceipts, type FiscalReceipt } from "@/lib/pos-db";
import { usePosSales, useVoidPosSale, useActivePosSession } from "@/hooks/use-pos";
import type { PosSaleRecord } from "@/lib/pos.functions";
import { useEvents } from "@/hooks/use-events";
import { orpAdapter } from "@/lib/fiscal-adapter";
import { paymentTerminal } from "@/lib/payment-terminal-adapter";
import { printTickets } from "@/lib/print-tickets";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Ban, FileDown, Search, Receipt, Printer, Ticket as TicketIcon } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/pos/sales")({
  head: () => ({ meta: [{ title: "Predaje · vipky.sk" }] }),
  component: SalesPage,
});

function SalesPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { data: sales = [] } = usePosSales({ limit: 500 });
  const { data: events = [] } = useEvents({ scope: "mine" });
  const { session } = useActivePosSession();
  const voidSaleMutation = useVoidPosSale();
  const [receipts, setReceipts] = useState<FiscalReceipt[]>([]);
  const [detail, setDetail] = useState<PosSaleRecord | null>(null);
  const [q, setQ] = useState("");

  // Fiškálne doklady zatiaľ žijú v adaptéri (eKasa čaká na certifikát).
  useEffect(() => setReceipts(getFiscalReceipts()), []);
  const receiptById = (id?: string) => (id ? receipts.find((r) => r.id === id) : undefined);

  const filtered = sales.filter((s) => {
    if (!q) return true;
    const k = q.toLowerCase();
    return (
      s.receipt_number.toLowerCase().includes(k) ||
      s.event_title.toLowerCase().includes(k) ||
      (s.cashier_name || "").toLowerCase().includes(k)
    );
  });

  const exportCsv = () => {
    const rows = [
      [
        t("orgPosSales.csvReceipt"),
        t("orgPosSales.csvDate"),
        t("orgPosSales.csvEvent"),
        t("orgPosSales.csvPayment"),
        t("orgPosSales.csvTotal"),
        t("orgPosSales.csvStatus"),
        t("orgPosSales.csvCashier"),
      ],
      ...filtered.map((s) => [
        s.receipt_number,
        s.created_at,
        s.event_title,
        s.payment_method,
        s.total.toFixed(2),
        s.status,
        s.cashier_name || "",
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `predaje.csv`;
    a.click();
  };

  const onVoid = async (id: string) => {
    if (!session) {
      toast.error("Storno urobí prihlásený pokladník — otvor smenu v pokladni.");
      return;
    }
    const reason = prompt(t("orgPosSales.voidReasonPrompt")) || "";
    if (!reason || !user) return;
    const sale = sales.find((s) => s.id === id);
    try {
      await voidSaleMutation.mutateAsync({ order_id: id, session_id: session.id, reason });
      if (sale?.fiscal_receipt_id) await orpAdapter.cancelReceipt(sale.fiscal_receipt_id);
      toast.success(t("orgPosSales.voidSuccess"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Storno zlyhalo");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">
            {t("orgPosSales.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("orgPosSales.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder={t("orgPosSales.searchPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 w-72"
            />
          </div>
          <Button variant="outline" onClick={exportCsv}>
            <FileDown className="size-4 mr-2" /> {t("orgPosSales.csvButton")}
          </Button>
        </div>
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        {filtered.length === 0 ? (
          <div className="text-center py-10">
            <Receipt className="size-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{t("orgPosSales.empty")}</p>
            <Button asChild className="mt-4 bg-gradient-flame text-primary-foreground shadow-glow">
              <Link to="/organizer/pos">{t("orgPosSales.openRegister")}</Link>
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">{t("orgPosSales.thReceipt")}</th>
                  <th className="text-left">{t("orgPosSales.thDate")}</th>
                  <th className="text-left">{t("orgPosSales.thEvent")}</th>
                  <th className="text-left">{t("orgPosSales.thCashier")}</th>
                  <th className="text-left">{t("orgPosSales.thPayment")}</th>
                  <th className="text-right">{t("orgPosSales.thTotal")}</th>
                  <th className="text-left">{t("orgPosSales.thStatus")}</th>
                  <th className="text-left">{t("orgPosSales.thOrpReceipt")}</th>
                  <th className="text-left">{t("orgPosSales.thFiscalization")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const r = receiptById(s.fiscal_receipt_id);
                  return (
                    <tr key={s.id} className="border-b border-border/30">
                      <td className="py-2 font-mono text-xs">{s.receipt_number}</td>
                      <td className="text-xs">{new Date(s.created_at).toLocaleString("sk-SK")}</td>
                      <td className="truncate max-w-[200px]">{s.event_title}</td>
                      <td className="text-xs text-muted-foreground">{s.cashier_name}</td>
                      <td className="capitalize">{s.payment_method}</td>
                      <td className="text-right">€{s.total.toFixed(2)}</td>
                      <td>
                        <Badge
                          variant={s.status === "paid" ? "default" : "destructive"}
                          className="text-[10px]"
                        >
                          {s.status === "paid"
                            ? t("orgPosSales.statusPaid")
                            : t("orgPosSales.statusVoid")}
                        </Badge>
                      </td>
                      <td className="font-mono text-[11px]">{r?.receipt_number || "—"}</td>
                      <td>
                        {r ? (
                          <Badge
                            variant={r.status === "issued" ? "default" : "destructive"}
                            className="text-[10px]"
                          >
                            {r.status === "issued"
                              ? t("orgPosSales.fiscalIssued")
                              : t("orgPosSales.fiscalVoided")}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setDetail(s)}
                        >
                          <TicketIcon className="size-3.5 mr-1" /> {t("orgPosSales.ticketsButton")}
                        </Button>
                        {r && (
                          <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                            <Link to="/organizer/pos/fiscal">{t("orgPosSales.receiptButton")}</Link>
                          </Button>
                        )}
                        {s.status === "paid" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-destructive"
                            onClick={() => onVoid(s.id)}
                          >
                            <Ban className="size-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("orgPosSales.dialogTitle", { number: detail?.receipt_number })}
            </DialogTitle>
          </DialogHeader>
          {detail &&
            (() => {
              const saleTickets = detail.tickets.map((tk, i) => ({
                id: tk.id,
                code: tk.qr_code,
                ticket_type_name: tk.seat_label,
                price: detail.items[Math.min(i, detail.items.length - 1)]?.unit_price ?? 0,
                status: detail.status === "paid" ? "valid" : "refunded",
              }));
              const ev = events.find((e) => e.id === detail.event_id);
              return (
                <div className="space-y-4 text-sm">
                  <div className="text-xs text-muted-foreground">
                    {new Date(detail.created_at).toLocaleString("sk-SK")} · {detail.cashier_name} ·{" "}
                    {detail.event_title}
                  </div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {t("orgPosSales.ticketsCount", { count: saleTickets.length })}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {saleTickets.map((tk, idx) => (
                      <div
                        key={tk.id}
                        className="rounded-xl border border-border/50 bg-background p-3 flex gap-3 items-center"
                      >
                        <div className="aspect-square w-20 bg-white rounded-md p-1 flex items-center justify-center shrink-0">
                          <img
                            alt="QR"
                            className="w-full h-full"
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(tk.code)}`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {t("orgPosSales.ticketNumber", { n: idx + 1 })}
                          </div>
                          <div className="font-semibold truncate">{tk.ticket_type_name}</div>
                          <div className="text-xs">€{tk.price.toFixed(2)}</div>
                          <div className="font-mono text-[10px] text-muted-foreground truncate mt-1">
                            {tk.code}
                          </div>
                          <Badge
                            variant={
                              tk.status === "valid"
                                ? "default"
                                : tk.status === "used"
                                  ? "outline"
                                  : "destructive"
                            }
                            className="mt-1 text-[10px] uppercase"
                          >
                            {tk.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                  <DialogFooter>
                    <Button
                      size="sm"
                      className="bg-gradient-flame text-primary-foreground shadow-glow"
                      onClick={() => printTickets(saleTickets, detail, ev)}
                      disabled={saleTickets.length === 0}
                    >
                      <Printer className="size-4 mr-1.5" />{" "}
                      {t("orgPosSales.printAll", { count: saleTickets.length })}
                    </Button>
                  </DialogFooter>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
