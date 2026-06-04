import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  TrendingUp,
  Ticket,
  CalendarDays,
  Users,
  RotateCcw,
  ArrowUpRight,
  ArrowRight,
  Flame,
  Activity,
  ScanLine,
  Loader2,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAdminOverview, getScanStatsAll } from "@/lib/admin-stats.functions";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

const fmtEur = (n: number) => `€ ${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (n: number) => n.toLocaleString("sk-SK");

const statusTone: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending: "bg-accent/15 text-accent border-accent/30",
  awaiting_payment: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  refunded: "bg-destructive/15 text-destructive border-destructive/30",
  cancelled: "bg-muted text-muted-foreground border-border/40",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  expired: "bg-muted text-muted-foreground border-border/40",
};

const statusLabel: Record<string, string> = {
  paid: "Zaplatené",
  pending: "Čaká",
  awaiting_payment: "Čaká na platbu",
  refunded: "Refundované",
  cancelled: "Zrušené",
  failed: "Zlyhala",
  expired: "Expirované",
};

function AdminDashboard() {
  const fetchOverview = useServerFn(getAdminOverview);
  const fetchScans = useServerFn(getScanStatsAll);

  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => fetchOverview({ data: {} as any }),
    refetchInterval: 60_000,
  });

  const scans = useQuery({
    queryKey: ["admin-scans-all"],
    queryFn: () => fetchScans({ data: {} as any }),
    refetchInterval: 10_000,
  });

  const kpi = overview.data?.kpi;
  const series = overview.data?.series ?? [];
  const top = overview.data?.top_events ?? [];
  const recent = overview.data?.recent_orders ?? [];

  const stats = [
    { label: "Dnešné tržby", value: kpi ? fmtEur(kpi.today_revenue) : "—", icon: TrendingUp, tone: "primary" },
    { label: "Vstupenky (dnes)", value: kpi ? fmtNum(kpi.today_tickets) : "—", icon: Ticket, tone: "accent" },
    { label: "Aktívne podujatia", value: kpi ? fmtNum(kpi.active_events) : "—", icon: CalendarDays, tone: "success" },
    { label: "Organizátori", value: kpi ? fmtNum(kpi.organizers) : "—", icon: Users, tone: "muted" },
    { label: "Refundácie", value: kpi ? fmtNum(kpi.pending_refunds) : "—", icon: RotateCcw, tone: "destructive" },
  ];

  const toneClass: Record<string, string> = {
    primary: "from-primary/20 to-primary/0 text-primary",
    accent: "from-accent/20 to-accent/0 text-accent",
    success: "from-emerald-500/20 to-emerald-500/0 text-emerald-400",
    muted: "from-muted-foreground/15 to-muted-foreground/0 text-foreground",
    destructive: "from-destructive/20 to-destructive/0 text-destructive",
  };

  const today = new Date().toLocaleDateString("sk-SK", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary">
            <Flame className="h-3 w-3" /> Live · {today}
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Prehľad MAXITICKET</h1>
          <p className="mt-1 text-sm text-muted-foreground">Reálne dáta z platformy. Auto-refresh každú minútu.</p>
        </div>
        <Button asChild className="bg-gradient-flame text-primary-foreground hover:opacity-90">
          <Link to="/admin/events/events">
            Nové podujatie <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {overview.isError && (
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Nepodarilo sa načítať prehľad: {(overview.error as any)?.message || "neznáma chyba"}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="relative overflow-hidden border-border/50 bg-card">
            <div className={`absolute inset-0 bg-gradient-to-br ${toneClass[s.tone].split(" ").slice(0, 2).join(" ")} opacity-40`} />
            <CardContent className="relative p-5">
              <div className="flex items-start justify-between">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-background/60 ${toneClass[s.tone].split(" ").slice(2).join(" ")}`}>
                  <s.icon className="h-4 w-4" />
                </div>
                {overview.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              <div className="mt-4 font-display text-2xl font-bold tracking-tight">{s.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="border-border/50 bg-card xl:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between pb-2">
            <div>
              <CardTitle className="font-display text-lg">Predaje za posledných 7 dní</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Tržby (€) z reálnych objednávok</p>
            </div>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              Spolu zaplatené: {kpi ? fmtEur(kpi.paid_orders_total) : "—"}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.69 0.21 38)" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="oklch(0.69 0.21 38)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
                  <XAxis dataKey="d" stroke="oklch(0.68 0.02 270)" fontSize={11} />
                  <YAxis stroke="oklch(0.68 0.02 270)" fontSize={11} />
                  <Tooltip
                    contentStyle={{ background: "oklch(0.17 0.025 270)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 12, fontSize: 12 }}
                    formatter={(v: number, k: string) => [k === "revenue" ? fmtEur(v) : fmtNum(v), k === "revenue" ? "Tržby" : "Vstupenky"]}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="oklch(0.69 0.21 38)" strokeWidth={2.5} fill="url(#rev)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-display text-lg inline-flex items-center gap-2">
              <ScanLine className="h-4 w-4 text-primary" /> Live kontrola vstupov
            </CardTitle>
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500 gap-1">
              <Activity className="h-3 w-3" /> 10s
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {scans.isLoading ? (
              <div className="py-6 text-center text-xs text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /></div>
            ) : (scans.data || []).length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">Žiadne predané vstupenky.</div>
            ) : (
              (scans.data || []).slice(0, 6).map((r) => {
                const pct = r.sold ? Math.round((r.used / r.sold) * 100) : 0;
                return (
                  <div key={r.event_id} className="rounded-lg border border-border/40 bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{r.event_title}</div>
                        <div className="text-[10px] text-muted-foreground">{r.event_date}</div>
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        <span className="font-display font-bold text-foreground">{r.used}</span>
                        <span className="text-muted-foreground"> / {r.sold}</span>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/60">
                      <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="border-border/50 bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-display text-lg">Najpredávanejšie podujatia</CardTitle>
            <Link to="/admin/events/events" className="inline-flex items-center text-xs font-medium text-primary hover:underline">
              Všetky <ArrowUpRight className="ml-1 h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              {top.length === 0 && !overview.isLoading ? (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">Žiadne predané vstupenky.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" horizontal={false} />
                    <XAxis type="number" stroke="oklch(0.68 0.02 270)" fontSize={11} />
                    <YAxis type="category" dataKey="name" stroke="oklch(0.68 0.02 270)" fontSize={11} width={140} />
                    <Tooltip
                      contentStyle={{ background: "oklch(0.17 0.025 270)", border: "1px solid oklch(1 0 0 / 0.1)", borderRadius: 12, fontSize: 12 }}
                      formatter={(v: number) => [fmtNum(v), "Predaných"]}
                    />
                    <Bar dataKey="sold" fill="oklch(0.83 0.17 82)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-display text-lg">Posledné objednávky</CardTitle>
            <Link to="/admin/sales/sales" className="inline-flex items-center text-xs font-medium text-primary hover:underline">
              Všetky <ArrowUpRight className="ml-1 h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {recent.length === 0 && !overview.isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Zatiaľ žiadne objednávky.</div>
            ) : (
              <div className="divide-y divide-border/30">
                {recent.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{o.id.slice(0, 8).toUpperCase()}</span>
                        <Badge variant="outline" className={`${statusTone[o.status] || ""} text-[10px]`}>
                          {statusLabel[o.status] || o.status}
                        </Badge>
                      </div>
                      <div className="mt-0.5 truncate text-sm font-medium">{o.event_title || "—"}</div>
                      <div className="truncate text-xs text-muted-foreground">{o.customer_email || "—"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-display text-sm font-bold">{fmtEur(o.total_amount)}</div>
                      <div className="text-xs text-muted-foreground">{o.qty} ks</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
