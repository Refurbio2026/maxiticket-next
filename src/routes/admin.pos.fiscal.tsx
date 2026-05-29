import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getFiscalReceipts, getFiscalSettings, POS_EVENT,
  type FiscalReceipt, type FiscalSettings,
} from "@/lib/pos-db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Receipt, FileText, Wifi } from "lucide-react";

export const Route = createFileRoute("/admin/pos/fiscal")({
  head: () => ({ meta: [{ title: "ORP / eKasa · Admin" }] }),
  component: AdminFiscalPage,
});

function AdminFiscalPage() {
  const [settings, setSettings] = useState<FiscalSettings>(getFiscalSettings());
  const [receipts, setReceipts] = useState<FiscalReceipt[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setSettings(getFiscalSettings());
    setReceipts(getFiscalReceipts().slice(0, 50));
  }, [tick]);

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener(POS_EVENT, h);
    return () => window.removeEventListener(POS_EVENT, h);
  }, []);

  const issued = receipts.filter((r) => r.status === "issued").length;
  const cancelled = receipts.filter((r) => r.status === "cancelled").length;
  const status = settings.connection_status;
  const statusLabel = status === "connected" ? "Pripojené" : status === "error" ? "Chyba" : "Nepripojené";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">ORP / eKasa</h1>
        <p className="text-sm text-muted-foreground mt-1">Stav fiskalizácie naprieč organizátormi.</p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <Card className="p-5 bg-card/60 border-border/50">
          <Wifi className="size-6 text-primary mb-3" />
          <div className="font-display font-semibold">Stav ORP</div>
          <Badge variant={status === "connected" ? "default" : "outline"} className="mt-2">{statusLabel}</Badge>
          <p className="text-xs text-muted-foreground mt-3">Režim: {settings.mode}</p>
        </Card>
        <Card className="p-5 bg-card/60 border-border/50">
          <Receipt className="size-6 text-primary mb-3" />
          <div className="font-display font-semibold">Vystavené doklady</div>
          <div className="text-2xl font-bold mt-2">{issued}</div>
        </Card>
        <Card className="p-5 bg-card/60 border-border/50">
          <ShieldCheck className="size-6 text-primary mb-3" />
          <div className="font-display font-semibold">Stornované</div>
          <div className="text-2xl font-bold mt-2">{cancelled}</div>
        </Card>
        <Card className="p-5 bg-card/60 border-border/50">
          <FileText className="size-6 text-primary mb-3" />
          <div className="font-display font-semibold">Konfigurácia</div>
          <Button asChild size="sm" variant="outline" className="mt-2">
            <Link to="/organizer/pos/fiscal">Otvoriť nastavenia</Link>
          </Button>
        </Card>
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Všetky ORP doklady</div>
        {receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žiadne doklady.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">Číslo ORP</th>
                  <th className="text-left">Dátum</th>
                  <th className="text-left">Organizátor</th>
                  <th className="text-left">DKP</th>
                  <th className="text-right">Suma</th>
                  <th className="text-left">Stav</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} className="border-b border-border/30">
                    <td className="py-2 font-mono text-xs">{r.receipt_number}</td>
                    <td className="text-xs">{new Date(r.created_at).toLocaleString("sk-SK")}</td>
                    <td className="text-xs font-mono text-muted-foreground">{r.organizer_id}</td>
                    <td className="text-xs font-mono">{r.dkp}</td>
                    <td className="text-right">€{r.total.toFixed(2)}</td>
                    <td>
                      <Badge variant={r.status === "issued" ? "default" : "destructive"} className="text-[10px]">
                        {r.status === "issued" ? "Platný" : "Stornovaný"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
