import { createFileRoute } from "@tanstack/react-router";
import { usePosSales } from "@/hooks/use-pos";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/pos/sales")({
  head: () => ({ meta: [{ title: "POS Predaje · Admin" }] }),
  component: AdminPosSalesPage,
});

function AdminPosSalesPage() {
  // Admin bez zadaného organizátora vidí pokladne všetkých.
  const { data: sales = [], isLoading } = usePosSales({ limit: 500 });

  const total = sales
    .filter((s) => s.status === "paid")
    .reduce((sum, s) => sum + s.total, 0)
    .toFixed(2);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">POS Predaje (všetci organizátori)</h1>
        <p className="text-muted-foreground mt-1">
          {sales.length} dokladov · zaplatené spolu €{total}
        </p>
      </div>
      <Card className="p-5 bg-card/60 border-border/50 overflow-x-auto">
        {isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : sales.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žiadne predaje z pokladne.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border/50">
              <tr>
                <th className="text-left py-2">Doklad</th>
                <th className="text-left">Dátum</th>
                <th className="text-left">Podujatie</th>
                <th className="text-left">Termín</th>
                <th className="text-left">Pokladník</th>
                <th className="text-left">Platba</th>
                <th className="text-right">Suma</th>
                <th className="text-left">Stav</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className="border-b border-border/30">
                  <td className="py-2 font-mono text-xs">{s.receipt_number}</td>
                  <td className="text-xs">{new Date(s.created_at).toLocaleString("sk-SK")}</td>
                  <td className="truncate max-w-[200px]">{s.event_title}</td>
                  <td className="text-xs text-muted-foreground">{s.event_date}</td>
                  <td className="text-xs text-muted-foreground">{s.cashier_name || "—"}</td>
                  <td className="capitalize">{s.payment_method}</td>
                  <td className="text-right">€{s.total.toFixed(2)}</td>
                  <td>
                    <Badge
                      variant={s.status === "paid" ? "default" : "destructive"}
                      className="text-[10px]"
                    >
                      {s.status === "paid" ? "Zaplatené" : "Storno"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
