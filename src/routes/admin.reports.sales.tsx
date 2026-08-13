import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { salesReport, type SalesReportGroup } from "@/lib/sales-reports.functions";
import { listOrganizerAccounts } from "@/lib/settlements.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, TrendingUp, Download } from "lucide-react";

export const Route = createFileRoute("/admin/reports/sales")({
  head: () => ({ meta: [{ title: "Reporty predajov · vipky.sk Admin" }] }),
  component: Page,
});

const GROUPS: { value: SalesReportGroup; label: string; head: string }[] = [
  { value: "event", label: "Po podujatiach", head: "Podujatie" },
  { value: "organizer", label: "Po organizátoroch", head: "Organizátor" },
  { value: "channel", label: "Po kanáloch predaja", head: "Kanál" },
  { value: "category", label: "Po kategóriách", head: "Kategória" },
  { value: "day", label: "Po dňoch", head: "Deň" },
];

const fmtEur = (n: number) =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Predvolené obdobie: aktuálny mesiac — to sa pýta človek najčastejšie. */
function monthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: first.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

function Page() {
  const fetchReport = useServerFn(salesReport);
  const fetchOrganizers = useServerFn(listOrganizerAccounts);

  const def = monthRange();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [groupBy, setGroupBy] = useState<SalesReportGroup>("event");
  const [organizer, setOrganizer] = useState("all");

  const q = useQuery({
    queryKey: ["sales-report", from, to, groupBy, organizer],
    queryFn: () =>
      fetchReport({
        data: {
          from: from || null,
          to: to || null,
          group_by: groupBy,
          organizer_id: organizer === "all" ? null : organizer,
        },
      }),
  });
  const organizers = useQuery({
    queryKey: ["organizer-accounts"],
    queryFn: () => fetchOrganizers({ data: undefined as never }),
  });

  const rows = q.data?.rows ?? [];
  const t = q.data?.totals;
  const timeline = q.data?.timeline ?? [];
  const peak = Math.max(1, ...timeline.map((d) => d.net));
  const head = GROUPS.find((g) => g.value === groupBy)?.head ?? "Položka";

  const exportCsv = () => {
    const header = [
      head,
      "Detail",
      "Objednávky",
      "Vstupenky",
      "Hrubá tržba",
      "Refundácie",
      "Čisté",
    ];
    const lines = rows.map((r) =>
      [
        r.label,
        r.sublabel ?? "",
        r.orders,
        r.tickets,
        r.gross.toFixed(2),
        r.refunded.toFixed(2),
        r.net.toFixed(2),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(";"),
    );
    const blob = new Blob(["﻿" + [header.join(";"), ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `report-predajov-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Reporty predajov</h1>
          <p className="text-muted-foreground mt-1">
            Zaplatené objednávky za obdobie. Refundácie sa odpočítavajú, takže „čisté" je to, čo
            naozaj ostalo — nie to, čo sa kedysi predalo.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="size-4 mr-1.5" /> Export CSV
        </Button>
      </div>

      <Card className="p-4 bg-card/60 border-border/50">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Od</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Do</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Zoskupiť</Label>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as SalesReportGroup)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUPS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Organizátor</Label>
            <Select value={organizer} onValueChange={setOrganizer}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Všetci</SelectItem>
                {(organizers.data ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.company_name || o.full_name || o.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Čistá tržba" value={fmtEur(t?.net ?? 0)} accent />
        <Tile label="Hrubá tržba" value={fmtEur(t?.gross ?? 0)} />
        <Tile label="Refundácie" value={fmtEur(t?.refunded ?? 0)} />
        <Tile
          label="Objednávky"
          value={String(t?.orders ?? 0)}
          hint={`${t?.tickets ?? 0} vstupeniek`}
        />
      </div>

      {timeline.length > 1 && (
        <Card className="p-5 bg-card/60 border-border/50">
          <h2 className="font-display font-semibold mb-4">Denný priebeh</h2>
          <div className="flex items-end gap-1 h-32">
            {timeline.map((d) => (
              <div
                key={d.day}
                className="flex-1 min-w-[3px] bg-primary/70 hover:bg-primary rounded-t transition-colors"
                style={{ height: `${Math.max(2, (d.net / peak) * 100)}%` }}
                title={`${d.day}: ${fmtEur(d.net)} · ${d.orders} obj.`}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>{timeline[0].day}</span>
            <span>{timeline[timeline.length - 1].day}</span>
          </div>
        </Card>
      )}

      <Card className="bg-card/60 border-border/50 overflow-x-auto">
        {q.isLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <TrendingUp className="mx-auto size-6 text-muted-foreground mb-2" />
            <div className="font-semibold">Za obdobie sa nič nepredalo</div>
            <p className="text-sm text-muted-foreground mt-1">Skús iné obdobie alebo filter.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left p-3">{head}</th>
                <th className="text-right p-3">Objednávky</th>
                <th className="text-right p-3">Vstupenky</th>
                <th className="text-right p-3">Hrubá tržba</th>
                <th className="text-right p-3">Refundácie</th>
                <th className="text-right p-3">Čisté</th>
                <th className="text-left p-3 w-[140px]">Podiel</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border/20 hover:bg-muted/10">
                  <td className="p-3 max-w-[280px]">
                    <div className="truncate">{r.label}</div>
                    {r.sublabel && (
                      <div className="text-xs text-muted-foreground">{r.sublabel}</div>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">{r.orders}</td>
                  <td className="p-3 text-right tabular-nums">{r.tickets}</td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {fmtEur(r.gross)}
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {r.refunded > 0 ? `− ${fmtEur(r.refunded)}` : "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums font-semibold whitespace-nowrap">
                    {fmtEur(r.net)}
                  </td>
                  <td className="p-3">
                    <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                      <div
                        className="h-full bg-gradient-flame"
                        style={{
                          width: `${t && t.net > 0 ? Math.max(1, (r.net / t.net) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border/40 font-semibold">
                <td className="p-3">Spolu</td>
                <td className="p-3 text-right tabular-nums">{t?.orders ?? 0}</td>
                <td className="p-3 text-right tabular-nums">{t?.tickets ?? 0}</td>
                <td className="p-3 text-right tabular-nums">{fmtEur(t?.gross ?? 0)}</td>
                <td className="p-3 text-right tabular-nums">
                  {(t?.refunded ?? 0) > 0 ? `− ${fmtEur(t!.refunded)}` : "—"}
                </td>
                <td className="p-3 text-right tabular-nums">{fmtEur(t?.net ?? 0)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </Card>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <Card className={`p-5 bg-card/60 ${accent ? "border-primary/40" : "border-border/50"}`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-bold mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </Card>
  );
}
