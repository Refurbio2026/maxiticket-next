// ORP / eKasa pre organizátora.
//
// Nastavenie aj doklady boli predtým v localStorage (`pos-db.ts`) — zadané kódy
// pre finančnú správu sa stratili pri vymazaní cache a druhá pokladňa o nich
// nevedela. Teraz obe bežia nad databázou cez `fiscal.functions.ts`.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useI18n } from "@/hooks/use-i18n";
import { listFiscalReceipts, cancelFiscalReceipt } from "@/lib/fiscal.functions";
import { FiscalSettingsCard } from "@/components/pos/FiscalSettingsCard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Ban, Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/pos/fiscal")({
  head: () => ({ meta: [{ title: "ORP / eKasa · vipky.sk" }] }),
  component: FiscalPage,
});

function FiscalPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const fetchReceipts = useServerFn(listFiscalReceipts);
  const cancelReceiptFn = useServerFn(cancelFiscalReceipt);

  const receipts = useQuery({
    queryKey: ["fiscal-receipts", "me"],
    queryFn: () => fetchReceipts({ data: { limit: 20 } }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelReceiptFn({ data: { id } }),
    onSuccess: () => {
      toast.success(t("orgPosFiscal.toastReceiptCancelled"));
      qc.invalidateQueries({ queryKey: ["fiscal-receipts"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Storno zlyhalo"),
  });

  const rows = receipts.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          {t("orgPosFiscal.title")}
        </h1>
        <p className="text-muted-foreground mt-1">{t("orgPosFiscal.subtitle")}</p>
      </div>

      <FiscalSettingsCard />

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Receipt className="size-3.5" /> {t("orgPosFiscal.recentReceipts")}
          </div>
          <Badge variant="outline">{rows.length}</Badge>
        </div>
        {receipts.isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("orgPosFiscal.noReceipts")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">{t("orgPosFiscal.colOrpNumber")}</th>
                  <th className="text-left">{t("orgPosFiscal.colDate")}</th>
                  <th className="text-left">{t("orgPosFiscal.colDkp")}</th>
                  <th className="text-left">{t("orgPosFiscal.colPayment")}</th>
                  <th className="text-right">{t("orgPosFiscal.colAmount")}</th>
                  <th className="text-left">{t("orgPosFiscal.colStatus")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/30">
                    <td className="py-2 font-mono text-xs">{r.receipt_number}</td>
                    <td className="text-xs">{new Date(r.issued_at).toLocaleString("sk-SK")}</td>
                    <td className="text-xs font-mono">{r.fiscal_code ?? "—"}</td>
                    <td className="capitalize">{r.payment_method ?? "—"}</td>
                    <td className="text-right">€{r.total_amount.toFixed(2)}</td>
                    <td>
                      <Badge
                        variant={r.status === "issued" ? "default" : "destructive"}
                        className="text-[10px]"
                      >
                        {r.status === "issued"
                          ? t("orgPosFiscal.receiptValid")
                          : t("orgPosFiscal.receiptCancelled")}
                      </Badge>
                    </td>
                    <td>
                      {r.status === "issued" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive"
                          disabled={cancel.isPending}
                          onClick={() => {
                            if (!confirm(t("orgPosFiscal.confirmCancel"))) return;
                            cancel.mutate(r.id);
                          }}
                        >
                          <Ban className="size-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Button asChild variant="ghost" size="sm">
        <Link to="/organizer/pos">{t("orgPosFiscal.backToPos")}</Link>
      </Button>
    </div>
  );
}
