import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCashiers, POS_EVENT, type PosCashier } from "@/lib/pos-db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/pos/cashiers")({
  head: () => ({ meta: [{ title: "Pokladne · Admin" }] }),
  component: () => {
    const [list, setList] = useState<PosCashier[]>([]);
    const [tick, setTick] = useState(0);
    useEffect(() => { setList(getCashiers()); }, [tick]);
    useEffect(() => {
      const h = () => setTick((t) => t + 1);
      window.addEventListener(POS_EVENT, h);
      return () => window.removeEventListener(POS_EVENT, h);
    }, []);
    return (
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-bold">Pokladne (všetci pokladníci)</h1>
        <Card className="p-5 bg-card/60 border-border/50">
          {list.length === 0 ? <p className="text-sm text-muted-foreground">Žiadni pokladníci.</p> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr><th className="text-left py-2">Meno</th><th className="text-left">Email</th><th className="text-left">Organizátor</th><th className="text-left">Storno</th></tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="border-b border-border/30">
                    <td className="py-2 font-medium">{c.name}</td>
                    <td className="text-muted-foreground">{c.email}</td>
                    <td className="text-xs font-mono">{c.organizer_id}</td>
                    <td>{c.can_void ? <Badge>Povolené</Badge> : <Badge variant="outline">Iba s povolením</Badge>}</td>
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
