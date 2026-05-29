import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  getDevices, saveDevices, POS_EVENT, emitPos, logAudit,
  type PosDevice, type DeviceType, type DeviceConnection, type DeviceStatus,
} from "@/lib/pos-db";
import { uid } from "@/lib/local-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { paymentTerminal } from "@/lib/payment-terminal-adapter";
import { Cpu, Plus, Trash2, Usb, Printer, ScanLine, Bluetooth, Cable, Wifi, Power } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/pos/devices")({
  head: () => ({ meta: [{ title: "Zariadenia · MAXITICKET" }] }),
  component: DevicesPage,
});

const TYPE_ICON: Record<DeviceType, React.ComponentType<{ className?: string }>> = {
  terminal: Usb, printer: Printer, scanner: ScanLine,
};
const CONN_ICON: Record<DeviceConnection, React.ComponentType<{ className?: string }>> = {
  USB: Cable, Bluetooth: Bluetooth, LAN: Wifi,
};

function DevicesPage() {
  const { user } = useAuth();
  const [list, setList] = useState<PosDevice[]>([]);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    name: string; location: string; device_type: DeviceType; connection: DeviceConnection;
  }>({ name: "", location: "", device_type: "terminal", connection: "USB" });

  useEffect(() => {
    if (!user) return;
    setList(getDevices().filter((d) => d.organizer_id === user.id));
  }, [user, tick]);

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener(POS_EVENT, h);
    return () => window.removeEventListener(POS_EVENT, h);
  }, []);

  const save = () => {
    if (!user || !form.name) return;
    const all = getDevices();
    const dev: PosDevice = {
      id: uid(), organizer_id: user.id, name: form.name, location: form.location,
      device_type: form.device_type, connection: form.connection,
      status: "inactive", terminal_connected: false,
      created_at: new Date().toISOString(),
    };
    all.unshift(dev);
    saveDevices(all); emitPos();
    logAudit({ user_id: user.id, user_name: user.full_name || user.email,
      action: "device.created", entity: "pos_devices", entity_id: dev.id, meta: { type: dev.device_type, connection: dev.connection } });
    setForm({ name: "", location: "", device_type: "terminal", connection: "USB" });
    setOpen(false);
    toast.success("Zariadenie pridané");
  };

  const remove = (id: string) => {
    saveDevices(getDevices().filter((d) => d.id !== id)); emitPos();
    if (user) logAudit({ user_id: user.id, user_name: user.full_name || user.email,
      action: "device.deleted", entity: "pos_devices", entity_id: id });
  };

  const setStatus = (id: string, status: DeviceStatus, extra: Partial<PosDevice> = {}) => {
    const all = getDevices().map((d) => d.id === id ? { ...d, status, ...extra } : d);
    saveDevices(all); emitPos();
  };

  const testConnect = async (d: PosDevice) => {
    toast.info(`Testujem ${d.name}…`);
    if (user) logAudit({ user_id: user.id, user_name: user.full_name || user.email,
      action: "device.test", entity: "pos_devices", entity_id: d.id, meta: { connection: d.connection } });
    try {
      if (d.device_type === "terminal") {
        const s = await paymentTerminal.connectTerminal();
        const ok = s === "connected";
        setStatus(d.id, ok ? "active" : "error", { terminal_connected: ok, last_connected_at: new Date().toISOString() });
        toast.success(`${d.name}: pripojený (${d.connection})`);
      } else {
        await new Promise((r) => setTimeout(r, 400));
        setStatus(d.id, "active", { last_connected_at: new Date().toISOString() });
        toast.success(`${d.name}: test OK`);
      }
    } catch {
      setStatus(d.id, "error");
      toast.error("Test zlyhal");
    }
  };

  const disconnect = async (d: PosDevice) => {
    if (d.device_type === "terminal") await paymentTerminal.disconnectTerminal();
    setStatus(d.id, "inactive", { terminal_connected: false });
    if (user) logAudit({ user_id: user.id, user_name: user.full_name || user.email,
      action: "device.disconnect", entity: "pos_devices", entity_id: d.id });
    toast.success(`${d.name} odpojené`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Zariadenia</h1>
          <p className="text-muted-foreground mt-1">Platobné terminály, tlačiarne a skenery (USB / Bluetooth / LAN).</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-flame text-primary-foreground shadow-glow"><Plus className="size-4 mr-2" /> Pridať zariadenie</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nové zariadenie</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label>Názov</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="POS-01" /></div>
              <div><Label>Umiestnenie</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Vstup A" /></div>
              <div>
                <Label>Typ zariadenia</Label>
                <select value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value as DeviceType })}
                  className="w-full h-10 rounded-md bg-background border border-border/50 px-3 text-sm">
                  <option value="terminal">Platobný terminál</option>
                  <option value="printer">Tlačiareň</option>
                  <option value="scanner">Skener</option>
                </select>
              </div>
              <div>
                <Label>Pripojenie</Label>
                <select value={form.connection} onChange={(e) => setForm({ ...form, connection: e.target.value as DeviceConnection })}
                  className="w-full h-10 rounded-md bg-background border border-border/50 px-3 text-sm">
                  <option value="USB">USB</option>
                  <option value="Bluetooth">Bluetooth</option>
                  <option value="LAN">LAN</option>
                </select>
              </div>
            </div>
            <DialogFooter><Button onClick={save}>Uložiť</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        {list.length === 0 ? (
          <div className="text-center py-10">
            <Cpu className="size-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Zatiaľ žiadne zariadenia.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((d) => {
              const TypeIcon = TYPE_ICON[d.device_type] || Cpu;
              const ConnIcon = CONN_ICON[d.connection] || Cable;
              const statusVariant = d.status === "active" ? "default" : d.status === "error" ? "destructive" : "outline";
              return (
                <Card key={d.id} className="p-4 bg-background border-border/50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-display font-semibold flex items-center gap-2">
                        <TypeIcon className="size-4 text-primary" /> {d.name}
                      </div>
                      <div className="text-xs text-muted-foreground">{d.location || "—"}</div>
                      <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                        <ConnIcon className="size-3" /> {d.connection}
                      </div>
                      {d.last_connected_at && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          Posledné pripojenie: {new Date(d.last_connected_at).toLocaleString("sk-SK")}
                        </div>
                      )}
                    </div>
                    <Badge variant={statusVariant} className="text-[10px] capitalize">
                      {d.status === "active" ? "Aktívne" : d.status === "error" ? "Chyba" : "Neaktívne"}
                    </Badge>
                  </div>
                  <div className="flex gap-2 mt-4 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => testConnect(d)}>
                      <Power className="size-3.5 mr-1.5" /> Test
                    </Button>
                    {d.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => disconnect(d)}>Odpojiť</Button>
                    )}
                    <Button size="icon" variant="ghost" className="size-8 text-destructive ml-auto" onClick={() => remove(d.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
