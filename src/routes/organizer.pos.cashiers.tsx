import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  getCashiers, upsertCashier, deleteCashier, POS_EVENT, type PosCashier,
} from "@/lib/pos-db";
import { uid } from "@/lib/local-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/pos/cashiers")({
  head: () => ({ meta: [{ title: "Pokladníci · MAXITICKET" }] }),
  component: CashiersPage,
});

function CashiersPage() {
  const { user } = useAuth();
  const [list, setList] = useState<PosCashier[]>([]);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", pin: "", can_void: false });

  useEffect(() => {
    if (!user) return;
    setList(getCashiers().filter((c) => c.organizer_id === user.id));
  }, [user, tick]);

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener(POS_EVENT, h);
    return () => window.removeEventListener(POS_EVENT, h);
  }, []);

  const save = () => {
    if (!user || !form.name || !form.pin) return toast.error("Meno a PIN sú povinné");
    upsertCashier({
      id: uid(), organizer_id: user.id, name: form.name, email: form.email,
      pin: form.pin, can_void: form.can_void, created_at: new Date().toISOString(),
    });
    toast.success("Pokladník pridaný");
    setForm({ name: "", email: "", pin: "", can_void: false });
    setOpen(false);
  };

  const remove = (id: string) => {
    if (!confirm("Zmazať pokladníka?")) return;
    deleteCashier(id); toast.success("Pokladník zmazaný");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Pokladníci</h1>
          <p className="text-muted-foreground mt-1">Spravuj prístupy a oprávnenia pokladníkov.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-flame text-primary-foreground shadow-glow"><Plus className="size-4 mr-2" /> Pridať pokladníka</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nový pokladník</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div><Label>Meno</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>PIN (4 znaky)</Label><Input maxLength={6} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} /></div>
              <div className="flex items-center justify-between">
                <Label>Povolenie robiť storno</Label>
                <Switch checked={form.can_void} onCheckedChange={(v) => setForm({ ...form, can_void: v })} />
              </div>
            </div>
            <DialogFooter><Button onClick={save}>Uložiť</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        {list.length === 0 ? (
          <div className="text-center py-10">
            <Users className="size-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Zatiaľ žiadni pokladníci.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border/50">
              <tr><th className="text-left py-2">Meno</th><th className="text-left">Email</th><th className="text-left">PIN</th><th className="text-left">Storno</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className="border-b border-border/30">
                  <td className="py-2 font-medium">{c.name}</td>
                  <td className="text-muted-foreground">{c.email}</td>
                  <td className="font-mono">{"•".repeat(c.pin.length)}</td>
                  <td>{c.can_void ? <Badge>Povolené</Badge> : <Badge variant="outline">Iba s povolením</Badge>}</td>
                  <td><Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => remove(c.id)}><Trash2 className="size-3.5" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
