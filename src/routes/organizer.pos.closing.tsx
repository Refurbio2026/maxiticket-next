import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  getSales, computeClosing, addClosing, getAuditLogs, POS_EVENT,
  type PosSale,
} from "@/lib/pos-db";
import {
  getActiveSession, closeSession, addClosure, computeSessionTotals,
} from "@/lib/cashier-db";
import { uid } from "@/lib/local-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Banknote, CreditCard, Building2, Gift, Ban, FileDown, Printer,
  ArrowLeft, Receipt, ShieldCheck, LogOut,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/pos/closing")({
  head: () => ({ meta: [{ title: "Denná uzávierka · vstupenky.sk" }] }),
  component: ClosingPage,
});

function ClosingPage() {
  const { user } = useAuth();
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [sales, setSales] = useState<PosSale[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!user) return;
    setSales(getSales().filter((s) => s.organizer_id === user.id && s.created_at.startsWith(date)));
  }, [user, date, tick]);

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener(POS_EVENT, h);
    return () => window.removeEventListener(POS_EVENT, h);
  }, []);

  if (!user) return null;
  const stats = computeClosing(user.id, date);
  const total = stats.cash_total + stats.card_total + stats.transfer_total + stats.free_total;

  const exportCsv = () => {
    const rows = [
      ["Doklad", "Čas", "Podujatie", "Platba", "Suma", "Stav", "Pokladník"],
      ...sales.map((s) => [
        s.receipt_number, s.created_at, s.event_title,
        s.payment_method, s.total.toFixed(2), s.status, s.cashier_name,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `uzavierka-${date}.csv`; a.click();
  };

  const exportPdf = () => window.print();

  const closeDay = () => {
    if (!confirm("Uzavrieť deň? Vytvorí sa protokol o uzávierke.")) return;
    addClosing({
      id: uid(),
      organizer_id: user.id,
      date,
      created_at: new Date().toISOString(),
      ...stats,
    });
    toast.success("Denná uzávierka vytvorená");
  };

  const closeShift = () => {
    const active = getActiveSession();
    if (!active) {
      toast.info("Žiadna aktívna pokladničná zmena.");
      return;
    }
    const cashStr = prompt(
      `Spočítaj hotovosť v zásuvke pre pokladníka ${active.cashier_display_name} (€):`,
      "0",
    );
    if (cashStr === null) return;
    const closingCash = Number(cashStr) || 0;
    const totals = computeSessionTotals(active.id);
    const expected = active.opening_cash_amount + totals.total_cash_sales;
    addClosure({
      id: uid(),
      cashier_id: active.cashier_id,
      cashier_display_name: active.cashier_display_name,
      cashier_session_id: active.id,
      organizer_id: active.organizer_id,
      closing_cash_amount: closingCash,
      expected_cash_amount: expected,
      cash_difference: closingCash - expected,
      total_card_sales: totals.total_card_sales,
      total_cash_sales: totals.total_cash_sales,
      total_sales: totals.total_sales,
      order_count: totals.order_count,
      created_at: new Date().toISOString(),
    });
    closeSession(active.id, closingCash);
    const diff = closingCash - expected;
    toast.success(
      diff === 0
        ? "Pokladničná zmena uzavretá — hotovosť sedí."
        : `Pokladničná zmena uzavretá. Rozdiel: ${diff > 0 ? "+" : ""}€${diff.toFixed(2)}`,
    );
  };

  const audit = getAuditLogs().filter((a) => a.created_at.startsWith(date)).slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to="/organizer/pos"><ArrowLeft className="size-4 mr-1.5" /> Späť na pokladňu</Link>
          </Button>
          <h1 className="font-display text-4xl font-bold tracking-tight">Denná uzávierka</h1>
          <p className="text-muted-foreground mt-1">Súhrn predajov a hotovostných operácií za vybraný deň.</p>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Dátum</div>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 w-44" />
          </div>
          <Button variant="outline" onClick={exportCsv}><FileDown className="size-4 mr-2" /> CSV</Button>
          <Button variant="outline" onClick={exportPdf}><Printer className="size-4 mr-2" /> PDF</Button>
          <Button variant="outline" onClick={closeShift}>
            <LogOut className="size-4 mr-2" /> Uzavrieť zmenu
          </Button>
          <Button onClick={closeDay} className="bg-gradient-flame text-primary-foreground shadow-glow">
            <ShieldCheck className="size-4 mr-2" /> Uzavrieť deň
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile icon={<Banknote className="size-4 text-primary" />} label="Hotovosť" value={`€${stats.cash_total.toFixed(2)}`} />
        <Tile icon={<CreditCard className="size-4 text-primary" />} label="Karta" value={`€${stats.card_total.toFixed(2)}`} />
        <Tile icon={<Building2 className="size-4 text-primary" />} label="Prevod" value={`€${stats.transfer_total.toFixed(2)}`} />
        <Tile icon={<Gift className="size-4 text-primary" />} label="Guestlist" value={`€${stats.free_total.toFixed(2)}`} />
        <Tile icon={<Ban className="size-4 text-destructive" />} label="Storná" value={`€${stats.voided_total.toFixed(2)}`} />
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Celkové tržby</div>
            <div className="font-display text-4xl font-bold mt-1">€{total.toFixed(2)}</div>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <div>Dokladov: <span className="text-foreground font-semibold">{stats.receipts_count}</span></div>
            <div>Vstupeniek: <span className="text-foreground font-semibold">{stats.tickets_count}</span></div>
          </div>
        </div>
      </Card>

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Predaje dňa</div>
        {sales.length === 0 ? (
          <p className="text-sm text-muted-foreground">Za vybraný deň neevidujeme žiadne predaje.</p>
        ) : (
          <div className="overflow-x-auto">
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
                {sales.map((s) => (
                  <tr key={s.id} className="border-b border-border/30">
                    <td className="py-2 font-mono text-xs">{s.receipt_number}</td>
                    <td className="text-xs">{new Date(s.created_at).toLocaleTimeString("sk-SK")}</td>
                    <td className="truncate max-w-[220px]">{s.event_title}</td>
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
          </div>
        )}
      </Card>

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Receipt className="size-3.5" /> Audit log (posledné)
        </div>
        {audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žiadne záznamy za tento deň.</p>
        ) : (
          <div className="space-y-2">
            {audit.map((a) => (
              <div key={a.id} className="text-xs flex gap-3 items-start">
                <span className="text-muted-foreground font-mono">{new Date(a.created_at).toLocaleTimeString("sk-SK")}</span>
                <span className="font-medium">{a.user_name}</span>
                <span className="text-primary">{a.action}</span>
                <span className="text-muted-foreground truncate">{JSON.stringify(a.meta)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Separator />
      <p className="text-xs text-muted-foreground">
        Demo prototyp · Reálne napojenie na ORP / eKasa a USB platobný terminál sa doplní podľa
        oficiálnej dokumentácie Finančnej správy SR a poskytovateľa terminálu.
      </p>
    </div>
  );
}

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="p-4 bg-card/60 border-border/50">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="font-display text-lg font-bold mt-0.5">{value}</div>
        </div>
        {icon}
      </div>
    </Card>
  );
}
