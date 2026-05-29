import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  getFiscalSettings, saveFiscalSettings, getFiscalReceipts, POS_EVENT,
  logAudit, type FiscalSettings, type FiscalReceipt,
} from "@/lib/pos-db";
import { fiscal } from "@/lib/fiscal-adapter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ShieldCheck, Wifi, Receipt, Ban, Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/pos/fiscal")({
  head: () => ({ meta: [{ title: "VRP2 / eKasa · MAXITICKET" }] }),
  component: FiscalPage,
});

function FiscalPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<FiscalSettings>(getFiscalSettings());
  const [receipts, setReceipts] = useState<FiscalReceipt[]>([]);
  const [tick, setTick] = useState(0);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setSettings(getFiscalSettings());
    if (!user) return;
    setReceipts(getFiscalReceipts().filter((r) => user.role === "admin" || r.organizer_id === user.id).slice(0, 20));
  }, [user, tick]);

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener(POS_EVENT, h);
    return () => window.removeEventListener(POS_EVENT, h);
  }, []);

  const save = () => {
    saveFiscalSettings(settings);
    if (user) logAudit({
      user_id: user.id, user_name: user.full_name || user.email,
      action: "fiscal.settings_updated", entity: "fiscal_settings",
      meta: { provider: settings.provider, mode: settings.mode },
    });
    toast.success("Nastavenia uložené");
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await fiscal.testConnection();
      if (r.ok) {
        toast.success(`Pripojenie OK · ${r.latency_ms} ms`);
        setSettings(getFiscalSettings());
        if (user) logAudit({
          user_id: user.id, user_name: user.full_name || user.email,
          action: "fiscal.test_connection", entity: "fiscal_settings", meta: { latency_ms: r.latency_ms },
        });
      } else {
        toast.error("Test zlyhal: " + (r.error || "neznáma chyba"));
      }
    } finally {
      setTesting(false);
    }
  };

  const cancelReceipt = async (id: string) => {
    if (!confirm("Stornovať fiskálny doklad?")) return;
    await fiscal.cancelReceipt(id);
    if (user) logAudit({
      user_id: user.id, user_name: user.full_name || user.email,
      action: "fiscal.receipt_cancelled", entity: "fiscal_receipts", entity_id: id,
    });
    toast.success("Doklad stornovaný");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">VRP2 / eKasa</h1>
          <p className="text-muted-foreground mt-1">Integrácia s pokladničným systémom Finančnej správy SR.</p>
        </div>
        <div className="flex gap-2">
          <Badge variant={settings.connected ? "default" : "outline"} className="gap-1.5">
            <Wifi className="size-3.5" />
            {settings.connected ? "Pripojené" : "Odpojené"}
          </Badge>
          <Badge variant="outline">{settings.mode === "mock" ? "Mock režim" : "Produkcia"}</Badge>
        </div>
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Režim">
            <select
              value={settings.mode}
              onChange={(e) => setSettings({ ...settings, mode: e.target.value as FiscalSettings["mode"] })}
              className="w-full h-10 rounded-md bg-background border border-border/50 px-3 text-sm"
            >
              <option value="mock">Mock (testovací)</option>
              <option value="production">Produkcia</option>
            </select>
          </Field>
          <Field label="Typ integrácie">
            <select
              value={settings.provider}
              onChange={(e) => setSettings({ ...settings, provider: e.target.value as FiscalSettings["provider"] })}
              className="w-full h-10 rounded-md bg-background border border-border/50 px-3 text-sm"
            >
              <option value="VRP2">VRP2</option>
              <option value="eKasa">eKasa provider</option>
            </select>
          </Field>
          <Field label="API URL">
            <Input value={settings.api_url} onChange={(e) => setSettings({ ...settings, api_url: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="API kľúč">
            <Input type="password" value={settings.api_key} onChange={(e) => setSettings({ ...settings, api_key: e.target.value })} placeholder="••••••••" />
          </Field>
          <Field label="DIČ">
            <Input value={settings.dic} onChange={(e) => setSettings({ ...settings, dic: e.target.value })} placeholder="2020000000" />
          </Field>
          <Field label="IČ DPH">
            <Input value={settings.ic_dph} onChange={(e) => setSettings({ ...settings, ic_dph: e.target.value })} placeholder="SK2020000000" />
          </Field>
          <Field label="Kód pokladnice (DKP)">
            <Input value={settings.pos_code} onChange={(e) => setSettings({ ...settings, pos_code: e.target.value })} placeholder="0000" />
          </Field>
          <Field label="Prevádzka">
            <Input value={settings.premises} onChange={(e) => setSettings({ ...settings, premises: e.target.value })} placeholder="Bratislava - centrum" />
          </Field>
        </div>

        <Separator className="my-5" />
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} className="bg-gradient-flame text-primary-foreground shadow-glow">
            <Save className="size-4 mr-2" /> Uložiť nastavenia
          </Button>
          <Button variant="outline" onClick={test} disabled={testing}>
            <ShieldCheck className="size-4 mr-2" /> {testing ? "Testujem…" : "Test spojenia"}
          </Button>
          {settings.last_tested_at && (
            <div className="text-xs text-muted-foreground self-center">
              Posledný test: {new Date(settings.last_tested_at).toLocaleString("sk-SK")}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Receipt className="size-3.5" /> Posledné fiskálne doklady
          </div>
          <Badge variant="outline">{receipts.length}</Badge>
        </div>
        {receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žiadne fiskálne doklady.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">Číslo</th>
                  <th className="text-left">Dátum</th>
                  <th className="text-left">DKP</th>
                  <th className="text-left">Platba</th>
                  <th className="text-right">Suma</th>
                  <th className="text-left">Stav</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} className="border-b border-border/30">
                    <td className="py-2 font-mono text-xs">{r.receipt_number}</td>
                    <td className="text-xs">{new Date(r.created_at).toLocaleString("sk-SK")}</td>
                    <td className="text-xs font-mono">{r.dkp}</td>
                    <td className="capitalize">{r.payment_method}</td>
                    <td className="text-right">€{r.total.toFixed(2)}</td>
                    <td>
                      <Badge variant={r.status === "issued" ? "default" : "destructive"} className="text-[10px]">
                        {r.status === "issued" ? "Platný" : "Stornovaný"}
                      </Badge>
                    </td>
                    <td>
                      {r.status === "issued" && (
                        <Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => cancelReceipt(r.id)}>
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
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}
