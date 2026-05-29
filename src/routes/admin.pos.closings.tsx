import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getClosings, POS_EVENT, type PosClosing } from "@/lib/pos-db";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/admin/pos/closings")({
  head: () => ({ meta: [{ title: "Uzávierky · Admin" }] }),
  component: () => {
    const [list, setList] = useState<PosClosing[]>([]);
    const [tick, setTick] = useState(0);
    useEffect(() => { setList(getClosings()); }, [tick]);
    useEffect(() => {
      const h = () => setTick((t) => t + 1);
      window.addEventListener(POS_EVENT, h);
      return () => window.removeEventListener(POS_EVENT, h);
    }, []);
    return (
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-bold">Denné uzávierky</h1>
        <Card className="p-5 bg-card/60 border-border/50">
          {list.length === 0 ? <p className="text-sm text-muted-foreground">Žiadne uzávierky.</p> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr><th className="text-left py-2">Dátum</th><th className="text-left">Organizátor</th><th className="text-right">Hotovosť</th><th className="text-right">Karta</th><th className="text-right">Prevod</th><th className="text-right">Dokladov</th><th className="text-right">Vstupeniek</th></tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="border-b border-border/30">
                    <td className="py-2">{c.date}</td>
                    <td className="text-xs font-mono">{c.organizer_id}</td>
                    <td className="text-right">€{c.cash_total.toFixed(2)}</td>
                    <td className="text-right">€{c.card_total.toFixed(2)}</td>
                    <td className="text-right">€{c.transfer_total.toFixed(2)}</td>
                    <td className="text-right">{c.receipts_count}</td>
                    <td className="text-right">{c.tickets_count}</td>
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
