import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  getCampaigns,
  getGoogleAccounts,
  getMetaAccounts,
  MARKETING_EVENT,
  type Campaign,
} from "@/lib/marketing-db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Euro, TrendingUp, Users, ChromeIcon, Facebook } from "lucide-react";

export const Route = createFileRoute("/admin/marketing")({
  head: () => ({ meta: [{ title: "Marketing · Admin" }] }),
  component: AdminMarketing,
});

function AdminMarketing() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener(MARKETING_EVENT, h);
    return () => window.removeEventListener(MARKETING_EVENT, h);
  }, []);
  const campaigns = getCampaigns();
  const google = getGoogleAccounts();
  const meta = getMetaAccounts();

  const totals = useMemo(
    () =>
      campaigns.reduce(
        (a, c) => ({
          spend: a.spend + c.metrics.spend_eur,
          revenue: a.revenue + c.metrics.revenue_eur,
          tickets: a.tickets + c.metrics.tickets_sold,
        }),
        { spend: 0, revenue: 0, tickets: 0 },
      ),
    [campaigns, tick],
  );
  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;

  return (
    <div className="p-6 space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <Megaphone className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-display font-bold">Marketing platformy</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Prehľad reklamných účtov a kampaní všetkých organizátorov.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI icon={Euro} label="Celkový spend" value={`€${totals.spend.toFixed(2)}`} />
        <KPI icon={TrendingUp} label="ROAS platformy" value={`${roas.toFixed(2)}×`} />
        <KPI icon={Users} label="Predané vstupenky" value={totals.tickets.toString()} />
        <KPI icon={Megaphone} label="Kampane" value={campaigns.length.toString()} />
      </div>

      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <ChromeIcon className="h-4 w-4" /> Google Ads účty ({google.length})
        </h3>
        <div className="space-y-2">
          {google.length === 0 ? (
            <Empty />
          ) : (
            google.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded border bg-muted/30 p-3 text-sm"
              >
                <div>
                  <div className="font-mono">{g.customer_id}</div>
                  <div className="text-xs text-muted-foreground">
                    {g.account_name} · org {g.organizer_id.slice(0, 8)}
                  </div>
                </div>
                <Badge className="bg-emerald-500/15 text-emerald-600">● {g.status}</Badge>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Facebook className="h-4 w-4" /> Meta Ads účty ({meta.length})
        </h3>
        <div className="space-y-2">
          {meta.length === 0 ? (
            <Empty />
          ) : (
            meta.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded border bg-muted/30 p-3 text-sm"
              >
                <div>
                  <div className="font-mono">{m.ad_account_id}</div>
                  <div className="text-xs text-muted-foreground">
                    Pixel {m.pixel_id} · org {m.organizer_id.slice(0, 8)}
                  </div>
                </div>
                <Badge className="bg-emerald-500/15 text-emerald-600">● {m.status}</Badge>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-3">Všetky kampane</h3>
        {campaigns.length === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr className="text-left">
                  <th className="py-2 pr-3">Kampaň</th>
                  <th className="py-2 pr-3">Organizátor</th>
                  <th className="py-2 pr-3">Platforma</th>
                  <th className="py-2 pr-3">Stav</th>
                  <th className="py-2 pr-3 text-right">Spend</th>
                  <th className="py-2 pr-3 text-right">Tržby</th>
                  <th className="py-2 pr-3 text-right">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c: Campaign) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{c.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {c.organizer_name ?? c.organizer_id.slice(0, 8)}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline">{c.platform}</Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge>{c.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">
                      €{c.metrics.spend_eur.toFixed(2)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">
                      €{c.metrics.revenue_eur.toFixed(2)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{c.metrics.roas.toFixed(2)}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function KPI({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-display font-bold">{value}</div>
    </Card>
  );
}

const Empty = () => (
  <div className="py-6 text-center text-sm text-muted-foreground">Zatiaľ žiadne dáta.</div>
);
