import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getCashiersForOrganizer, getSessions, type Cashier, type CashierSession } from "@/lib/cashier-db";
import { getSales, POS_EVENT, type PosSale } from "@/lib/pos-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileDown, Users, Eye } from "lucide-react";

export const Route = createFileRoute("/organizer/pos/cashier-sales")({
  head: () => ({ meta: [{ title: "Predaje pokladníkov · vstupenky.sk" }] }),
  component: CashierSalesPage,
});

function CashierSalesPage() {
  const { user } = useAuth();
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [sales, setSales] = useState<PosSale[]>([]);
  const [sessions, setSessions] = useState<CashierSession[]>([]);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [detail, setDetail] = useState<Cashier | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!user) return;
    setCashiers(getCashiersForOrganizer(user.id));
    setSales(getSales().filter((s) => s.organizer_id === user.id));
    setSessions(getSessions().filter((s) => s.organizer_id === user.id));
  }, [user, tick]);

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener(POS_EVENT, h);
    return () => window.removeEventListener(POS_EVENT, h);
  }, []);

  const rows = useMemo(() => {
    return cashiers.map((c) => {
      const own = sales.filter((s) => s.cashier_id === c.id && s.created_at.startsWith(date));
      const paid = own.filter((s) => s.status === "paid");
      const cash = paid.filter((s) => s.payment_method === "cash").reduce((a, b) => a + b.total, 0);
      const card = paid.filter((s) => s.payment_method === "card").reduce((a, b) => a + b.total, 0);
      const total = paid.reduce((a, b) => a + b.total, 0);
      const voids = own.filter((s) => s.status === "void").length;
      return { cashier: c, count: paid.length, cash, card, total, voids };
    }).filter((r) => r.count > 0 || r.voids > 0);
  }, [cashiers, sales, date]);

  const exportCsv = () => {
    const head = ["Dátum", "Pokladník", "Predajov", "Hotovosť", "Karta", "Spolu", "Storno"];
    const csv = [head, ...rows.map((r) => [
      date, r.cashier.display_name, r.count, r.cash.toFixed(2), r.card.toFixed(2), r.total.toFixed(2), r.voids,
    ])].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `predaje-pokladnikov-${date}.csv`; a.click();
  };

  const detailSales = useMemo(
    () => detail ? sales.filter((s) => s.cashier_id === detail.id && s.created_at.startsWith(date)) : [],
    [detail, sales, date],
  );
  const detailSessions = useMemo(
    () => detail ? sessions.filter((s) => s.cashier_id === detail.id && s.opened_at.startsWith(date)) : [],
    [detail, sessions, date],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Predaje pokladníkov</h1>
          <p className="text-muted-foreground mt-1">Súhrn predajov za vybraný deň podľa jednotlivých pokladníkov.</p>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Dátum</div>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 w-44" />
          </div>
          <Button variant="outline" onClick={exportCsv}><FileDown className="size-4 mr-2" /> CSV</Button>
        </div>
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        {rows.length === 0 ? (
          <div className="text-center py-12">
            <Users className="size-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Za vybraný deň žiadne predaje pokladníkov.</p>
            <Button asChild className="mt-4 bg-gradient-flame text-primary-foreground shadow-glow">
              <Link to="/organizer/pos">Otvoriť pokladňu</Link>
            </Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border/50">
              <tr>
                <th className="text-left py-2">Pokladník</th>
                <th className="text-right">Predajov</th>
                <th className="text-right">Hotovosť</th>
                <th className="text-right">Karta</th>
                <th className="text-right">Spolu</th>
                <th className="text-right">Storno</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cashier.id} className="border-b border-border/30">
                  <td className="py-2">
                    <div className="font-medium">{r.cashier.display_name}</div>
                    <div className="text-xs text-muted-foreground">{r.cashier.first_name} {r.cashier.last_name}</div>
                  </td>
                  <td className="text-right">{r.count}</td>
                  <td className="text-right">€{r.cash.toFixed(2)}</td>
                  <td className="text-right">€{r.card.toFixed(2)}</td>
                  <td className="text-right font-semibold">€{r.total.toFixed(2)}</td>
                  <td className="text-right">{r.voids > 0 ? <Badge variant="destructive">{r.voids}</Badge> : "0"}</td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setDetail(r.cashier)}>
                      <Eye className="size-3.5 mr-1.5" /> Detail
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.display_name} · {date}</DialogTitle>
          </DialogHeader>
          {detailSessions.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Sessiony</div>
              <div className="grid sm:grid-cols-2 gap-2">
                {detailSessions.map((s) => (
                  <Card key={s.id} className="p-3 bg-muted/30">
                    <div className="text-xs text-muted-foreground">
                      {new Date(s.opened_at).toLocaleTimeString("sk-SK")}
                      {s.closed_at && ` – ${new Date(s.closed_at).toLocaleTimeString("sk-SK")}`}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <Badge variant={s.status === "open" ? "default" : "outline"} className="text-[10px]">
                        {s.status === "open" ? "Otvorená" : "Zatvorená"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Otv. hotov: €{s.opening_cash_amount.toFixed(2)}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
          <div className="text-xs uppercase tracking-wider text-muted-foreground mt-4">Predaje</div>
          {detailSales.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Žiadne predaje.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">Doklad</th>
                  <th className="text-left">Čas</th>
                  <th className="text-left">Podujatie</th>
                  <th className="text-left">Platba</th>
                  <th className="text-right">Suma</th>
                  <th className="text-left">Stav</th>
                </tr>
              </thead>
              <tbody>
                {detailSales.map((s) => (
                  <tr key={s.id} className="border-b border-border/30">
                    <td className="py-2 font-mono text-xs">{s.receipt_number}</td>
                    <td className="text-xs">{new Date(s.created_at).toLocaleTimeString("sk-SK")}</td>
                    <td className="truncate max-w-[200px]">{s.event_title}</td>
                    <td className="capitalize">{s.payment_method}</td>
                    <td className="text-right">€{s.total.toFixed(2)}</td>
                    <td>
                      <Badge variant={s.status === "paid" ? "default" : "destructive"} className="text-[10px]">
                        {s.status === "paid" ? "Zaplatené" : "Storno"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
