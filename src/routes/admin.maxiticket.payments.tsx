import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listOrganizerPayouts, type OrganizerPayout } from "@/lib/organizer-finance.functions";
import { setSettlementStatus } from "@/lib/settlements.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CreditCard, Download, AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/maxiticket/payments")({
  head: () => ({ meta: [{ title: "Platby organizátorom · vipky.sk Admin" }] }),
  component: Page,
});

const STATES = [
  { value: "all", label: "Na úhradu aj uhradené" },
  { value: "due", label: "Len na úhradu" },
  { value: "paid", label: "Len uhradené" },
];

const fmtEur = (n: number) =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function Page() {
  const qc = useQueryClient();
  const fetchPayouts = useServerFn(listOrganizerPayouts);
  const setStatus = useServerFn(setSettlementStatus);

  const [state, setState] = useState("all");
  const [payFor, setPayFor] = useState<OrganizerPayout | null>(null);
  const [reference, setReference] = useState("");

  const q = useQuery({
    queryKey: ["organizer-payouts", state],
    queryFn: () => fetchPayouts({ data: { state: state as "all" | "due" | "paid" } }),
  });

  const markPaid = useMutation({
    mutationFn: () =>
      setStatus({
        data: {
          id: payFor!.settlement_id,
          status: "paid",
          payout_reference: reference.trim() || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organizer-payouts"] });
      qc.invalidateQueries({ queryKey: ["settlements"] });
      qc.invalidateQueries({ queryKey: ["organizer-balances"] });
      toast.success("Označené ako uhradené");
      setPayFor(null);
      setReference("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmena zlyhala"),
  });

  const rows = q.data?.rows ?? [];

  // Podklad pre banku — účtovníčka nemá dôvod prepisovať IBAN-y ručne.
  const exportCsv = () => {
    const due = rows.filter((r) => r.status === "approved");
    const head = ["Organizátor", "IBAN", "Suma", "Mena", "Obdobie od", "Obdobie do", "Poznámka"];
    const lines = due.map((r) =>
      [
        r.organizer_name,
        r.payout_iban ?? "",
        r.amount.toFixed(2),
        "EUR",
        r.period_from,
        r.period_to,
        r.note ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(";"),
    );
    const blob = new Blob(["﻿" + [head.join(";"), ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vyplaty-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Platby organizátorom</h1>
          <p className="text-muted-foreground mt-1">
            Schválené{" "}
            <Link to="/admin/maxiticket/protocols" className="text-primary hover:underline">
              vyúčtovacie protokoly
            </Link>{" "}
            čakajúce na prevod a história vyplatených. Návrh protokolu sem nepatrí — najprv ho treba
            schváliť.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={(q.data?.due_count ?? 0) === 0}>
          <Download className="size-4 mr-1.5" /> Podklad pre banku
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Na úhradu" value={fmtEur(q.data?.due_amount ?? 0)} accent />
        <Tile label="Počet výplat" value={String(q.data?.due_count ?? 0)} />
        <Tile label="Už uhradené" value={fmtEur(q.data?.paid_amount ?? 0)} />
        <Tile
          label="Bez IBAN-u"
          value={String(q.data?.missing_iban ?? 0)}
          warn={(q.data?.missing_iban ?? 0) > 0}
        />
      </div>

      {(q.data?.missing_iban ?? 0) > 0 && (
        <Card className="p-4 bg-amber-500/10 border-amber-500/40 flex items-start gap-3">
          <AlertTriangle className="size-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold">Chýba výplatný účet</div>
            <p className="text-muted-foreground">
              {q.data!.missing_iban} schválených výplat nemá IBAN. Doplň ho v{" "}
              <Link to="/admin/maxiticket/organizers" className="text-primary hover:underline">
                Organizátoroch
              </Link>
              , inak sa prevod nedá odoslať.
            </p>
          </div>
        </Card>
      )}

      <div className="max-w-xs">
        <Label className="text-xs">Stav</Label>
        <Select value={state} onValueChange={setState}>
          <SelectTrigger className="mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="bg-card/60 border-border/50 overflow-x-auto">
        {q.isLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <CreditCard className="mx-auto size-6 text-muted-foreground mb-2" />
            <div className="font-semibold">Žiadne výplaty</div>
            <p className="text-sm text-muted-foreground mt-1">
              Vyúčtovací protokol sa sem dostane po schválení.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left p-3">Organizátor</th>
                <th className="text-left p-3">Obdobie</th>
                <th className="text-left p-3">IBAN</th>
                <th className="text-right p-3">Suma</th>
                <th className="text-left p-3">Stav</th>
                <th className="text-left p-3">Referencia</th>
                <th className="text-right p-3">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.settlement_id}
                  className="border-b border-border/20 hover:bg-muted/10 align-top"
                >
                  <td className="p-3 font-medium">{r.organizer_name}</td>
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                    {r.period_from} – {r.period_to}
                  </td>
                  <td className="p-3 font-mono text-xs">
                    {r.payout_iban ?? <span className="text-amber-500">chýba</span>}
                  </td>
                  <td className="p-3 text-right font-semibold tabular-nums whitespace-nowrap">
                    {fmtEur(r.amount)}
                  </td>
                  <td className="p-3">
                    {r.status === "paid" ? (
                      <Badge className="bg-emerald-500/15 text-emerald-500 text-[10px] gap-1">
                        <Check className="size-2.5" /> uhradené
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px]">
                        na úhradu
                      </Badge>
                    )}
                    {r.paid_at && (
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {new Date(r.paid_at).toLocaleDateString("sk-SK")}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground max-w-[180px] truncate">
                    {r.payout_reference || "—"}
                  </td>
                  <td className="p-3 text-right">
                    {r.status === "approved" && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setPayFor(r);
                          setReference("");
                        }}
                        className="bg-gradient-flame text-primary-foreground shadow-glow"
                      >
                        Označiť ako uhradené
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog open={!!payFor} onOpenChange={(o) => !o && setPayFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Označiť výplatu ako uhradenú</DialogTitle>
            <DialogDescription>
              {payFor &&
                `${payFor.organizer_name} · ${fmtEur(payFor.amount)} · ${payFor.period_from} – ${payFor.period_to}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="payout-ref">Referencia platby</Label>
            <Input
              id="payout-ref"
              maxLength={200}
              placeholder="variabilný symbol, číslo prevodu…"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Podľa nej sa platba spätne dohľadá vo výpise z banky.
            </p>
            {payFor && !payFor.payout_iban && (
              <p className="text-xs text-amber-500">
                Organizátor nemá vyplnený IBAN — over, kam peniaze skutočne odišli.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayFor(null)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => markPaid.mutate()}
              disabled={markPaid.isPending}
              className="bg-gradient-flame text-primary-foreground shadow-glow"
            >
              {markPaid.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Potvrdiť úhradu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <Card
      className={`p-5 bg-card/60 ${
        warn ? "border-amber-500/50" : accent ? "border-primary/40" : "border-border/50"
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-bold mt-1 tabular-nums">{value}</div>
    </Card>
  );
}
