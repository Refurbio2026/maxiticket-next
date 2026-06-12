import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  getCashiersForOrganizer, upsertCashier, deleteCashier, setCashierStatus,
  resetCashierPin, hashPin, ALL_PERMISSIONS,
  type Cashier, type CashierPermission,
} from "@/lib/cashier-db";
import { getSales, POS_EVENT, type PosSale } from "@/lib/pos-db";
import { uid } from "@/lib/local-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  History, KeyRound, Pencil, Plus, Power, Trash2, Users,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/pos/cashiers")({
  head: () => ({ meta: [{ title: "Pokladníci · vstupenky.sk" }] }),
  component: CashiersPage,
});

type FormState = {
  first_name: string;
  last_name: string;
  display_name: string;
  pin: string;
  status: "active" | "inactive";
  permissions: CashierPermission[];
};

const EMPTY_FORM: FormState = {
  first_name: "",
  last_name: "",
  display_name: "",
  pin: "",
  status: "active",
  permissions: ["sale", "open_register", "close_register", "view_sales"],
};

function CashiersPage() {
  const { user } = useAuth();
  const [list, setList] = useState<Cashier[]>([]);
  const [sales, setSales] = useState<PosSale[]>([]);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Cashier | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [resetFor, setResetFor] = useState<Cashier | null>(null);
  const [newPin, setNewPin] = useState("");
  const [historyFor, setHistoryFor] = useState<Cashier | null>(null);

  useEffect(() => {
    if (!user) return;
    setList(getCashiersForOrganizer(user.id));
    setSales(getSales().filter((s) => s.organizer_id === user.id));
  }, [user, tick]);

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener(POS_EVENT, h);
    return () => window.removeEventListener(POS_EVENT, h);
  }, []);

  const startCreate = () => { setEditing(null); setForm(EMPTY_FORM); setOpen(true); };
  const startEdit = (c: Cashier) => {
    setEditing(c);
    setForm({
      first_name: c.first_name, last_name: c.last_name, display_name: c.display_name,
      pin: "", status: c.status, permissions: c.permissions,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!user) return;
    if (!form.first_name || !form.last_name) return toast.error("Meno a priezvisko sú povinné");
    if (!form.display_name) return toast.error("Zadaj prezývku / meno na pokladni");
    if (!editing && form.pin.length < 4) return toast.error("PIN musí mať aspoň 4 znaky");
    if (editing && form.pin && form.pin.length < 4) return toast.error("Nový PIN musí mať aspoň 4 znaky");

    const now = new Date().toISOString();
    if (editing) {
      const next: Cashier = {
        ...editing,
        first_name: form.first_name, last_name: form.last_name,
        display_name: form.display_name, status: form.status,
        permissions: form.permissions, updated_at: now,
      };
      if (form.pin) next.pin_hash = await hashPin(form.pin);
      upsertCashier(next);
      toast.success("Pokladník aktualizovaný");
    } else {
      const pin_hash = await hashPin(form.pin);
      upsertCashier({
        id: uid(), organizer_id: user.id,
        first_name: form.first_name, last_name: form.last_name,
        display_name: form.display_name, pin_hash,
        status: form.status, permissions: form.permissions,
        created_at: now, updated_at: now,
      });
      toast.success("Pokladník vytvorený");
    }
    setOpen(false); setEditing(null); setForm(EMPTY_FORM);
  };

  const remove = (c: Cashier) => {
    if (!confirm(`Naozaj zmazať pokladníka ${c.display_name}?`)) return;
    deleteCashier(c.id); toast.success("Pokladník zmazaný");
  };

  const toggleStatus = (c: Cashier) => {
    const next: "active" | "inactive" = c.status === "active" ? "inactive" : "active";
    setCashierStatus(c.id, next);
    toast.success(next === "active" ? "Pokladník aktivovaný" : "Pokladník deaktivovaný");
  };

  const submitReset = async () => {
    if (!resetFor) return;
    if (newPin.length < 4) return toast.error("PIN musí mať aspoň 4 znaky");
    await resetCashierPin(resetFor.id, newPin);
    toast.success("PIN resetovaný");
    setResetFor(null); setNewPin("");
  };

  const historySales = useMemo(
    () => historyFor ? sales.filter((s) => s.cashier_id === historyFor.id).slice(0, 100) : [],
    [historyFor, sales],
  );

  const togglePerm = (k: CashierPermission) => {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(k)
        ? f.permissions.filter((p) => p !== k)
        : [...f.permissions, k],
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Pokladníci</h1>
          <p className="text-muted-foreground mt-1">
            Vytváraj pokladníkov a prideľuj im oprávnenia. Každý sa v pokladnici prihlasuje vlastným PIN kódom.
          </p>
        </div>
        <Button onClick={startCreate} className="bg-gradient-flame text-primary-foreground shadow-glow">
          <Plus className="size-4 mr-2" /> Pridať pokladníka
        </Button>
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        {list.length === 0 ? (
          <div className="text-center py-12">
            <Users className="size-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Zatiaľ žiadni pokladníci.</p>
            <Button onClick={startCreate} className="mt-4 bg-gradient-flame text-primary-foreground shadow-glow">
              <Plus className="size-4 mr-2" /> Pridať prvého pokladníka
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">Pokladník</th>
                  <th className="text-left">Prezývka</th>
                  <th className="text-left">Oprávnenia</th>
                  <th className="text-left">Stav</th>
                  <th className="text-right">Predaje</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const count = sales.filter((s) => s.cashier_id === c.id).length;
                  return (
                    <tr key={c.id} className="border-b border-border/30">
                      <td className="py-2">
                        <div className="font-medium">{c.first_name} {c.last_name}</div>
                        <div className="text-xs text-muted-foreground">aktualizované {new Date(c.updated_at).toLocaleDateString("sk-SK")}</div>
                      </td>
                      <td className="font-mono text-xs">{c.display_name}</td>
                      <td className="text-xs">
                        <div className="flex flex-wrap gap-1 max-w-[260px]">
                          {c.permissions.length === 0 ? (
                            <span className="text-muted-foreground">žiadne</span>
                          ) : c.permissions.map((p) => (
                            <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>
                          ))}
                        </div>
                      </td>
                      <td>
                        <Badge variant={c.status === "active" ? "default" : "destructive"} className="text-[10px]">
                          {c.status === "active" ? "Aktívny" : "Neaktívny"}
                        </Badge>
                      </td>
                      <td className="text-right text-xs">{count}</td>
                      <td>
                        <div className="flex gap-1 justify-end">
                          <Button size="icon" variant="ghost" className="size-7" title="História predajov" onClick={() => setHistoryFor(c)}>
                            <History className="size-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-7" title="Resetovať PIN" onClick={() => { setResetFor(c); setNewPin(""); }}>
                            <KeyRound className="size-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-7" title={c.status === "active" ? "Deaktivovať" : "Aktivovať"} onClick={() => toggleStatus(c)}>
                            <Power className={`size-3.5 ${c.status === "active" ? "text-primary" : "text-muted-foreground"}`} />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-7" title="Upraviť" onClick={() => startEdit(c)}>
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-7 text-destructive" title="Zmazať" onClick={() => remove(c)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create / edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Upraviť pokladníka" : "Nový pokladník"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Meno</Label>
                <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
              </div>
              <div>
                <Label>Priezvisko</Label>
                <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Prezývka / meno na pokladni</Label>
              <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="napr. Janka K." />
            </div>
            <div>
              <Label>{editing ? "Nový PIN (nechaj prázdne ak nemeníš)" : "PIN kód (min. 4 znaky)"}</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={form.pin}
                onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                PIN sa ukladá výhradne ako bezpečný hash (SHA-256), nikdy v plain texte.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
              <div>
                <Label className="cursor-pointer">Aktívny</Label>
                <p className="text-[11px] text-muted-foreground">Neaktívni pokladníci sa nezobrazia pri prihlásení.</p>
              </div>
              <Switch
                checked={form.status === "active"}
                onCheckedChange={(v) => setForm({ ...form, status: v ? "active" : "inactive" })}
              />
            </div>
            <div>
              <Label>Oprávnenia</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {ALL_PERMISSIONS.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2 cursor-pointer hover:bg-muted/40">
                    <Checkbox
                      checked={form.permissions.includes(key)}
                      onCheckedChange={() => togglePerm(key)}
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Zrušiť</Button>
            <Button onClick={save} className="bg-gradient-flame text-primary-foreground shadow-glow">
              {editing ? "Uložiť zmeny" : "Vytvoriť pokladníka"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset PIN dialog */}
      <Dialog open={!!resetFor} onOpenChange={(o) => !o && setResetFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Resetovať PIN · {resetFor?.display_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Nový PIN (min. 4 znaky)</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetFor(null)}>Zrušiť</Button>
            <Button onClick={submitReset} className="bg-gradient-flame text-primary-foreground shadow-glow">
              Uložiť nový PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History dialog */}
      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>História predajov · {historyFor?.display_name}</DialogTitle>
          </DialogHeader>
          {historySales.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Žiadne predaje.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">Doklad</th>
                  <th className="text-left">Dátum</th>
                  <th className="text-left">Podujatie</th>
                  <th className="text-left">Platba</th>
                  <th className="text-right">Suma</th>
                  <th className="text-left">Stav</th>
                </tr>
              </thead>
              <tbody>
                {historySales.map((s) => (
                  <tr key={s.id} className="border-b border-border/30">
                    <td className="py-2 font-mono text-xs">{s.receipt_number}</td>
                    <td className="text-xs">{new Date(s.created_at).toLocaleString("sk-SK")}</td>
                    <td className="truncate max-w-[200px]">{s.event_title}</td>
                    <td className="capitalize">{s.payment_method}</td>
                    <td className="text-right">€{s.total.toFixed(2)}</td>
                    <td>
                      <Badge variant={s.status === "paid" ? "default" : "destructive"} className="text-[10px]">
                        {s.status === "paid" ? "Zaplatené" : "Storno"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
