// Platby z brány.
//
// Odpovedá na otázku „prišli peniaze a za čo?" bez preklikávania objednávok.
// Refund sa dá spustiť priamo z riadku a stav sa dá kedykoľvek dopýtať
// u brány — po vrátení peňazí je to jediný spôsob, ako sa dozvedieť, že ho
// brána dodatočne zamietla.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { Loader2, RefreshCw, RotateCcw, Search } from "lucide-react";
import {
  listGatewayPayments,
  refreshPaymentState,
  type PlatbaRiadok,
} from "@/lib/gateway-payments.functions";
import { refundOrder } from "@/lib/refunds.functions";
import { listRefundReasons } from "@/lib/refund-reasons.functions";

export const Route = createFileRoute("/admin/sales/payments")({
  head: () => ({ meta: [{ title: "Platby · eticketo.eu Admin" }] }),
  component: Page,
});

const eur = (n: number, c = "EUR") =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

const STAVY: Record<string, { label: string; cls: string }> = {
  paid: { label: "Zaplatená", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  authorized: { label: "Autorizovaná", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  pending: { label: "Čaká", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  failed: { label: "Zlyhala", cls: "bg-destructive/15 text-destructive" },
  cancelled: { label: "Zrušená", cls: "bg-muted text-muted-foreground" },
  refunded: { label: "Vrátená", cls: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
};

function Page() {
  const qc = useQueryClient();
  const nacitaj = useServerFn(listGatewayPayments);
  const dopytaj = useServerFn(refreshPaymentState);
  const vrat = useServerFn(refundOrder);
  const nacitajDovody = useServerFn(listRefundReasons);

  const [stav, setStav] = useState("all");
  const [hladaj, setHladaj] = useState("");
  const [dopytuje, setDopytuje] = useState<string | null>(null);
  const [refundFor, setRefundFor] = useState<PlatbaRiadok | null>(null);
  const [suma, setSuma] = useState("");
  const [dovod, setDovod] = useState("");

  const platby = useQuery({
    queryKey: ["gateway-payments", stav, hladaj],
    queryFn: () => nacitaj({ data: { status: stav, hladaj: hladaj || null, limit: 200 } }),
  });

  const dovody = useQuery({
    queryKey: ["refund-reasons", "active"],
    queryFn: () => nacitajDovody({ data: { only_active: true } }),
  });

  const refundovanie = useMutation({
    mutationFn: (p: PlatbaRiadok) =>
      vrat({
        data: {
          order_id: p.order_id!,
          // Prázdna suma = celá objednávka; server si ju aj tak overí.
          amount: suma.trim() ? Number(suma.replace(",", ".")) : undefined,
          reason: dovod.trim() || null,
          notify_customer: true,
        },
      }),
    onSuccess: (r) => {
      setRefundFor(null);
      setSuma("");
      setDovod("");
      qc.invalidateQueries({ queryKey: ["gateway-payments"] });
      toast.success(
        r && typeof r === "object" && "manual_action" in r && r.manual_action
          ? String(r.manual_action)
          : "Peniaze vrátené",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Vrátenie zlyhalo"),
  });

  const riadky = platby.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Platby</h1>
        <p className="text-muted-foreground mt-1">
          Transakcie z platobnej brány. Stav sa dá kedykoľvek dopýtať priamo u nej a peniaze vrátiť
          bez hľadania objednávky.
        </p>
      </div>

      <Card className="p-4 bg-card/60 border-border/50 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Stav</Label>
          <Select value={stav} onValueChange={setStav}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Všetky</SelectItem>
              {Object.entries(STAVY).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 flex-1 min-w-[220px]">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Referencia platby
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="napr. GZTX-ITBB-YBVW"
              value={hladaj}
              onChange={(e) => setHladaj(e.target.value)}
            />
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => qc.invalidateQueries({ queryKey: ["gateway-payments"] })}
        >
          <RefreshCw className="size-4 mr-2" /> Obnoviť
        </Button>
      </Card>

      <Card className="bg-card/60 border-border/50 overflow-x-auto">
        {platby.isLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : riadky.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            Žiadne platby pre zvolený filter.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border/50">
              <tr>
                <th className="text-left p-3">Kedy</th>
                <th className="text-left p-3">Referencia</th>
                <th className="text-left p-3">Zákazník</th>
                <th className="text-left p-3">Podujatie</th>
                <th className="text-right p-3">Suma</th>
                <th className="text-left p-3">Stav</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {riadky.map((p) => {
                const s = STAVY[p.status] ?? { label: p.status, cls: "bg-muted" };
                return (
                  <tr key={p.id} className="border-b border-border/30 hover:bg-muted/30">
                    <td className="p-3 whitespace-nowrap text-muted-foreground">
                      {new Date(p.created_at).toLocaleString("sk-SK")}
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {p.provider_payment_id ?? "—"}
                      <div className="text-[10px] text-muted-foreground uppercase">
                        {p.provider}
                      </div>
                    </td>
                    <td className="p-3">
                      {p.customer_name ?? "—"}
                      <div className="text-xs text-muted-foreground">{p.customer_email}</div>
                    </td>
                    <td className="p-3 max-w-[220px] truncate">{p.event_title ?? "—"}</td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {eur(p.amount, p.currency)}
                      {!!p.order_refunded && p.order_refunded > 0 && (
                        <div className="text-xs text-violet-600 dark:text-violet-400">
                          vrátené {eur(p.order_refunded, p.currency)}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge className={`${s.cls} border-0`}>{s.label}</Badge>
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Dopýtať stav u brány"
                          disabled={dopytuje === p.id}
                          onClick={async () => {
                            setDopytuje(p.id);
                            try {
                              const r = await dopytaj({ data: { payment_id: p.id } });
                              if (r.ok) toast.success(r.sprava);
                              else toast.error(r.sprava);
                              qc.invalidateQueries({ queryKey: ["gateway-payments"] });
                            } finally {
                              setDopytuje(null);
                            }
                          }}
                        >
                          {dopytuje === p.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <RefreshCw className="size-4" />
                          )}
                        </Button>
                        {p.refundovatelna && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => {
                              setRefundFor(p);
                              setSuma("");
                              setDovod("");
                            }}
                          >
                            <RotateCcw className="size-4 mr-1" /> Vrátiť
                          </Button>
                        )}
                        {p.order_id && (
                          <Button variant="ghost" size="sm" asChild>
                            <Link to="/admin/sales/sales">Objednávka</Link>
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog open={!!refundFor} onOpenChange={(o) => !o && setRefundFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vrátiť peniaze</DialogTitle>
            <DialogDescription>
              {refundFor &&
                `${refundFor.customer_name ?? "Zákazník"} · ${eur(refundFor.order_total ?? refundFor.amount, refundFor.currency)} · ${refundFor.provider_payment_id ?? ""}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Suma (prázdne = celá objednávka)</Label>
              <Input
                inputMode="decimal"
                placeholder={refundFor ? String(refundFor.order_total ?? refundFor.amount) : ""}
                value={suma}
                onChange={(e) => setSuma(e.target.value)}
              />
              {!!refundFor?.order_refunded && refundFor.order_refunded > 0 && (
                <p className="text-xs text-muted-foreground">
                  Už vrátené: {eur(refundFor.order_refunded, refundFor.currency)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Dôvod</Label>
              {dovody.data && dovody.data.length > 0 && (
                <Select value={dovod} onValueChange={setDovod}>
                  <SelectTrigger>
                    <SelectValue placeholder="Vyber dôvod" />
                  </SelectTrigger>
                  <SelectContent>
                    {dovody.data.map((d) => (
                      <SelectItem key={d.id} value={d.name}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Textarea
                rows={2}
                placeholder="Doplň podrobnosti (nepovinné)"
                value={dovod}
                onChange={(e) => setDovod(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Zákazníkovi odíde e-mail o vrátení. Peniaze pošle brána; ak to cez API nevie, dostaneš
              pokyn, čo dorobiť ručne.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRefundFor(null)}>
              Zrušiť
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={refundovanie.isPending}
              onClick={() => refundFor && refundovanie.mutate(refundFor)}
            >
              {refundovanie.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Vrátiť peniaze
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
