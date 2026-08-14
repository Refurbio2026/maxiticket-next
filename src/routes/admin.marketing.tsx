import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Megaphone, Plug } from "lucide-react";
import { listCampaigns, listAdAccounts, type CampaignStatus } from "@/lib/marketing.functions";

export const Route = createFileRoute("/admin/marketing")({
  head: () => ({ meta: [{ title: "Reklamné kampane · vipky.sk Admin" }] }),
  component: Page,
});

const eur = (n: number) =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "koncept",
  active: "beží",
  paused: "pozastavená",
  ended: "ukončená",
};

function Page() {
  const fetchCampaigns = useServerFn(listCampaigns);
  const fetchAccounts = useServerFn(listAdAccounts);
  const [status, setStatus] = useState<CampaignStatus | "all">("all");

  const campaigns = useQuery({
    queryKey: ["campaigns", status],
    queryFn: () => fetchCampaigns({ data: { status } }),
  });
  const accounts = useQuery({
    queryKey: ["ad-accounts"],
    queryFn: () => fetchAccounts({ data: {} }),
  });

  const rows = campaigns.data ?? [];
  const accountRows = accounts.data ?? [];
  const spend = rows.reduce((s, c) => s + c.spend_eur, 0);
  const revenue = rows.reduce((s, c) => s + c.revenue_eur, 0);
  const budget = rows.reduce((s, c) => s + c.budget_eur, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Reklamné kampane</h1>
          <p className="text-muted-foreground mt-1">
            Kampane všetkých organizátorov. Napojenie na Google Ads a Meta je zatiaľ evidencia —
            čísla výkonu zadáva organizátor, API sa nevolá.
          </p>
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as CampaignStatus | "all")}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Všetky stavy</SelectItem>
            <SelectItem value="active">Bežiace</SelectItem>
            <SelectItem value="paused">Pozastavené</SelectItem>
            <SelectItem value="draft">Koncepty</SelectItem>
            <SelectItem value="ended">Ukončené</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Kampaní" value={String(rows.length)} />
        <Stat label="Rozpočet" value={eur(budget)} />
        <Stat label="Minuté" value={eur(spend)} />
        <Stat label="Tržby z kampaní" value={eur(revenue)} />
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3">
          <Plug className="size-3.5" /> Pripojené reklamné účty
        </div>
        {accounts.isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : accountRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Žiadny organizátor zatiaľ nepripojil reklamný účet.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {accountRows.map((a) => (
              <div
                key={a.id}
                className="rounded-lg border border-border/40 bg-muted/20 p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize">{a.platform}</span>
                  <Badge
                    variant={a.status === "connected" ? "default" : "outline"}
                    className="text-[10px]"
                  >
                    {a.status === "connected" ? "pripojený" : "odpojený"}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {a.account_name || a.account_id}
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">{a.account_id}</div>
                <div className="text-xs mt-1">Kredit {eur(a.credit_eur)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="bg-card/60 border-border/50 overflow-x-auto">
        {campaigns.isLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            Žiadne kampane v tomto výbere.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Kampaň</th>
                <th className="px-4 py-3 font-medium">Organizátor</th>
                <th className="px-4 py-3 font-medium">Podujatie</th>
                <th className="px-4 py-3 font-medium">Platforma</th>
                <th className="px-4 py-3 font-medium text-right">Rozpočet</th>
                <th className="px-4 py-3 font-medium text-right">Minuté</th>
                <th className="px-4 py-3 font-medium text-right">Konverzie</th>
                <th className="px-4 py-3 font-medium">Stav</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-border/30 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium">
                      <Megaphone className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate max-w-[240px]">{c.name}</span>
                    </div>
                    {c.auto_generated && (
                      <div className="text-[11px] text-muted-foreground">automaticky vytvorená</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {c.organizer_name || "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[200px]">
                    {c.event_title || "—"}
                  </td>
                  <td className="px-4 py-3 capitalize">{c.platform}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{eur(c.budget_eur)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {eur(c.spend_eur)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.conversions}</td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        c.status === "active"
                          ? "default"
                          : c.status === "ended"
                            ? "outline"
                            : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {STATUS_LABEL[c.status]}
                    </Badge>
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
