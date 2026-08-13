import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { checkSettlements, type SettlementCheck } from "@/lib/settlements.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck, AlertTriangle, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/admin/maxiticket/control")({
  head: () => ({ meta: [{ title: "Kontrola zostavy · vipky.sk Admin" }] }),
  component: Page,
});

const fmtEur = (n: number) =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function Page() {
  const fetchChecks = useServerFn(checkSettlements);
  const [onlyBad, setOnlyBad] = useState(false);

  const q = useQuery({
    queryKey: ["settlement-checks", onlyBad],
    queryFn: () => fetchChecks({ data: { only_mismatched: onlyBad } }),
  });

  const rows = q.data ?? [];
  const bad = rows.filter((r) => !r.ok);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Kontrola zostavy</h1>
          <p className="text-muted-foreground mt-1">
            Porovnáva čísla zmrazené vo{" "}
            <Link to="/admin/maxiticket/protocols" className="text-primary hover:underline">
              vyúčtovacích protokoloch
            </Link>{" "}
            s tým, čo by vyšlo dnes. Rozdiel nie je chyba — najčastejšie je to refundácia, ktorá
            prišla až po vystavení protokolu. Zmyslom je vedieť o nej skôr než účtovníčka.
          </p>
        </div>
        <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? (
            <Loader2 className="size-4 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="size-4 mr-1.5" />
          )}
          Prepočítať
        </Button>
      </div>

      {bad.length > 0 && (
        <Card className="p-4 bg-amber-500/10 border-amber-500/40 flex items-start gap-3">
          <AlertTriangle className="size-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold">
              {bad.length} {bad.length === 1 ? "protokol sa rozchádza" : "protokolov sa rozchádza"}{" "}
              so súčasnými dátami
            </div>
            <p className="text-muted-foreground">
              Vyplatený protokol sa už neopravuje — rozdiel sa zvyčajne rieši v ďalšom období.
            </p>
          </div>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <Switch id="only-bad" checked={onlyBad} onCheckedChange={setOnlyBad} />
        <Label htmlFor="only-bad" className="text-sm cursor-pointer">
          Ukázať len rozdiely
        </Label>
      </div>

      {q.isLoading ? (
        <Card className="p-10 text-center bg-card/60 border-border/50">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center bg-card/60 border-dashed">
          <ShieldCheck className="mx-auto size-6 text-muted-foreground mb-2" />
          <div className="font-semibold">
            {onlyBad ? "Všetko sedí" : "Žiadne protokoly na kontrolu"}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {onlyBad
              ? "Žiadny protokol sa nerozchádza so súčasnými dátami."
              : "Kontrola porovnáva vystavené vyúčtovacie protokoly."}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <CheckCard key={r.settlement_id} check={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckCard({ check: r }: { check: SettlementCheck }) {
  return (
    <Card className={`p-5 bg-card/60 ${r.ok ? "border-border/50" : "border-amber-500/50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="font-semibold">{r.organizer_name}</div>
          <div className="text-xs text-muted-foreground">
            {r.period_from} – {r.period_to}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {r.status === "paid" ? "vyplatené" : r.status === "approved" ? "schválené" : "návrh"}
          </Badge>
          {r.ok ? (
            <Badge className="bg-emerald-500/15 text-emerald-500 text-[10px]">sedí</Badge>
          ) : (
            <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px]">
              rozdiel {r.net_diff > 0 ? "+" : ""}
              {fmtEur(r.net_diff)}
            </Badge>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border/40">
              <th className="text-left py-2" />
              <th className="text-right py-2">V protokole</th>
              <th className="text-right py-2">Dnes</th>
              <th className="text-right py-2">Rozdiel</th>
            </tr>
          </thead>
          <tbody>
            <CompareRow label="Vstupenky" frozen={r.frozen.tickets} current={r.current.tickets} />
            <CompareRow label="Hrubá tržba" frozen={r.frozen.gross} current={r.current.gross} eur />
            <CompareRow
              label="Refundácie"
              frozen={r.frozen.refunded}
              current={r.current.refunded}
              eur
            />
            <CompareRow
              label="Provízia"
              frozen={r.frozen.commission}
              current={r.current.commission}
              eur
            />
            <CompareRow label="Na výplatu" frozen={r.frozen.net} current={r.current.net} eur bold />
          </tbody>
        </table>
      </div>

      {r.attached_costs > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          Protokol má pripnuté náklady {fmtEur(r.attached_costs)} — do porovnania sú započítané.
        </p>
      )}
    </Card>
  );
}

function CompareRow({
  label,
  frozen,
  current,
  eur,
  bold,
}: {
  label: string;
  frozen: number;
  current: number;
  eur?: boolean;
  bold?: boolean;
}) {
  const diff = Math.round((current - frozen) * 100) / 100;
  const same = Math.abs(diff) < 0.01;
  const fmt = (n: number) => (eur ? fmtEur(n) : String(n));
  return (
    <tr className="border-b border-border/20">
      <td className={`py-2 ${bold ? "font-semibold" : "text-muted-foreground"}`}>{label}</td>
      <td className={`py-2 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
        {fmt(frozen)}
      </td>
      <td className={`py-2 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
        {fmt(current)}
      </td>
      <td
        className={`py-2 text-right tabular-nums ${
          same ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400 font-medium"
        }`}
      >
        {same ? "—" : `${diff > 0 ? "+" : ""}${fmt(diff)}`}
      </td>
    </tr>
  );
}
