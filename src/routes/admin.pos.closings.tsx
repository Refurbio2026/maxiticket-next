import { createFileRoute } from "@tanstack/react-router";
import { usePosClosings } from "@/hooks/use-pos";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/pos/closings")({
  head: () => ({ meta: [{ title: "Uzávierky · Admin" }] }),
  component: AdminPosClosingsPage,
});

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("sk-SK", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AdminPosClosingsPage() {
  const { data: list = [], isLoading } = usePosClosings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Uzávierky pokladní</h1>
        <p className="text-muted-foreground mt-1">
          Zmrazený doklad o tržbe za smenu alebo deň — neskorší predaj ním už nehýbe.
        </p>
      </div>
      <Card className="p-5 bg-card/60 border-border/50 overflow-x-auto">
        {isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žiadne uzávierky.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border/50">
              <tr>
                <th className="text-left py-2">Obdobie</th>
                <th className="text-left">Pokladník</th>
                <th className="text-right">Hotovosť</th>
                <th className="text-right">Karta</th>
                <th className="text-right">Prevod</th>
                <th className="text-right">Spolu</th>
                <th className="text-right">Dokladov</th>
                <th className="text-right">Vstupeniek</th>
                <th className="text-right">Rozdiel v zásuvke</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-b border-border/30">
                  <td className="py-2 text-xs">
                    {fmtDate(c.period_from)}
                    <span className="text-muted-foreground"> → {fmtDate(c.period_to)}</span>
                  </td>
                  <td className="text-xs">{c.cashier_name}</td>
                  <td className="text-right">€{c.cash_total.toFixed(2)}</td>
                  <td className="text-right">€{c.card_total.toFixed(2)}</td>
                  <td className="text-right">€{c.transfer_total.toFixed(2)}</td>
                  <td className="text-right font-medium">€{c.gross_total.toFixed(2)}</td>
                  <td className="text-right">{c.orders_count}</td>
                  <td className="text-right">{c.tickets_count}</td>
                  <td
                    className={`text-right ${
                      c.cash_difference === null
                        ? "text-muted-foreground"
                        : c.cash_difference === 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive"
                    }`}
                  >
                    {c.cash_difference === null
                      ? "—"
                      : `${c.cash_difference > 0 ? "+" : ""}€${c.cash_difference.toFixed(2)}`}
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
