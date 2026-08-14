import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileDown, Loader2 } from "lucide-react";
import { listBankAccounts, bankReport } from "@/lib/bank.functions";

export const Route = createFileRoute("/admin/maxiticket/accounting-report")({
  head: () => ({ meta: [{ title: "Účtovanie · report · vipky.sk Admin" }] }),
  component: Page,
});

const eur = (n: number) =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const MONTHS = [
  "január",
  "február",
  "marec",
  "apríl",
  "máj",
  "jún",
  "júl",
  "august",
  "september",
  "október",
  "november",
  "december",
];

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  const idx = Number(m) - 1;
  return MONTHS[idx] ? `${MONTHS[idx]} ${y}` : ym;
}

function Page() {
  const fetchAccounts = useServerFn(listBankAccounts);
  const fetchReport = useServerFn(bankReport);
  const [accountFilter, setAccountFilter] = useState<string>("all");

  const accounts = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => fetchAccounts({ data: undefined as never }),
  });

  const report = useQuery({
    queryKey: ["bank-report", accountFilter],
    queryFn: () =>
      fetchReport({ data: { account_id: accountFilter === "all" ? undefined : accountFilter } }),
  });

  const rows = report.data ?? [];
  const totals = rows.reduce(
    (acc, r) => ({
      incoming: acc.incoming + r.incoming,
      outgoing: acc.outgoing + r.outgoing,
      matched: acc.matched + r.matched,
      unmatched: acc.unmatched + r.unmatched,
    }),
    { incoming: 0, outgoing: 0, matched: 0, unmatched: 0 },
  );

  const exportCsv = () => {
    const head = ["Mesiac", "Príjmy", "Výdavky", "Spárované", "Nespárované", "Pohybov"];
    const csv = [
      head,
      ...rows.map((r) => [
        r.month,
        r.incoming.toFixed(2),
        r.outgoing.toFixed(2),
        r.matched,
        r.unmatched,
        r.count,
      ]),
    ]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "ucotvny-report.csv";
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Účtovanie · report</h1>
          <p className="text-muted-foreground mt-1">
            Mesačný prehľad bankových pohybov z{" "}
            <Link to="/admin/maxiticket/accounting-bank" className="text-primary hover:underline">
              výpisov
            </Link>
            .
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="w-60">
              <SelectValue placeholder="Všetky účty" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Všetky účty</SelectItem>
              {(accounts.data ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.bank_name} · {a.iban.slice(-6)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <FileDown className="size-4 mr-2" /> CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Príjmy" value={eur(totals.incoming)} />
        <Stat label="Výdavky" value={eur(totals.outgoing)} />
        <Stat label="Spárované pohyby" value={String(totals.matched)} />
        <Stat label="Nespárované" value={String(totals.unmatched)} warn={totals.unmatched > 0} />
      </div>

      <Card className="bg-card/60 border-border/50 overflow-x-auto">
        {report.isLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            Žiadne pohyby. Report sa naplní, keď pribudnú výpisy z banky.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Mesiac</th>
                <th className="px-4 py-3 font-medium text-right">Príjmy</th>
                <th className="px-4 py-3 font-medium text-right">Výdavky</th>
                <th className="px-4 py-3 font-medium text-right">Rozdiel</th>
                <th className="px-4 py-3 font-medium text-right">Spárované</th>
                <th className="px-4 py-3 font-medium text-right">Nespárované</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className="border-b border-border/30 last:border-0">
                  <td className="px-4 py-3 font-medium">{monthLabel(r.month)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{eur(r.incoming)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {eur(r.outgoing)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {eur(r.incoming - r.outgoing)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.matched}</td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      r.unmatched > 0 ? "text-amber-600 dark:text-amber-400" : ""
                    }`}
                  >
                    {r.unmatched}
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

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <Card className={`p-4 bg-card/60 ${warn ? "border-amber-500/40" : "border-border/50"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-bold mt-0.5">{value}</div>
    </Card>
  );
}
