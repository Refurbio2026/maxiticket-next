import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getDevices, saveDevices, POS_EVENT, emitPos, type PosDevice } from "@/lib/pos-db";
import { uid } from "@/lib/local-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { paymentTerminal } from "@/lib/payment-terminal-adapter";
import { Cpu, Plus, Trash2, Usb } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/pos/devices")({
  head: () => ({ meta: [{ title: "Zariadenia · MAXITICKET" }] }),
  component: DevicesPage,
});

function DevicesPage() {
  const { user } = useAuth();
  const [list, setList] = useState<PosDevice[]>([]);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", location: "" });

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
    all.unshift({
      id: uid(), organizer_id: user.id, name: form.name, location: form.location,
      terminal_connected: false, created_at: new Date().toISOString(),
    });
    saveDevices(all); emitPos();
    setForm({ name: "", location: "" }); setOpen(false);
    toast.success("Zariadenie pridané");
  };

  const remove = (id: string) => {
    saveDevices(getDevices().filter((d) => d.id !== id)); emitPos();
  };

  const testConnect = async (d: PosDevice) => {
    toast.info(`Pripájam terminál ${d.name}…`);
    const s = await paymentTerminal.connectTerminal();
    const all = getDevices().map((x) => x.id === d.id ? { ...x, terminal_connected: s === "connected" } : x);
    saveDevices(all); emitPos();
    toast.success("Terminál pripojený (USB mock)");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Zariadenia</h1>
          <p className="text-muted-foreground mt-1">POS pokladne, čítačky a platobné terminály (USB).</p>
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
            {list.map((d) => (
              <Card key={d.id} className="p-4 bg-background border-border/50">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-display font-semibold">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.location || "—"}</div>
                  </div>
                  <Badge variant={d.terminal_connected ? "default" : "outline"} className="text-[10px]">
                    {d.terminal_connected ? "Online" : "Offline"}
                  </Badge>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button size="sm" variant="outline" onClick={() => testConnect(d)}><Usb className="size-3.5 mr-1.5" /> Pripojiť terminál</Button>
                  <Button size="icon" variant="ghost" className="size-8 text-destructive ml-auto" onClick={() => remove(d.id)}><Trash2 className="size-3.5" /></Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
