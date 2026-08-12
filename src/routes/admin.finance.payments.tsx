import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { settleGoPayOrder, reissueInvoice } from "@/lib/payments.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, RefreshCw, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/finance/payments")({
  head: () => ({ meta: [{ title: "Platby (GoPay) · vipky.sk Admin" }] }),
  component: Page,
});

type Row = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  total_amount: number;
  currency: string;
  status: string;
  gopay_payment_id: string | null;
  superfaktura_invoice_number: string | null;
  superfaktura_invoice_pdf_url: string | null;
  paid_at: string | null;
  created_at: string;
};

function Page() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const settle = useServerFn(settleGoPayOrder);
  const reissue = useServerFn(reissueInvoice);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, customer_name, customer_email, total_amount, currency, status, gopay_payment_id, superfaktura_invoice_number, superfaktura_invoice_pdf_url, paid_at, created_at",
      )
      .not("gopay_payment_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setRows((data as Row[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const verify = async (id: string) => {
    setBusy(id);
    try {
      const r = await settle({ data: { order_id: id } });
      toast.success(`Stav: ${r.status}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Overenie zlyhalo");
    } finally {
      setBusy(null);
    }
  };

  const issue = async (id: string) => {
    setBusy(id);
    try {
      const r = await reissue({ data: { order_id: id } });
      toast.success(`Faktúra ${r.invoice_number} vystavená`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Vystavenie faktúry zlyhalo");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">
            Platby (GoPay)
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Online platby cez GoPay a vystavené doklady v SuperFaktúre.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCw className="size-4" /> Obnoviť
        </Button>
      </div>

      <Card className="bg-card/60 border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="text-left p-3 font-medium">Objednávka</th>
                <th className="text-left p-3 font-medium">Zákazník</th>
                <th className="text-right p-3 font-medium">Suma</th>
                <th className="text-left p-3 font-medium">GoPay stav</th>
                <th className="text-left p-3 font-medium">Faktúra</th>
                <th className="text-left p-3 font-medium">Dátum</th>
                <th className="text-right p-3 font-medium">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-muted-foreground">
                    <Loader2 className="size-5 inline animate-spin mr-2" /> Načítavam…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-muted-foreground">
                    Zatiaľ žiadne GoPay platby.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/20 hover:bg-muted/30">
                    <td className="p-3 font-mono text-xs">{r.id.slice(0, 8).toUpperCase()}</td>
                    <td className="p-3">
                      <div className="font-medium">{r.customer_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.customer_email}</div>
                    </td>
                    <td className="p-3 text-right font-semibold">
                      €{Number(r.total_amount).toFixed(2)}
                    </td>
                    <td className="p-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="p-3">
                      {r.superfaktura_invoice_number ? (
                        r.superfaktura_invoice_pdf_url ? (
                          <a
                            href={r.superfaktura_invoice_pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            {r.superfaktura_invoice_number} <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          <span>{r.superfaktura_invoice_number}</span>
                        )
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {r.paid_at
                        ? new Date(r.paid_at).toLocaleString("sk")
                        : new Date(r.created_at).toLocaleString("sk")}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === r.id}
                        onClick={() => verify(r.id)}
                        className="gap-1"
                      >
                        <RefreshCw className="size-3.5" /> Overiť
                      </Button>
                      {r.status === "paid" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy === r.id}
                          onClick={() => issue(r.id)}
                          className="gap-1"
                        >
                          <FileText className="size-3.5" /> Faktúra
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-muted text-muted-foreground" },
    awaiting_payment: { label: "Čaká na platbu", cls: "bg-amber-500/15 text-amber-600" },
    paid: { label: "Zaplatené", cls: "bg-emerald-500/15 text-emerald-600" },
    failed: { label: "Zlyhala", cls: "bg-destructive/15 text-destructive" },
    cancelled: { label: "Zrušené", cls: "bg-muted text-muted-foreground" },
    refunded: { label: "Vrátené", cls: "bg-blue-500/15 text-blue-600" },
    expired: { label: "Expirované", cls: "bg-muted text-muted-foreground" },
  };
  const m = map[status] || { label: status, cls: "bg-muted text-muted-foreground" };
  return <Badge className={`${m.cls} border-0`}>{m.label}</Badge>;
}
