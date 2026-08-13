import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listOrganizerTickets } from "@/lib/organizer-tickets.functions";
import { listOrganizerAccounts } from "@/lib/settlements.functions";
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
import { Loader2, Ticket, Download, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/admin/maxiticket/tickets")({
  head: () => ({ meta: [{ title: "Vstupenky organizátorov · vipky.sk Admin" }] }),
  component: Page,
});

const fmtEur = (n: number) =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function Page() {
  const fetchTickets = useServerFn(listOrganizerTickets);
  const fetchOrganizers = useServerFn(listOrganizerAccounts);

  const [organizer, setOrganizer] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const q = useQuery({
    queryKey: ["organizer-tickets", organizer, from, to],
    queryFn: () =>
      fetchTickets({
        data: {
          organizer_id: organizer === "all" ? null : organizer,
          from: from || null,
          to: to || null,
        },
      }),
  });
  const organizers = useQuery({
    queryKey: ["organizer-accounts"],
    queryFn: () => fetchOrganizers({ data: undefined as never }),
  });

  const rows = q.data?.rows ?? [];
  const t = q.data?.totals;
  // Koľko vydaných vstupeniek naozaj prešlo dverami. Pri budúcom podujatí je
  // prirodzene nízka — je to prehľad, nie hodnotenie.
  const attendance = t && t.issued > 0 ? (t.scanned / t.issued) * 100 : null;

  const exportCsv = () => {
    const head = [
      "Organizátor",
      "Podujatie",
      "Termín",
      "Mesto",
      "Vydané",
      "Z toho web",
      "Z toho pokladňa",
      "Refundované",
      "Naskenované",
      "Tržba",
    ];
    const lines = rows.map((r) =>
      [
        r.organizer_name,
        r.event_title,
        r.event_date,
        r.city,
        r.issued,
        r.channel_web,
        r.channel_pos,
        r.refunded,
        r.scanned,
        r.gross.toFixed(2),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(";"),
    );
    const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vstupenky-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Vstupenky organizátorov
          </h1>
          <p className="text-muted-foreground mt-1">
            Koľko sa za koho vydalo vstupeniek, koľko ich prešlo dverami a koľko sa vrátilo.
            Vstupenka vzniká až po zaplatení, takže rozpracovaný nákup sa sem nedostane.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="size-4 mr-1.5" /> Export CSV
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Vydané vstupenky" value={String(t?.issued ?? 0)} />
        <Tile
          label="Naskenované"
          value={String(t?.scanned ?? 0)}
          hint={attendance !== null ? `${attendance.toFixed(0)} % z vydaných` : undefined}
        />
        <Tile label="Refundované" value={String(t?.refunded ?? 0)} />
        <Tile label="Tržba" value={fmtEur(t?.gross ?? 0)} accent />
      </div>

      <Card className="p-4 bg-card/60 border-border/50">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_repeat(2,minmax(0,180px))_auto] md:items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Organizátor</Label>
            <Select value={organizer} onValueChange={setOrganizer}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Všetci organizátori</SelectItem>
                {(organizers.data ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.company_name || o.full_name || o.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Termín od</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Termín do</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setOrganizer("all");
              setFrom("");
              setTo("");
            }}
          >
            <RotateCcw className="size-4 mr-1.5" /> Zrušiť filtre
          </Button>
        </div>
      </Card>

      <Card className="bg-card/60 border-border/50 overflow-x-auto">
        {q.isLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <Ticket className="mx-auto size-6 text-muted-foreground mb-2" />
            <div className="font-semibold">Žiadne podujatia</div>
            <p className="text-sm text-muted-foreground mt-1">Za zvolený filter sa nič nenašlo.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left p-3">Podujatie</th>
                <th className="text-left p-3">Organizátor</th>
                <th className="text-right p-3">Vydané</th>
                <th className="text-left p-3">Kanál</th>
                <th className="text-right p-3">Naskenované</th>
                <th className="text-right p-3">Refundované</th>
                <th className="text-right p-3">Tržba</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.event_id} className="border-b border-border/20 hover:bg-muted/10">
                  <td className="p-3 max-w-[260px]">
                    <Link
                      to="/events/$id"
                      params={{ id: r.event_id }}
                      target="_blank"
                      className="hover:underline"
                    >
                      {r.event_title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {r.event_date} · {r.city}
                    </div>
                  </td>
                  <td className="p-3 text-muted-foreground">{r.organizer_name}</td>
                  <td className="p-3 text-right tabular-nums font-semibold">{r.issued}</td>
                  <td className="p-3 whitespace-nowrap">
                    {r.issued === 0 ? (
                      <span className="text-muted-foreground text-xs">—</span>
                    ) : (
                      <div className="flex gap-1">
                        {r.channel_web > 0 && (
                          <Badge variant="outline" className="text-[10px]">
                            web {r.channel_web}
                          </Badge>
                        )}
                        {r.channel_pos > 0 && (
                          <Badge variant="outline" className="text-[10px]">
                            pokladňa {r.channel_pos}
                          </Badge>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {r.scanned}
                    {r.issued > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        ({Math.round((r.scanned / r.issued) * 100)} %)
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">
                    {r.refunded || "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums font-semibold whitespace-nowrap">
                    {fmtEur(r.gross)}
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
