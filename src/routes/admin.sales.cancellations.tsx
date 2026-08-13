import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listCancellations, type CancellationRow } from "@/lib/cancellations.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Loader2, Ban, Search, RotateCcw, Download } from "lucide-react";

export const Route = createFileRoute("/admin/sales/cancellations")({
  head: () => ({ meta: [{ title: "Storno · vipky.sk Admin" }] }),
  component: Page,
});

const CHANNELS = [
  { value: "all", label: "Web aj pokladňa" },
  { value: "web", label: "Len web" },
  { value: "pos", label: "Len pokladňa" },
];

function fmtEur(n: number, currency = "EUR") {
  return `${n.toFixed(2)} ${currency}`;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("sk-SK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Page() {
  const fetchCancellations = useServerFn(listCancellations);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [channel, setChannel] = useState("all");
  const [search, setSearch] = useState("");
  // Hľadanie sa neposiela pri každom písmene — až po potvrdení alebo opustení poľa.
  const [appliedSearch, setAppliedSearch] = useState("");

  const q = useQuery({
    queryKey: ["cancellations", from, to, channel, appliedSearch],
    queryFn: () =>
      fetchCancellations({
        data: {
          from: from || null,
          to: to || null,
          channel: channel as "all" | "web" | "pos",
          search: appliedSearch || null,
        },
      }),
  });

  const rows = q.data?.rows ?? [];
  const summary = q.data?.summary;
  // Podiel vrátených peňazí na tržbe za rovnaké obdobie — samotná suma je bez mierky.
  const share =
    summary && summary.paid_amount > 0
      ? (summary.refunded_amount / summary.paid_amount) * 100
      : null;

  const resetFilters = () => {
    setFrom("");
    setTo("");
    setChannel("all");
    setSearch("");
    setAppliedSearch("");
  };

  const exportCsv = () => {
    const head = [
      "Dátum storna",
      "Objednávka",
      "Doklad",
      "Kanál",
      "Typ",
      "Podujatie",
      "Termín",
      "Zákazník",
      "E-mail",
      "Vstupeniek",
      "Suma objednávky",
      "Vrátené",
      "Mena",
      "Dôvod",
      "Spracoval",
    ];
    const lines = rows.map((r) =>
      [
        r.refunded_at ?? "",
        r.order_id,
        r.receipt_number ?? "",
        r.channel === "pos" ? "pokladňa" : "web",
        r.full ? "plné storno" : "čiastočný refund",
        r.event_title ?? "",
        r.event_date ?? "",
        r.customer_name ?? "",
        r.customer_email ?? "",
        String(r.tickets_count),
        r.total_amount.toFixed(2),
        r.refunded_amount.toFixed(2),
        r.currency,
        r.reason ?? "",
        r.refunded_by_name ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(";"),
    );
    // Bodkočiarka a BOM — inak to slovenský Excel otvorí ako jeden stĺpec
    // a rozsype diakritiku.
    const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `storno-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Storno</h1>
          <p className="text-muted-foreground mt-1">
            Stornované objednávky a refundácie z webu aj z pokladne. Refund sa spúšťa v Predajoch,
            storno pokladničného dokladu v pokladni.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="size-4 mr-1.5" /> Export CSV
        </Button>
      </div>

      <Card className="p-4 bg-card/60 border-border/50">
        <div className="grid gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))_auto] md:items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Od</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Do</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Kanál</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Hľadať</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="zákazník, podujatie, dôvod…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setAppliedSearch(search)}
                onBlur={() => setAppliedSearch(search)}
              />
            </div>
          </div>
          <Button variant="ghost" onClick={resetFilters}>
            <RotateCcw className="size-4 mr-1.5" /> Zrušiť filtre
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Storien a refundov" value={String(summary?.count ?? 0)} />
        <Tile
          label="Vrátené spolu"
          value={fmtEur(summary?.refunded_amount ?? 0)}
          hint={share !== null ? `${share.toFixed(1)} % z tržby za obdobie` : undefined}
        />
        <Tile label="Plné storná" value={String(summary?.full_count ?? 0)} />
        <Tile label="Čiastočné refundy" value={String(summary?.partial_count ?? 0)} />
      </div>

      {(summary?.by_reason.length ?? 0) > 0 && (
        <Card className="p-5 bg-card/60 border-border/50">
          <h2 className="font-display font-semibold mb-3">Podľa dôvodu</h2>
          <div className="space-y-2">
            {summary!.by_reason.map((r) => (
              <div key={r.reason} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{r.reason}</span>
                <span className="text-muted-foreground whitespace-nowrap tabular-nums">
                  {r.count}× · {fmtEur(r.amount)}
                </span>
              </div>
            ))}
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
            <Ban className="mx-auto size-6 text-muted-foreground mb-2" />
            <div className="font-semibold">Žiadne storná</div>
            <p className="text-sm text-muted-foreground mt-1">
              Za zvolené obdobie sa nič nevracalo.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left p-3">Dátum storna</th>
                <th className="text-left p-3">Objednávka</th>
                <th className="text-left p-3">Podujatie</th>
                <th className="text-left p-3">Zákazník</th>
                <th className="text-left p-3">Dôvod</th>
                <th className="text-left p-3">Spracoval</th>
                <th className="text-right p-3">Vrátené</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.order_id} row={r} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Row({ row: r }: { row: CancellationRow }) {
  return (
    <tr className="border-b border-border/20 hover:bg-muted/10 align-top">
      <td className="p-3 whitespace-nowrap text-xs">{fmtDateTime(r.refunded_at)}</td>
      <td className="p-3">
        <div className="font-mono text-xs">#{r.order_id.slice(0, 8).toUpperCase()}</div>
        <div className="flex gap-1 mt-1">
          <Badge variant="outline" className="text-[10px]">
            {r.channel === "pos" ? "pokladňa" : "web"}
          </Badge>
          <Badge
            className={`text-[10px] ${
              r.full
                ? "bg-destructive/15 text-destructive"
                : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            }`}
          >
            {r.full ? "plné storno" : "čiastočný"}
          </Badge>
        </div>
        {r.receipt_number && (
          <div className="text-[11px] text-muted-foreground mt-1">{r.receipt_number}</div>
        )}
      </td>
      <td className="p-3 max-w-[220px]">
        <div className="truncate">{r.event_title ?? "—"}</div>
        <div className="text-xs text-muted-foreground">
          {r.event_date ?? "—"} · {r.tickets_count} ks
        </div>
      </td>
      <td className="p-3 max-w-[200px]">
        <div className="truncate">{r.customer_name || "—"}</div>
        <div className="text-xs text-muted-foreground truncate">{r.customer_email || "—"}</div>
      </td>
      <td className="p-3 max-w-[240px] text-muted-foreground">
        <span className="line-clamp-2">{r.reason || "—"}</span>
      </td>
      <td className="p-3 text-muted-foreground whitespace-nowrap">{r.refunded_by_name || "—"}</td>
      <td className="p-3 text-right whitespace-nowrap">
        <div className="font-semibold tabular-nums">{fmtEur(r.refunded_amount, r.currency)}</div>
        {!r.full && (
          <div className="text-xs text-muted-foreground tabular-nums">
            z {fmtEur(r.total_amount, r.currency)}
          </div>
        )}
      </td>
    </tr>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5 bg-card/60 border-border/50">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-bold mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </Card>
  );
}
