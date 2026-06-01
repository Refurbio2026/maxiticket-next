import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCashiers, POS_EVENT, type Cashier } from "@/lib/cashier-db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/pos/cashiers")({
  head: () => ({ meta: [{ title: "Pokladne · Admin" }] }),
  component: () => {
    const [list, setList] = useState<Cashier[]>([]);
    const [tick, setTick] = useState(0);
    useEffect(() => { setList(getCashiers()); }, [tick]);
    useEffect(() => {
      const h = () => setTick((t) => t + 1);
      window.addEventListener(POS_EVENT, h);
      return () => window.removeEventListener(POS_EVENT, h);
    }, []);
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-3xl font-bold">Pokladne (všetci pokladníci)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Prehľad pokladníkov naprieč všetkými organizátormi. Správa prebieha v organizer dashboarde.
          </p>
        </div>
        <Card className="p-5 bg-card/60 border-border/50">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žiadni pokladníci.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border/50">
                  <tr>
                    <th className="text-left py-2">Meno</th>
                    <th className="text-left">Organizátor</th>
                    <th className="text-left">Stav</th>
                    <th className="text-left">Oprávnenia</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id} className="border-b border-border/30">
                      <td className="py-2 font-medium">
                        {c.display_name}
                        <div className="text-xs text-muted-foreground font-normal">
                          {c.first_name} {c.last_name}
                        </div>
                      </td>
                      <td className="text-xs font-mono text-muted-foreground">{c.organizer_id}</td>
                      <td>
                        {c.status === "active"
                          ? <Badge>Aktívny</Badge>
                          : <Badge variant="outline">Neaktívny</Badge>}
                      </td>
                      <td className="text-xs text-muted-foreground">{c.permissions.length} oprávnení</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
  },
});
