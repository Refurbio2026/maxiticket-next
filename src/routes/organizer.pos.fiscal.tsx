import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  getFiscalSettings, getFiscalReceipts, POS_EVENT, logAudit,
  type FiscalSettings, type FiscalReceipt,
} from "@/lib/pos-db";
import { orpAdapter } from "@/lib/fiscal-adapter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ShieldCheck, Wifi, Receipt, Ban, Save, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/pos/fiscal")({
  head: () => ({ meta: [{ title: "ORP / eKasa · vipky.sk" }] }),
  component: FiscalPage,
});

function FiscalPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<FiscalSettings>(getFiscalSettings());
  const [receipts, setReceipts] = useState<FiscalReceipt[]>([]);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

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

  const audit = (action: string, meta?: Record<string, unknown>) => {
    if (!user) return;
    logAudit({ user_id: user.id, user_name: user.full_name || user.email, action, entity: "orp_settings", meta });
  };

  const save = () => {
    orpAdapter.saveSettings(settings);
    audit("orp.settings_updated", { provider: settings.provider, mode: settings.mode });
    toast.success("Nastavenia uložené");
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await orpAdapter.testConnection();
      if (r.ok) {
        toast.success("ORP spojenie úspešne overené");
        setSettings(getFiscalSettings());
        audit("orp.test_connection", { latency_ms: r.latency_ms });
      } else toast.error("Test zlyhal: " + (r.error || "neznáma chyba"));
    } finally { setBusy(false); }
  };

  const connect = async () => {
    setBusy(true);
    try {
      const r = await orpAdapter.connect();
      if (r.ok) {
        toast.success("ORP pripojené");
        setSettings(getFiscalSettings());
        audit("orp.connect");
      }
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await orpAdapter.disconnect();
      setSettings(getFiscalSettings());
      audit("orp.disconnect");
      toast.success("ORP odpojené");
    } finally { setBusy(false); }
  };

  const cancelReceipt = async (id: string) => {
    if (!confirm("Stornovať fiskálny doklad?")) return;
    await orpAdapter.cancelReceipt(id);
    audit("orp.receipt_cancelled", { receipt_id: id });
    toast.success("Doklad stornovaný");
  };

  const status = settings.connection_status;
  const statusVariant = status === "connected" ? "default" : status === "error" ? "destructive" : "outline";
  const statusLabel = status === "connected" ? "Pripojené" : status === "error" ? "Chyba" : "Nepripojené";

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">ORP / eKasa</h1>
          <p className="text-muted-foreground mt-1">Online registračná pokladnica — integrácia s fiskálnym systémom.</p>
        </div>
        <div className="flex gap-2 items-center">
          <span
            className={`size-2.5 rounded-full ${status === "connected" ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.7)]" : status === "error" ? "bg-destructive" : "bg-muted-foreground/40"}`}
          />
          <Badge variant={statusVariant} className="gap-1.5"><Wifi className="size-3.5" />{statusLabel}</Badge>
          <Badge variant="outline">{settings.mode === "mock" ? "Mock režim" : "Produkcia"}</Badge>
        </div>
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Režim">
            <Select value={settings.mode} onChange={(v) => setSettings({ ...settings, mode: v as FiscalSettings["mode"] })}
              options={[{ v: "mock", l: "Mock (testovací)" }, { v: "production", l: "Produkcia" }]} />
          </Field>
          <Field label="Typ fiskalizácie">
            <Select value={settings.provider} onChange={(v) => setSettings({ ...settings, provider: v as FiscalSettings["provider"] })}
              options={[{ v: "ORP", l: "ORP" }, { v: "eKasa", l: "eKasa provider" }]} />
          </Field>
          <Field label="Poskytovateľ ORP">
            <Input value={settings.orp_provider} onChange={(e) => setSettings({ ...settings, orp_provider: e.target.value })} placeholder="napr. Bowa, Varos, Elcom…" />
          </Field>
          <Field label="API URL">
            <Input value={settings.api_url} onChange={(e) => setSettings({ ...settings, api_url: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="API kľúč">
            <Input type="password" value={settings.api_key} onChange={(e) => setSettings({ ...settings, api_key: e.target.value })} placeholder="••••••••" />
          </Field>
          <Field label="Client ID">
            <Input value={settings.client_id} onChange={(e) => setSettings({ ...settings, client_id: e.target.value })} placeholder="client_id" />
          </Field>
          <Field label="Client Secret">
            <Input type="password" value={settings.client_secret} onChange={(e) => setSettings({ ...settings, client_secret: e.target.value })} placeholder="••••••••" />
          </Field>
          <Field label="IČO">
            <Input value={settings.ico} onChange={(e) => setSettings({ ...settings, ico: e.target.value })} placeholder="12345678" />
          </Field>
          <Field label="DIČ">
            <Input value={settings.dic} onChange={(e) => setSettings({ ...settings, dic: e.target.value })} placeholder="2020000000" />
          </Field>
          <Field label="IČ DPH">
            <Input value={settings.ic_dph} onChange={(e) => setSettings({ ...settings, ic_dph: e.target.value })} placeholder="SK2020000000" />
          </Field>
          <Field label="Kód pokladnice">
            <Input value={settings.pos_code} onChange={(e) => setSettings({ ...settings, pos_code: e.target.value })} placeholder="0000" />
          </Field>
          <Field label="Kód prevádzky">
            <Input value={settings.premises_code} onChange={(e) => setSettings({ ...settings, premises_code: e.target.value })} placeholder="PREV-001" />
          </Field>
          <Field label="Názov prevádzky">
            <Input value={settings.premises_name} onChange={(e) => setSettings({ ...settings, premises_name: e.target.value })} placeholder="Hlavná pokladňa" />
          </Field>
          <Field label="Adresa prevádzky">
            <Input value={settings.premises_address} onChange={(e) => setSettings({ ...settings, premises_address: e.target.value })} placeholder="Hlavná 1, Bratislava" />
          </Field>
        </div>

        <Separator className="my-5" />
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={busy} className="bg-gradient-flame text-primary-foreground shadow-glow">
            <Save className="size-4 mr-2" /> Uložiť nastavenia
          </Button>
          <Button variant="outline" onClick={test} disabled={busy}>
            <ShieldCheck className="size-4 mr-2" /> Test spojenia
          </Button>
          {status !== "connected" ? (
            <Button variant="outline" onClick={connect} disabled={busy}>
              <Power className="size-4 mr-2" /> Pripojiť ORP
            </Button>
          ) : (
            <Button variant="outline" onClick={disconnect} disabled={busy}>
              <PowerOff className="size-4 mr-2" /> Odpojiť ORP
            </Button>
          )}
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
            <Receipt className="size-3.5" /> Posledné ORP doklady
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
                  <th className="text-left py-2">Číslo ORP</th>
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

      <Button asChild variant="ghost" size="sm">
        <Link to="/organizer/pos">← Späť na pokladňu</Link>
      </Button>
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

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full h-10 rounded-md bg-background border border-border/50 px-3 text-sm">
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}
