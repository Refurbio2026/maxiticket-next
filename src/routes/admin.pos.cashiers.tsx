// Pokladníci naprieč organizátormi.
//
// Stránka bola dlho len prehľadom — zakladať pokladníka sa dalo výhradne
// v organizátorskej sekcii, takže admin nemal ako. Teraz si vyberie
// organizátora a zakladá pod ním; server si `organizer_id` overí sám.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  usePosCashiers,
  useUpsertCashier,
  useDeleteCashier,
  type PosCashierRecord,
} from "@/hooks/use-pos";
import type { CashierPermission } from "@/lib/pos.functions";
import { listOrganizers } from "@/lib/events.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KeyRound, Loader2, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/pos/cashiers")({
  head: () => ({ meta: [{ title: "Pokladne · Admin" }] }),
  component: AdminPosCashiersPage,
});

const ALL_PERMISSIONS: { key: CashierPermission; label: string }[] = [
  { key: "sale", label: "Predaj vstupeniek" },
  { key: "void", label: "Storno predaja" },
  { key: "refund", label: "Refundácia" },
  { key: "open_register", label: "Otvorenie pokladne" },
  { key: "close_register", label: "Uzávierka pokladne" },
  { key: "view_sales", label: "Zobrazenie tržieb" },
];

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

function AdminPosCashiersPage() {
  const fetchOrganizers = useServerFn(listOrganizers);
  // Prázdny výber = prehľad naprieč všetkými; zakladať sa dá až po výbere.
  const [organizerId, setOrganizerId] = useState<string>("");

  const organizers = useQuery({
    queryKey: ["organizers", "options"],
    queryFn: () => fetchOrganizers({ data: undefined as never }),
  });
  const { data: list = [], isLoading } = usePosCashiers(organizerId || undefined);
  const saveCashier = useUpsertCashier();
  const removeCashier = useDeleteCashier();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PosCashierRecord | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [resetFor, setResetFor] = useState<PosCashierRecord | null>(null);
  const [newPin, setNewPin] = useState("");

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const startEdit = (c: PosCashierRecord) => {
    setEditing(c);
    setForm({
      first_name: c.first_name,
      last_name: c.last_name,
      display_name: c.display_name,
      pin: "",
      status: c.status,
      permissions: c.permissions,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.first_name || !form.last_name) return toast.error("Vyplň meno aj priezvisko.");
    if (!form.display_name) return toast.error("Vyplň zobrazované meno.");
    if (!editing && form.pin.length < 4) return toast.error("PIN musí mať aspoň 4 číslice.");
    if (editing && form.pin && form.pin.length < 4)
      return toast.error("Nový PIN musí mať aspoň 4 číslice.");
    if (form.permissions.length === 0) return toast.error("Vyber aspoň jedno oprávnenie.");

    try {
      await saveCashier.mutateAsync({
        id: editing?.id,
        // Pri úprave sa držíme vlastníka pokladníka, nie práve vybraného filtra.
        organizer_id: editing ? editing.organizer_id : organizerId,
        first_name: form.first_name,
        last_name: form.last_name,
        display_name: form.display_name,
        pin: form.pin || undefined,
        status: form.status,
        permissions: form.permissions,
      });
      toast.success(editing ? "Pokladník upravený." : "Pokladník založený.");
      setOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo");
    }
  };

  const submitReset = async () => {
    if (!resetFor) return;
    if (newPin.length < 4) return toast.error("PIN musí mať aspoň 4 číslice.");
    try {
      await saveCashier.mutateAsync({
        id: resetFor.id,
        organizer_id: resetFor.organizer_id,
        first_name: resetFor.first_name,
        last_name: resetFor.last_name,
        display_name: resetFor.display_name,
        pin: newPin,
        status: resetFor.status,
        permissions: resetFor.permissions,
      });
      toast.success("PIN zmenený.");
      setResetFor(null);
      setNewPin("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Zmena PIN-u zlyhala");
    }
  };

  const toggleStatus = async (c: PosCashierRecord) => {
    const next: "active" | "inactive" = c.status === "active" ? "inactive" : "active";
    try {
      await saveCashier.mutateAsync({
        id: c.id,
        organizer_id: c.organizer_id,
        first_name: c.first_name,
        last_name: c.last_name,
        display_name: c.display_name,
        status: next,
        permissions: c.permissions,
      });
      toast.success(next === "active" ? "Pokladník aktivovaný." : "Pokladník deaktivovaný.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Zmena stavu zlyhala");
    }
  };

  const remove = async (c: PosCashierRecord) => {
    if (!confirm(`Naozaj zmazať pokladníka ${c.display_name}?`)) return;
    try {
      const res = await removeCashier.mutateAsync(c.id);
      // Pokladníka s históriou nemažeme — doklad musí vedieť, kto ho vystavil.
      toast.success(res.deactivated ? "Pokladník deaktivovaný." : "Pokladník zmazaný.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo");
    }
  };

  const togglePerm = (k: CashierPermission) =>
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(k)
        ? f.permissions.filter((p) => p !== k)
        : [...f.permissions, k],
    }));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold">Pokladne</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pokladníci naprieč organizátormi. Zakladať sa dá až po výbere organizátora — pokladník
            vždy patrí jednému.
          </p>
        </div>
        <Button
          onClick={startCreate}
          disabled={!organizerId}
          title={organizerId ? undefined : "Najprv vyber organizátora"}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          <Plus className="size-4 mr-2" /> Nový pokladník
        </Button>
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">
          Organizátor
        </Label>
        <select
          value={organizerId}
          onChange={(e) => setOrganizerId(e.target.value)}
          className="w-full md:w-96 h-10 rounded-md bg-background border border-border/50 px-3 text-sm"
        >
          <option value="">— všetci organizátori —</option>
          {(organizers.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.full_name}
              {o.email ? ` (${o.email})` : ""}
            </option>
          ))}
        </select>
      </Card>

      <Card className="p-5 bg-card/60 border-border/50">
        {isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {organizerId ? "Tento organizátor zatiaľ nemá pokladníkov." : "Žiadni pokladníci."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">Meno</th>
                  <th className="text-left">Organizátor</th>
                  <th className="text-left">Stav</th>
                  <th className="text-left">Smena</th>
                  <th className="text-left">Oprávnenia</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="border-b border-border/30">
                    <td className="py-2 font-medium">
                      {c.display_name}
                      <div className="text-xs text-muted-foreground font-normal">
                        {c.first_name} {c.last_name}
                      </div>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {c.organizer_name || c.organizer_id}
                    </td>
                    <td>
                      {c.status === "active" ? (
                        <Badge>Aktívny</Badge>
                      ) : (
                        <Badge variant="outline">Neaktívny</Badge>
                      )}
                    </td>
                    <td className="text-xs">
                      {c.open_session_id ? (
                        <span className="text-emerald-600 dark:text-emerald-400">otvorená</span>
                      ) : (
                        <span className="text-muted-foreground">zavretá</span>
                      )}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {c.permissions.length} oprávnení
                    </td>
                    <td>
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          title="Zmeniť PIN"
                          onClick={() => {
                            setResetFor(c);
                            setNewPin("");
                          }}
                        >
                          <KeyRound className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          title={c.status === "active" ? "Deaktivovať" : "Aktivovať"}
                          onClick={() => toggleStatus(c)}
                        >
                          <Power
                            className={`size-3.5 ${c.status === "active" ? "text-primary" : "text-muted-foreground"}`}
                          />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          title="Upraviť"
                          onClick={() => startEdit(c)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive"
                          title="Zmazať"
                          onClick={() => remove(c)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Úprava pokladníka" : "Nový pokladník"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Meno</Label>
                <Input
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </div>
              <div>
                <Label>Priezvisko</Label>
                <Input
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Zobrazované meno</Label>
              <Input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="Zuzka P."
              />
            </div>
            <div>
              <Label>{editing ? "Nový PIN (nepovinné)" : "PIN kód"}</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={form.pin}
                onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                4 až 8 číslic. PIN hashuje server — do prehliadača sa nikdy nevráti.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
              <div>
                <Label className="cursor-pointer">Aktívny</Label>
                <p className="text-[11px] text-muted-foreground">
                  Neaktívny pokladník sa na pokladni neprihlási.
                </p>
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
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2 cursor-pointer hover:bg-muted/40"
                  >
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
            <Button variant="outline" onClick={() => setOpen(false)}>
              Zrušiť
            </Button>
            <Button
              onClick={save}
              disabled={saveCashier.isPending}
              className="bg-gradient-flame text-primary-foreground shadow-glow"
            >
              {editing ? "Uložiť zmeny" : "Založiť pokladníka"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetFor} onOpenChange={(o) => !o && setResetFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nový PIN pre {resetFor?.display_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>PIN kód</Label>
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
            <Button variant="outline" onClick={() => setResetFor(null)}>
              Zrušiť
            </Button>
            <Button
              onClick={submitReset}
              disabled={saveCashier.isPending}
              className="bg-gradient-flame text-primary-foreground shadow-glow"
            >
              Uložiť PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
