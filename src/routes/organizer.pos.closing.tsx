import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import {
  useActivePosSession,
  useCreatePosClosing,
  usePosClosingPreview,
  usePosSales,
  setActiveSessionId,
} from "@/hooks/use-pos";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Banknote,
  CreditCard,
  Building2,
  Gift,
  Ban,
  FileDown,
  FileText,
  Download,
  ArrowLeft,
  Receipt,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { listPosDocuments, downloadPosDocument } from "@/lib/pos-documents.functions";
import { downloadBase64 } from "@/lib/download";

export const Route = createFileRoute("/organizer/pos/closing")({
  head: () => ({ meta: [{ title: "Denná uzávierka · vipky.sk" }] }),
  component: ClosingPage,
});

function ClosingPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const from = `${date}T00:00:00.000Z`;
  const to = `${date}T23:59:59.999Z`;
  const { data: sales = [] } = usePosSales({ from, to, limit: 500 });
  const { data: preview } = usePosClosingPreview({ from, to });
  const { session: activeSession, activate } = useActivePosSession();
  const closeMutation = useCreatePosClosing();

  // Uložené uzávierky. PDF vzniká pri uzavretí, tu ho už len sťahujeme.
  const qc = useQueryClient();
  const fetchDocs = useServerFn(listPosDocuments);
  const fetchDoc = useServerFn(downloadPosDocument);
  const documents = useQuery({
    queryKey: ["pos-documents", "closing", "me"],
    queryFn: () => fetchDocs({ data: { kind: "closing", limit: 30 } }),
  });
  const [busyDoc, setBusyDoc] = useState<string | null>(null);

  const stiahni = async (id: string) => {
    setBusyDoc(id);
    try {
      const doc = await fetchDoc({ data: { id } });
      downloadBase64(doc.filename, doc.base64, doc.content_type);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Stiahnutie zlyhalo");
    } finally {
      setBusyDoc(null);
    }
  };

  if (!user) return null;
  const stats = {
    cash_total: preview?.cash_total ?? 0,
    card_total: preview?.card_total ?? 0,
    transfer_total: preview?.transfer_total ?? 0,
    free_total: preview?.free_total ?? 0,
    voided_total: preview?.voided_total ?? 0,
    receipts_count: preview?.orders_count ?? 0,
    tickets_count: preview?.tickets_count ?? 0,
  };
  const total = stats.cash_total + stats.card_total + stats.transfer_total + stats.free_total;

  const exportCsv = () => {
    const rows = [
      [
        t("orgPosClosing.csvReceipt"),
        t("orgPosClosing.csvTime"),
        t("orgPosClosing.csvEvent"),
        t("orgPosClosing.csvPayment"),
        t("orgPosClosing.csvAmount"),
        t("orgPosClosing.csvStatus"),
        t("orgPosClosing.csvCashier"),
      ],
      ...sales.map((s) => [
        s.receipt_number,
        s.created_at,
        s.event_title,
        s.payment_method,
        s.total.toFixed(2),
        s.status,
        s.cashier_name || "",
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `uzavierka-${date}.csv`;
    a.click();
  };

  const closeDay = async () => {
    if (!confirm(t("orgPosClosing.confirmCloseDay"))) return;
    try {
      // Uzávierka sa v databáze zmrazí — neskorší predaj ju už neprepíše.
      const res = await closeMutation.mutateAsync({ from, to, close_session: false });
      toast.success(t("orgPosClosing.dayClosed"));
      qc.invalidateQueries({ queryKey: ["pos-documents"] });
      // Doklad podsunieme rovno — po uzávierke ho aj tak každý hľadá ako prvé.
      if (res.document_id) await stiahni(res.document_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Uzávierka zlyhala");
    }
  };

  const closeShift = async () => {
    if (!activeSession) {
      toast.info(t("orgPosClosing.noActiveShift"));
      return;
    }
    const cashStr = prompt(
      t("orgPosClosing.countCashPrompt", { cashier: activeSession.cashier_name }),
      "0",
    );
    if (cashStr === null) return;
    const closingCash = Number(cashStr) || 0;
    try {
      const result = await closeMutation.mutateAsync({
        session_id: activeSession.id,
        counted_cash: closingCash,
        close_session: true,
      });
      setActiveSessionId(null);
      activate(null);
      const diff = Math.round((closingCash - result.expected_cash) * 100) / 100;
      const diffStr = `${diff > 0 ? "+" : ""}€${diff.toFixed(2)}`;
      toast.success(
        diff === 0
          ? t("orgPosClosing.shiftClosedOk")
          : t("orgPosClosing.shiftClosedDiff", { diff: diffStr }),
      );
      qc.invalidateQueries({ queryKey: ["pos-documents"] });
      if (result.document_id) await stiahni(result.document_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Uzávierku smeny sa nepodarilo uložiť");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to="/organizer/pos">
              <ArrowLeft className="size-4 mr-1.5" /> {t("orgPosClosing.backToPos")}
            </Link>
          </Button>
          <h1 className="font-display text-4xl font-bold tracking-tight">
            {t("orgPosClosing.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("orgPosClosing.subtitle")}</p>
        </div>
        <div className="flex gap-2 items-end">
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t("orgPosClosing.dateLabel")}</div>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-10 w-44"
            />
          </div>
          <Button variant="outline" onClick={exportCsv}>
            <FileDown className="size-4 mr-2" /> {t("orgPosClosing.csvButton")}
          </Button>
          <Button
            variant="outline"
            disabled={!documents.data?.length || !!busyDoc}
            title={documents.data?.length ? documents.data[0].title : "Zatiaľ žiadna uzávierka"}
            onClick={() => documents.data?.[0] && stiahni(documents.data[0].id)}
          >
            <FileText className="size-4 mr-2" /> Posledná uzávierka (PDF)
          </Button>
          <Button variant="outline" onClick={closeShift}>
            <LogOut className="size-4 mr-2" /> {t("orgPosClosing.closeShift")}
          </Button>
          <Button
            onClick={closeDay}
            className="bg-gradient-flame text-primary-foreground shadow-glow"
          >
            <ShieldCheck className="size-4 mr-2" /> {t("orgPosClosing.closeDay")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile
          icon={<Banknote className="size-4 text-primary" />}
          label={t("orgPosClosing.tileCash")}
          value={`€${stats.cash_total.toFixed(2)}`}
        />
        <Tile
          icon={<CreditCard className="size-4 text-primary" />}
          label={t("orgPosClosing.tileCard")}
          value={`€${stats.card_total.toFixed(2)}`}
        />
        <Tile
          icon={<Building2 className="size-4 text-primary" />}
          label={t("orgPosClosing.tileTransfer")}
          value={`€${stats.transfer_total.toFixed(2)}`}
        />
        <Tile
          icon={<Gift className="size-4 text-primary" />}
          label={t("orgPosClosing.tileGuestlist")}
          value={`€${stats.free_total.toFixed(2)}`}
        />
        <Tile
          icon={<Ban className="size-4 text-destructive" />}
          label={t("orgPosClosing.tileVoided")}
          value={`€${stats.voided_total.toFixed(2)}`}
        />
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("orgPosClosing.totalRevenue")}
            </div>
            <div className="font-display text-4xl font-bold mt-1">€{total.toFixed(2)}</div>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <div>
              {t("orgPosClosing.receiptsLabel")}{" "}
              <span className="text-foreground font-semibold">{stats.receipts_count}</span>
            </div>
            <div>
              {t("orgPosClosing.ticketsLabel")}{" "}
              <span className="text-foreground font-semibold">{stats.tickets_count}</span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          {t("orgPosClosing.salesOfDay")}
        </div>
        {sales.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("orgPosClosing.noSales")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">{t("orgPosClosing.colReceipt")}</th>
                  <th className="text-left">{t("orgPosClosing.colTime")}</th>
                  <th className="text-left">{t("orgPosClosing.colEvent")}</th>
                  <th className="text-left">{t("orgPosClosing.colPayment")}</th>
                  <th className="text-right">{t("orgPosClosing.colAmount")}</th>
                  <th className="text-left">{t("orgPosClosing.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="border-b border-border/30">
                    <td className="py-2 font-mono text-xs">{s.receipt_number}</td>
                    <td className="text-xs">
                      {new Date(s.created_at).toLocaleTimeString("sk-SK")}
                    </td>
                    <td className="truncate max-w-[220px]">{s.event_title}</td>
                    <td className="capitalize">{s.payment_method}</td>
                    <td className="text-right">€{s.total.toFixed(2)}</td>
                    <td>
                      <Badge
                        variant={s.status === "paid" ? "default" : "destructive"}
                        className="text-[10px]"
                      >
                        {s.status === "paid" ? t("orgPosClosing.paid") : t("orgPosClosing.void")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <FileText className="size-3.5" /> Uložené uzávierky
        </div>
        {documents.data === undefined ? (
          <p className="text-sm text-muted-foreground">Načítavam…</p>
        ) : documents.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Zatiaľ žiadna. PDF vznikne automaticky pri uzavretí dňa alebo smeny.
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {documents.data.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{d.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(d.created_at).toLocaleString("sk-SK")} ·{" "}
                    {Math.round(d.size_bytes / 1024)} kB
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyDoc === d.id}
                  onClick={() => stiahni(d.id)}
                >
                  <Download className="size-4 mr-1.5" /> Stiahnuť
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Receipt className="size-3.5" /> Hotovosť v zásuvke
        </div>
        {activeSession ? (
          <div className="grid sm:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Pokladník</div>
              <div className="font-medium">{activeSession.cashier_name}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Počiatočná hotovosť</div>
              <div className="font-medium">€{activeSession.opening_cash.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Očakávaná hotovosť</div>
              <div className="font-medium">€{(preview?.expected_cash ?? 0).toFixed(2)}</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Žiadna otvorená smena — čísla vyššie sú za celý deň.
          </p>
        )}
      </Card>
    </div>
  );
}

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="p-4 bg-card/60 border-border/50">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="font-display text-lg font-bold mt-0.5">{value}</div>
        </div>
        {icon}
      </div>
    </Card>
  );
}
