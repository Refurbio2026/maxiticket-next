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
import { ExternalLink, FileText, Loader2, Pencil, Receipt } from "lucide-react";
import {
  listSettlements,
  previewCommissionInvoice,
  issueCommissionInvoice,
  setCommissionInvoiceManually,
  type SettlementRow,
} from "@/lib/settlements.functions";

export const Route = createFileRoute("/admin/maxiticket/billing")({
  head: () => ({ meta: [{ title: "Zostavy / fakturovanie · vipky.sk Admin" }] }),
  component: Page,
});

const eur = (n: number) =>
  `€ ${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ManualForm = { settlement_id: string; invoice_number: string; invoice_pdf_url: string };

function Page() {
  const qc = useQueryClient();
  const fetchSettlements = useServerFn(listSettlements);
  const fetchPreview = useServerFn(previewCommissionInvoice);
  const issue = useServerFn(issueCommissionInvoice);
  const setManual = useServerFn(setCommissionInvoiceManually);

  const [filter, setFilter] = useState<"all" | "uninvoiced" | "invoiced">("uninvoiced");
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [manual, setManual2] = useState<ManualForm | null>(null);

  const settlements = useQuery({
    queryKey: ["settlements", "billing"],
    queryFn: () => fetchSettlements({ data: { status: "all" } }),
  });

  const preview = useQuery({
    queryKey: ["commission-invoice-preview", previewFor],
    enabled: !!previewFor,
    queryFn: () => fetchPreview({ data: { settlement_id: previewFor! } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["settlements"] });

  const issueMutation = useMutation({
    mutationFn: (id: string) => issue({ data: { settlement_id: id } }),
    onSuccess: (r) => {
      invalidate();
      setPreviewFor(null);
      toast.success(`Faktúra ${r.invoice_number} vystavená.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Vystavenie zlyhalo"),
  });

  const manualMutation = useMutation({
    mutationFn: (f: ManualForm) =>
      setManual({
        data: {
          settlement_id: f.settlement_id,
          invoice_number: f.invoice_number,
          invoice_pdf_url: f.invoice_pdf_url || null,
        },
      }),
    onSuccess: (_r, f) => {
      invalidate();
      setManual2(null);
      toast.success(
        f.invoice_number.trim() ? "Číslo faktúry zapísané" : "Väzba na faktúru zrušená",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const all = settlements.data ?? [];
  const rows = all.filter((r) =>
    filter === "all" ? true : filter === "invoiced" ? !!r.invoice_number : !r.invoice_number,
  );
  const toInvoice = all.filter((r) => !r.invoice_number && r.status !== "draft");
  const pendingAmount = toInvoice.reduce((s, r) => s + r.commission_amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Zostavy / fakturovanie</h1>
          <p className="text-muted-foreground mt-1">
            Faktúry za províziu k{" "}
            <Link to="/admin/maxiticket/protocols" className="text-primary hover:underline">
              vyúčtovacím protokolom
            </Link>
            . Protokol províziu vypočíta, faktúra je až daňový doklad.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Čaká na vyfakturovanie
          </div>
          <div className="font-display text-2xl font-bold">{eur(pendingAmount)}</div>
          <div className="text-xs text-muted-foreground">{toInvoice.length} protokolov</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="uninvoiced">Nevyfakturované</SelectItem>
            <SelectItem value="invoiced">Vyfakturované</SelectItem>
            <SelectItem value="all">Všetky protokoly</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{rows.length} záznamov</span>
      </div>

      <Card className="bg-card/60 border-border/50 overflow-x-auto">
        {settlements.isLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            {filter === "uninvoiced"
              ? "Všetky schválené protokoly sú vyfakturované."
              : "Žiadne protokoly."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Organizátor</th>
                <th className="px-4 py-3 font-medium">Obdobie</th>
                <th className="px-4 py-3 font-medium">Stav protokolu</th>
                <th className="px-4 py-3 font-medium text-right">Provízia</th>
                <th className="px-4 py-3 font-medium">Faktúra</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r: SettlementRow) => (
                <tr key={r.id} className="border-b border-border/30 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.organizer_name}</div>
                    {r.event_title && (
                      <div className="text-xs text-muted-foreground">{r.event_title}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {r.period_from} → {r.period_to}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={r.status === "draft" ? "outline" : "secondary"}
                      className="text-[10px]"
                    >
                      {r.status === "draft"
                        ? "koncept"
                        : r.status === "approved"
                          ? "schválený"
                          : "vyplatený"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {eur(r.commission_amount)}
                  </td>
                  <td className="px-4 py-3">
                    {r.invoice_number ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{r.invoice_number}</span>
                        {r.invoice_pdf_url && (
                          <a
                            href={r.invoice_pdf_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          {r.invoice_source === "manual" ? "ručne" : "SuperFaktúra"}
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {!r.invoice_number && (
                        <Button size="sm" variant="outline" onClick={() => setPreviewFor(r.id)}>
                          <Receipt className="size-3.5 mr-1.5" /> Vystaviť
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Zapísať číslo faktúry ručne"
                        onClick={() =>
                          setManual2({
                            settlement_id: r.id,
                            invoice_number: r.invoice_number ?? "",
                            invoice_pdf_url: r.invoice_pdf_url ?? "",
                          })
                        }
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Dialog open={!!previewFor} onOpenChange={(o) => !o && setPreviewFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Faktúra za províziu</DialogTitle>
            <DialogDescription>
              Vystaví sa so splatnosťou, nie ako zaplatená — províziu organizátor ešte neuhradil.
            </DialogDescription>
          </DialogHeader>
          {preview.isLoading ? (
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          ) : preview.data ? (
            <div className="space-y-3 text-sm">
              <Row label="Odberateľ" value={preview.data.organizer_name} />
              <Row label="E-mail" value={preview.data.organizer_email || "—"} />
              <Row label="Položka" value={preview.data.item_name} />
              <Row label="Variabilný symbol" value={preview.data.variable_symbol} mono />
              <div className="flex items-center justify-between border-t border-border/40 pt-3">
                <span className="text-muted-foreground">Suma bez DPH</span>
                <span className="font-display text-xl font-bold">{eur(preview.data.amount)}</span>
              </div>
              {preview.data.blocked_reason && (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                  {preview.data.blocked_reason}
                </p>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewFor(null)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => previewFor && issueMutation.mutate(previewFor)}
              disabled={issueMutation.isPending || !preview.data || !!preview.data.blocked_reason}
              className="bg-gradient-flame text-primary-foreground shadow-glow"
            >
              {issueMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              <FileText className="size-4 mr-2" />
              Vystaviť cez SuperFaktúru
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!manual} onOpenChange={(o) => !o && setManual2(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Číslo faktúry</DialogTitle>
            <DialogDescription>
              Použi, keď faktúru vystavuješ z iného systému. Prázdne číslo väzbu zruší.
            </DialogDescription>
          </DialogHeader>
          {manual && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Číslo faktúry</Label>
                <Input
                  autoFocus
                  value={manual.invoice_number}
                  onChange={(e) => setManual2({ ...manual, invoice_number: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Odkaz na PDF (voliteľné)</Label>
                <Input
                  placeholder="https://…"
                  value={manual.invoice_pdf_url}
                  onChange={(e) => setManual2({ ...manual, invoice_pdf_url: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setManual2(null)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => manual && manualMutation.mutate(manual)}
              disabled={manualMutation.isPending}
            >
              {manualMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Uložiť
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`text-right ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}
