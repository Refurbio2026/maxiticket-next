import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, TrendingUp, FileCheck2, FileWarning, RotateCcw, Clock, Wallet } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { getFinanceStats } from "@/lib/admin-stats.functions";

export const Route = createFileRoute("/admin/finance/stats")({
  head: () => ({ meta: [{ title: "Finančné štatistiky · MAXITICKET Admin" }] }),
  component: Page,
});

const fmtEur = (n: number) => `€ ${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (n: number) => n.toLocaleString("sk-SK");

function Page() {
  const fetchStats = useServerFn(getFinanceStats);
  const q = useQuery({
    queryKey: ["finance-stats"],
    queryFn: () => fetchStats({ data: {} as any }),
    refetchInterval: 60_000,
  });

  const d = q.data;

  const kpi = [
    { label: "Zaplatené (suma)", value: d ? fmtEur(d.total_paid_amount) : "—", sub: d ? `${fmtNum(d.total_paid_orders)} objednávok` : "", icon: Wallet, tone: "primary" },
    { label: "Čaká na platbu", value: d ? fmtEur(d.total_pending_amount) : "—", sub: d ? `${fmtNum(d.total_pending_orders)} objednávok` : "", icon: Clock, tone: "accent" },
    { label: "Refundované", value: d ? fmtEur(d.total_refunded_amount) : "—", sub: d ? `${fmtNum(d.total_refunded_orders)} objednávok` : "", icon: RotateCcw, tone: "destructive" },
    { label: "Vystavené faktúry", value: d ? fmtNum(d.invoices_issued) : "—", sub: d && d.invoices_failed ? `${d.invoices_failed} zlyhalo` : "OK", icon: FileCheck2, tone: "success" },
  ];

  const toneClass: Record<string, string> = {
    primary: "from-primary/20 to-primary/0 text-primary",
    accent: "from-accent/20 to-accent/0 text-accent",
    success: "from-emerald-500/20 to-emerald-500/0 text-emerald-400",
    destructive: "from-destructive/20 to-destructive/0 text-destructive",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Finančné štatistiky</h1>
        <p className="text-muted-foreground text-sm mt-1">Agregované finančné ukazovatele zo systému.</p>
      </div>

      {q.isError && <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{(q.error as any)?.message}</Card>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpi.map((s) => (
          <Card key={s.label} className="relative overflow-hidden border-border/50 bg-card">
            <div className={`absolute inset-0 bg-gradient-to-br ${toneClass[s.tone].split(" ").slice(0, 2).join(" ")} opacity-40`} />
            <CardContent className="relative p-5">
              <div className="flex items-start justify-between">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-background/60 ${toneClass[s.tone].split(" ").slice(2).join(" ")}`}>
                  <s.icon className="h-4 w-4" />
                </div>
                {q.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              <div className="mt-4 font-display text-2xl font-bold tracking-tight">{s.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
              {s.sub && <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/80">{s.sub}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-border/50 bg-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-lg inline-flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Tržby za posledných 6 mesiacov
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {q.isLoading ? (
                <div className="grid h-full place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d?.monthly || []} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
                    <XAxis dataKey="month" stroke="oklch(0.68 0.02 270)" fontSize={11} />
                    <YAxis stroke="oklch(0.68 0.02 270)" fontSize={11} />
                    <Tooltip
                      contentStyle={{ background: "oklch(0.17 0.025 270)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 12, fontSize: 12 }}
                      formatter={(v: number, k: string) => [k === "revenue" ? fmtEur(v) : fmtNum(v), k === "revenue" ? "Tržby" : "Objednávky"]}
                    />
                    <Bar dataKey="revenue" fill="oklch(0.69 0.21 38)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card">
          <CardHeader>
            <CardTitle className="font-display text-lg">Podľa poskytovateľa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(d?.by_provider || []).length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">Žiadne platby.</div>
            ) : (
              d!.by_provider.map((p) => (
                <div key={p.provider} className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 p-3">
                  <div>
                    <div className="font-medium uppercase text-sm">{p.provider}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{fmtNum(p.count)} transakcií</div>
                  </div>
                  <div className="font-display font-bold">{fmtEur(p.amount)}</div>
                </div>
              ))
            )}
            {d && d.invoices_failed > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive mt-3">
                <FileWarning className="h-4 w-4" />
                {fmtNum(d.invoices_failed)} pokusov o vystavenie faktúry zlyhalo.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
