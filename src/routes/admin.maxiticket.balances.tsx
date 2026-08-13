import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listOrganizerBalances } from "@/lib/organizer-finance.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Scale } from "lucide-react";

export const Route = createFileRoute("/admin/maxiticket/balances")({
  head: () => ({ meta: [{ title: "Bilancie · vipky.sk Admin" }] }),
  component: Page,
});

const fmtEur = (n: number) =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function Page() {
  const fetchBalances = useServerFn(listOrganizerBalances);
  const q = useQuery({
    queryKey: ["organizer-balances"],
    queryFn: () => fetchBalances({ data: undefined as never }),
  });

  const rows = q.data ?? [];
  const totals = rows.reduce(
    (acc, r) => ({
      gross: acc.gross + r.gross_all_time,
      unsettled: acc.unsettled + r.unsettled_gross,
      costs: acc.costs + r.open_costs,
      due: acc.due + r.due_amount,
      paid: acc.paid + r.paid_amount,
    }),
    { gross: 0, unsettled: 0, costs: 0, due: 0, paid: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Bilancie</h1>
        <p className="text-muted-foreground mt-1">
          Kde stojí každý organizátor: koľko sa zaňho predalo, čo je už vo{" "}
          <Link to="/admin/maxiticket/protocols" className="text-primary hover:underline">
            vyúčtovacom protokole
          </Link>
          , čo naňho ešte čaká a koľko mu dlhujeme. Všetko sa počíta zo skutočných objednávok,
          protokolov a nákladov — nič sa tu nezadáva ručne.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Tržba spolu" value={fmtEur(totals.gross)} />
        <Tile label="Zatiaľ mimo protokolov" value={fmtEur(totals.unsettled)} />
        <Tile label="Na úhradu" value={fmtEur(totals.due)} accent />
        <Tile label="Už vyplatené" value={fmtEur(totals.paid)} />
      </div>

      <Card className="bg-card/60 border-border/50 overflow-x-auto">
        {q.isLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <Scale className="mx-auto size-6 text-muted-foreground mb-2" />
            <div className="font-semibold">Žiadni organizátori</div>
            <p className="text-sm text-muted-foreground mt-1">
              Bilancia vznikne, keď bude mať niekto podujatie alebo predaj.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left p-3">Organizátor</th>
                <th className="text-right p-3">Provízia</th>
                <th className="text-right p-3">Tržba spolu</th>
                <th className="text-right p-3">Vo vyúčtovaní</th>
                <th className="text-right p-3">Mimo protokolov</th>
                <th className="text-right p-3">Nevyúčt. náklady</th>
                <th className="text-right p-3">Na úhradu</th>
                <th className="text-right p-3">Vyplatené</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.organizer_id}
                  className="border-b border-border/20 hover:bg-muted/10 align-top"
                >
                  <td className="p-3">
                    <div className="font-medium">{r.organizer_name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {r.payout_iban ?? (
                        <Badge variant="outline" className="text-[10px] text-amber-500">
                          bez IBAN-u
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {r.commission_rate} %
                  </td>
                  <td className="p-3 text-right tabular-nums">{fmtEur(r.gross_all_time)}</td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {fmtEur(r.settled_gross)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {r.unsettled_gross > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {fmtEur(r.unsettled_gross)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{fmtEur(r.unsettled_gross)}</span>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {r.open_costs > 0 ? `− ${fmtEur(r.open_costs)}` : "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums font-semibold">
                    {r.due_amount > 0 ? fmtEur(r.due_amount) : "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {fmtEur(r.paid_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        „Mimo protokolov" je tržba, na ktorú ešte nikto nevystavil vyúčtovací protokol — teda práca,
        ktorá čaká. Záporná hodnota znamená, že protokol pokryl obdobie, v ktorom neskôr pribudli
        storná; vtedy sa oplatí protokoly prejsť.
      </p>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className={`p-5 bg-card/60 ${accent ? "border-primary/40" : "border-border/50"}`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-bold mt-1 tabular-nums">{value}</div>
    </Card>
  );
}
