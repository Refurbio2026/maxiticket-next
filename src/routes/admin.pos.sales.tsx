import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getSales, POS_EVENT, type PosSale } from "@/lib/pos-db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/pos/sales")({
  head: () => ({ meta: [{ title: "POS Predaje · Admin" }] }),
  component: () => {
    const [sales, setSales] = useState<PosSale[]>([]);
    const [tick, setTick] = useState(0);
    useEffect(() => { setSales(getSales()); }, [tick]);
    useEffect(() => {
      const h = () => setTick((t) => t + 1);
      window.addEventListener(POS_EVENT, h);
      return () => window.removeEventListener(POS_EVENT, h);
    }, []);
    return (
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-bold">POS Predaje (všetci organizátori)</h1>
        <Card className="p-5 bg-card/60 border-border/50">
          {sales.length === 0 ? <p className="text-sm text-muted-foreground">Žiadne predaje.</p> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr><th className="text-left py-2">Doklad</th><th className="text-left">Dátum</th><th className="text-left">Podujatie</th><th className="text-left">Pokladník</th><th className="text-left">Platba</th><th className="text-right">Suma</th><th className="text-left">Stav</th></tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="border-b border-border/30">
                    <td className="py-2 font-mono text-xs">{s.receipt_number}</td>
                    <td className="text-xs">{new Date(s.created_at).toLocaleString("sk-SK")}</td>
                    <td className="truncate max-w-[200px]">{s.event_title}</td>
                    <td className="text-xs text-muted-foreground">{s.cashier_name}</td>
                    <td className="capitalize">{s.payment_method}</td>
                    <td className="text-right">€{s.total.toFixed(2)}</td>
                    <td><Badge variant={s.status === "paid" ? "default" : "destructive"} className="text-[10px]">{s.status === "paid" ? "Zaplatené" : "Storno"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    );
  },
});
