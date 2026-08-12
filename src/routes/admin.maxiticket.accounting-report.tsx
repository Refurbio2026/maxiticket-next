import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { listAccounts, listTransactions } from "@/lib/bank-db";

export const Route = createFileRoute("/admin/maxiticket/accounting-report")({
  head: () => ({ meta: [{ title: "Účtovanie · report · vipky.sk" }] }),
  component: Page,
});

const COLORS = ["hsl(var(--primary))", "hsl(var(--destructive))", "hsl(var(--muted-foreground))"];

function Page() {
  const [tick] = useState(0);
  const accounts = useMemo(() => listAccounts(), [tick]);
  const txs = useMemo(() => listTransactions(), [tick]);

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
  const today = new Date().toDateString();
  const todayIncome = txs
    .filter((t) => new Date(t.date).toDateString() === today)
    .reduce((s, t) => s + t.amount, 0);
  const monthIncome = txs
    .filter((t) => new Date(t.date).getMonth() === new Date().getMonth())
    .reduce((s, t) => s + t.amount, 0);
  const unmatched = txs.filter((t) => t.matchStatus === "unmatched");

  // by day
  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    txs.forEach((t) => {
      const d = new Date(t.date).toLocaleDateString("sk-SK");
      map.set(d, (map.get(d) ?? 0) + t.amount);
    });
    return Array.from(map.entries())
      .map(([day, amount]) => ({ day, amount: +amount.toFixed(2) }))
      .slice(-14)
      .reverse();
  }, [txs]);

  // by organizer
  const byOrganizer = useMemo(() => {
    const map = new Map<string, number>();
    txs.forEach((t) => {
      const k = t.organizerId ?? "neznámy";
      map.set(k, (map.get(k) ?? 0) + t.amount);
    });
    return Array.from(map.entries()).map(([organizer, amount]) => ({
      organizer,
      amount: +amount.toFixed(2),
    }));
  }, [txs]);

  // by month
  const byMonth = useMemo(() => {
    const map = new Map<string, number>();
    txs.forEach((t) => {
      const d = new Date(t.date);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(k, (map.get(k) ?? 0) + t.amount);
    });
    return Array.from(map.entries())
      .sort()
      .map(([month, amount]) => ({
        month,
        amount: +amount.toFixed(2),
      }));
  }, [txs]);

  const matchPie = useMemo(() => {
    const m = txs.filter((t) => t.matchStatus === "matched").length;
    const u = txs.filter((t) => t.matchStatus === "unmatched").length;
    const p = txs.filter((t) => t.matchStatus === "pending").length;
    return [
      { name: "Spárované", value: m },
      { name: "Nespárované", value: u },
      { name: "Čaká", value: p },
    ];
  }, [txs]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Účtovanie · report</h1>
        <p className="text-sm text-muted-foreground">
          Bankové reporty a analytika prijatých platieb.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Stav účtov</p>
            <p className="text-xl font-semibold">
              {totalBalance.toLocaleString("sk-SK", { style: "currency", currency: "EUR" })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Dnešné príjmy</p>
            <p className="text-xl font-semibold">
              {todayIncome.toLocaleString("sk-SK", { style: "currency", currency: "EUR" })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Príjmy za mesiac</p>
            <p className="text-xl font-semibold">
              {monthIncome.toLocaleString("sk-SK", { style: "currency", currency: "EUR" })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Nespárované</p>
            <p className="text-xl font-semibold text-destructive">{unmatched.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Transakcie</p>
            <p className="text-xl font-semibold">{txs.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prijaté platby podľa dní</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <BarChart data={byDay}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="amount" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bankové príjmy podľa mesiaca</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <LineChart data={byMonth}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="amount"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Platby podľa organizátora</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <BarChart data={byOrganizer} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="organizer" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Bar dataKey="amount" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stav párovania</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={matchPie} dataKey="value" nameKey="name" outerRadius={90} label>
                  {matchPie.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
