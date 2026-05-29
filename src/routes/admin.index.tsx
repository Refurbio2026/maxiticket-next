import { createFileRoute, Link } from "@tanstack/react-router";
import {
  TrendingUp,
  Ticket,
  CalendarDays,
  Users,
  RotateCcw,
  ArrowUpRight,
  ArrowRight,
  Bell,
  Flame,
  AlertTriangle,
  CheckCircle2,
  Activity,
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

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

const salesData = [
  { d: "Po", revenue: 12400, tickets: 412 },
  { d: "Ut", revenue: 18230, tickets: 587 },
  { d: "St", revenue: 22110, tickets: 712 },
  { d: "Št", revenue: 19840, tickets: 644 },
  { d: "Pi", revenue: 41250, tickets: 1284 },
  { d: "So", revenue: 53870, tickets: 1690 },
  { d: "Ne", revenue: 38420, tickets: 1213 },
];

const topEvents = [
  { name: "Pohoda 2026", sold: 18420, cap: 20000 },
  { name: "Hokej Slovan vs Košice", sold: 9870, cap: 10200 },
  { name: "Karol Duchoň Tribute", sold: 4321, cap: 6000 },
  { name: "TEDx Bratislava", sold: 1842, cap: 2000 },
  { name: "Stand-up Night vol. 12", sold: 612, cap: 850 },
];

const stats = [
  { label: "Dnešné tržby", value: "€ 47 820", change: "+12,4 %", icon: TrendingUp, tone: "primary" },
  { label: "Predané vstupenky", value: "1 487", change: "+8,1 %", icon: Ticket, tone: "accent" },
  { label: "Aktívne podujatia", value: "246", change: "+5", icon: CalendarDays, tone: "success" },
  { label: "Organizátori", value: "182", change: "+3", icon: Users, tone: "muted" },
  { label: "Čakajúce refundácie", value: "23", change: "−4", icon: RotateCcw, tone: "destructive" },
];

const toneClass: Record<string, string> = {
  primary: "from-primary/20 to-primary/0 text-primary",
  accent: "from-accent/20 to-accent/0 text-accent",
  success: "from-emerald-500/20 to-emerald-500/0 text-emerald-400",
  muted: "from-muted-foreground/15 to-muted-foreground/0 text-foreground",
  destructive: "from-destructive/20 to-destructive/0 text-destructive",
};

const orders = [
  { id: "MX-10421", event: "Pohoda 2026", buyer: "j.novak@gmail.com", qty: 4, total: "€ 396,00", status: "Zaplatené" },
  { id: "MX-10420", event: "Hokej Slovan", buyer: "lucia.varga@me.com", qty: 2, total: "€ 78,00", status: "Zaplatené" },
  { id: "MX-10419", event: "TEDx BA", buyer: "peter@firma.sk", qty: 1, total: "€ 120,00", status: "Čaká" },
  { id: "MX-10418", event: "Stand-up Night", buyer: "anna.k@yahoo.com", qty: 3, total: "€ 45,00", status: "Refundované" },
  { id: "MX-10417", event: "Symphonic Cinema", buyer: "m.kovac@gmail.com", qty: 2, total: "€ 64,00", status: "Zaplatené" },
];

const statusTone: Record<string, string> = {
  Zaplatené: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Čaká: "bg-accent/15 text-accent border-accent/30",
  Refundované: "bg-destructive/15 text-destructive border-destructive/30",
};

const alerts = [
  { icon: AlertTriangle, tone: "destructive", text: "Zariadenie SCAN-04 hlási offline viac ako 15 min." },
  { icon: Bell, tone: "accent", text: "Organizátor MeloFest blízko limitu predaja (97 %)." },
  { icon: CheckCircle2, tone: "success", text: "Spárované 98 bankových transakcií (€ 142 380)." },
  { icon: Activity, tone: "primary", text: "Nový rekord: 1 690 vstupeniek za sobotu." },
];

const alertTone: Record<string, string> = {
  destructive: "text-destructive bg-destructive/10",
  accent: "text-accent bg-accent/10",
  success: "text-emerald-400 bg-emerald-500/10",
  primary: "text-primary bg-primary/10",
};

function AdminDashboard() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary">
            <Flame className="h-3 w-3" /> Live · piatok 29. máj 2026
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Dobré ráno, Martin
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu je prehľad platformy MAXITICKET v reálnom čase.
          </p>
        </div>
        <Button asChild className="bg-gradient-flame text-primary-foreground hover:opacity-90">
          <Link to="/admin/events/events">
            Nové podujatie <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="relative overflow-hidden border-border/50 bg-card">
            <div className={`absolute inset-0 bg-gradient-to-br ${toneClass[s.tone].split(" ").slice(0, 2).join(" ")} opacity-40`} />
            <CardContent className="relative p-5">
              <div className="flex items-start justify-between">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-background/60 ${toneClass[s.tone].split(" ").slice(2).join(" ")}`}>
                  <s.icon className="h-4 w-4" />
                </div>
                <Badge variant="outline" className="text-[10px] font-semibold">
                  {s.change}
                </Badge>
              </div>
              <div className="mt-4 font-display text-2xl font-bold tracking-tight">{s.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Sales chart */}
        <Card className="border-border/50 bg-card xl:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between pb-2">
            <div>
              <CardTitle className="font-display text-lg">Predaje za posledných 7 dní</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Tržby (€) a počet predaných vstupeniek</p>
            </div>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              <TrendingUp className="mr-1 h-3 w-3" /> +18,4 %
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={salesData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
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
                    contentStyle={{
                      background: "oklch(0.17 0.025 270)",
                      border: "1px solid oklch(1 0 0 / 0.1)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "oklch(0.98 0.005 100)" }}
                    formatter={(v: number, k: string) => [
                      k === "revenue" ? `€ ${v.toLocaleString("sk-SK")}` : v.toLocaleString("sk-SK"),
                      k === "revenue" ? "Tržby" : "Vstupenky",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="oklch(0.69 0.21 38)"
                    strokeWidth={2.5}
                    fill="url(#rev)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card className="border-border/50 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-lg">Upozornenia systému</CardTitle>
            <p className="text-xs text-muted-foreground">Posledných 24 hodín</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts.map((a, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-border/40 bg-muted/20 p-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${alertTone[a.tone]}`}>
                  <a.icon className="h-4 w-4" />
                </div>
                <div className="text-sm leading-snug">{a.text}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top events */}
        <Card className="border-border/50 bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-display text-lg">Najpredávanejšie podujatia</CardTitle>
            <Link to="/admin/events/events" className="inline-flex items-center text-xs font-medium text-primary hover:underline">
              Všetky <ArrowUpRight className="ml-1 h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topEvents} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" horizontal={false} />
                  <XAxis type="number" stroke="oklch(0.68 0.02 270)" fontSize={11} />
                  <YAxis type="category" dataKey="name" stroke="oklch(0.68 0.02 270)" fontSize={11} width={140} />
                  <Tooltip
                    contentStyle={{
                      background: "oklch(0.17 0.025 270)",
                      border: "1px solid oklch(1 0 0 / 0.1)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [v.toLocaleString("sk-SK"), "Predaných"]}
                  />
                  <Bar dataKey="sold" fill="oklch(0.83 0.17 82)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Recent orders */}
        <Card className="border-border/50 bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-display text-lg">Posledné objednávky</CardTitle>
            <Link to="/admin/sales/sales" className="inline-flex items-center text-xs font-medium text-primary hover:underline">
              Všetky <ArrowUpRight className="ml-1 h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border/30">
              {orders.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{o.id}</span>
                      <Badge variant="outline" className={`${statusTone[o.status]} text-[10px]`}>
                        {o.status}
                      </Badge>
                    </div>
                    <div className="mt-0.5 truncate text-sm font-medium">{o.event}</div>
                    <div className="truncate text-xs text-muted-foreground">{o.buyer}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display text-sm font-bold">{o.total}</div>
                    <div className="text-xs text-muted-foreground">{o.qty} ks</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
