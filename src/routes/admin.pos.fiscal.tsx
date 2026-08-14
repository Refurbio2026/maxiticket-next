import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Receipt, ShieldCheck } from "lucide-react";
import { listFiscalReceipts } from "@/lib/fiscal.functions";

export const Route = createFileRoute("/admin/pos/fiscal")({
  head: () => ({ meta: [{ title: "ORP / eKasa · Admin" }] }),
  component: AdminFiscalPage,
});

const eur = (n: number) =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function AdminFiscalPage() {
  // Admin vidí doklady všetkých organizátorov; nastavenie si každý spravuje
  // sám v organizátorskej sekcii.
  const fetchReceipts = useServerFn(listFiscalReceipts);
  const receipts = useQuery({
    queryKey: ["fiscal-receipts", "all"],
    queryFn: () => fetchReceipts({ data: { limit: 200 } }),
  });

  const rows = receipts.data ?? [];
  const issued = rows.filter((r) => r.status === "issued");
  const total = issued.reduce((s, r) => s + r.total_amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">ORP / eKasa</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Evidencia fiškálnych dokladov z pokladní. Odosielanie do eKasy je zatiaľ simulované —
          chýba certifikát a poskytovateľ.
        </p>
      </div>

      <Card className="p-5 bg-card/60 border-amber-500/30 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="size-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium">eKasa nie je napojená</div>
            <p className="text-muted-foreground mt-1">
              Doklady sa evidujú v databáze, ale neodosielajú sa na finančnú správu. Na ostrú
              prevádzku treba certifikát a zmluvu s poskytovateľom ORP.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat label="Vystavených dokladov" value={String(issued.length)} />
        <Stat label="Stornovaných" value={String(rows.length - issued.length)} />
        <Stat label="Suma dokladov" value={eur(total)} />
      </div>

      <Card className="p-5 bg-card/60 border-border/50 overflow-x-auto">
        {receipts.isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Zatiaľ žiadne fiškálne doklady.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border/50">
              <tr>
                <th className="text-left py-2">Doklad</th>
                <th className="text-left">Objednávka</th>
                <th className="text-left">Platba</th>
                <th className="text-right">Suma</th>
                <th className="text-left">Kód z eKasy</th>
                <th className="text-left">Vystavený</th>
                <th className="text-left">Stav</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/30">
                  <td className="py-2 font-mono text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <Receipt className="size-3.5 text-muted-foreground" />
                      {r.receipt_number}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-muted-foreground">
                    {r.order_short ?? "—"}
                  </td>
                  <td className="capitalize text-xs">{r.payment_method ?? "—"}</td>
                  <td className="text-right tabular-nums">{eur(r.total_amount)}</td>
                  <td className="font-mono text-[11px] text-muted-foreground">
                    {r.fiscal_code ?? "—"}
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {new Date(r.issued_at).toLocaleString("sk-SK")}
                  </td>
                  <td>
                    {r.status === "issued" ? (
                      <Badge>vystavený</Badge>
                    ) : r.status === "cancelled" ? (
                      <Badge variant="destructive">stornovaný</Badge>
                    ) : (
                      <Badge variant="outline">chyba</Badge>
                    )}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4 bg-card/60 border-border/50">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-bold mt-0.5">{value}</div>
    </Card>
  );
}
