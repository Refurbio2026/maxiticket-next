import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getSales, getFiscalReceipts, getTickets, POS_EVENT, voidSale, logAudit, type PosSale, type FiscalReceipt, type PosTicket } from "@/lib/pos-db";
import { getEvents, type EventItem } from "@/lib/local-db";
import { orpAdapter } from "@/lib/fiscal-adapter";
import { paymentTerminal } from "@/lib/payment-terminal-adapter";
import { printTickets } from "@/lib/print-tickets";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Ban, FileDown, Search, Receipt, Printer, Ticket as TicketIcon } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/pos/sales")({
  head: () => ({ meta: [{ title: "Predaje · MAXITICKET" }] }),
  component: SalesPage,
});

function SalesPage() {
  const { user } = useAuth();
  const [sales, setSales] = useState<PosSale[]>([]);
  const [receipts, setReceipts] = useState<FiscalReceipt[]>([]);
  const [q, setQ] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!user) return;
    setSales(getSales().filter((s) => user.role === "admin" || s.organizer_id === user.id));
    setReceipts(getFiscalReceipts());
  }, [user, tick]);

  const receiptById = (id?: string) => (id ? receipts.find((r) => r.id === id) : undefined);

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener(POS_EVENT, h);
    return () => window.removeEventListener(POS_EVENT, h);
  }, []);

  const filtered = sales.filter((s) => {
    if (!q) return true;
    const k = q.toLowerCase();
    return s.receipt_number.toLowerCase().includes(k) || s.event_title.toLowerCase().includes(k) || s.cashier_name.toLowerCase().includes(k);
  });

  const exportCsv = () => {
    const rows = [
      ["Doklad", "Dátum", "Podujatie", "Platba", "Suma", "Stav", "Pokladník"],
      ...filtered.map((s) => [s.receipt_number, s.created_at, s.event_title, s.payment_method, s.total.toFixed(2), s.status, s.cashier_name]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `predaje.csv`; a.click();
  };

  const onVoid = async (id: string) => {
    const reason = prompt("Dôvod storna:") || "";
    if (!reason || !user) return;
    const sale = sales.find((s) => s.id === id);
    voidSale(id, reason);
    if (sale?.fiscal_receipt_id) await orpAdapter.cancelReceipt(sale.fiscal_receipt_id);
    if (sale?.terminal_tx_id) await paymentTerminal.cancelPayment(sale.terminal_tx_id);
    logAudit({ user_id: user.id, user_name: user.full_name || user.email, action: "pos.void", entity: "pos_sales", entity_id: id, meta: { reason } });
    toast.success("Predaj stornovaný");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Predaje</h1>
          <p className="text-muted-foreground mt-1">Všetky pokladničné predaje a doklady.</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input placeholder="Hľadať doklad…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 w-72" />
          </div>
          <Button variant="outline" onClick={exportCsv}><FileDown className="size-4 mr-2" /> CSV</Button>
        </div>
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        {filtered.length === 0 ? (
          <div className="text-center py-10">
            <Receipt className="size-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Žiadne predaje.</p>
            <Button asChild className="mt-4 bg-gradient-flame text-primary-foreground shadow-glow">
              <Link to="/organizer/pos">Otvoriť pokladňu</Link>
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">Doklad</th>
                  <th className="text-left">Dátum</th>
                  <th className="text-left">Podujatie</th>
                  <th className="text-left">Pokladník</th>
                  <th className="text-left">Platba</th>
                  <th className="text-right">Suma</th>
                  <th className="text-left">Stav</th>
                  <th className="text-left">ORP doklad</th>
                  <th className="text-left">Fiskalizácia</th>
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
                      <Badge variant={s.status === "paid" ? "default" : "destructive"} className="text-[10px]">
                        {s.status === "paid" ? "Zaplatené" : "Storno"}
                      </Badge>
                    </td>
                    <td className="font-mono text-[11px]">{r?.receipt_number || "—"}</td>
                    <td>
                      {r ? (
                        <Badge variant={r.status === "issued" ? "default" : "destructive"} className="text-[10px]">
                          {r.status === "issued" ? "Vystavený" : "Stornovaný"}
                        </Badge>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="flex gap-1">
                      {r && (
                        <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                          <Link to="/organizer/pos/fiscal">Zobraziť doklad</Link>
                        </Button>
                      )}
                      {s.status === "paid" && (
                        <Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => onVoid(s.id)}>
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
    </div>
  );
}
