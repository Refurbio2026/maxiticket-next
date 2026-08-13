import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import {
  usePosCashiers,
  useUpsertCashier,
  useDeleteCashier,
  usePosSales,
  type PosCashierRecord,
} from "@/hooks/use-pos";
import type { CashierPermission } from "@/lib/pos.functions";

type Cashier = PosCashierRecord;

const ALL_PERMISSIONS: { key: CashierPermission; label: string }[] = [
  { key: "sale", label: "Predaj vstupeniek" },
  { key: "void", label: "Storno predaja" },
  { key: "refund", label: "Refundácia" },
  { key: "open_register", label: "Otvorenie pokladne" },
  { key: "close_register", label: "Uzávierka pokladne" },
  { key: "view_sales", label: "Zobrazenie tržieb" },
];
import { Card } from "@/components/ui/card";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { History, KeyRound, Pencil, Plus, Power, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/organizer/pos/cashiers")({
  head: () => ({ meta: [{ title: "Pokladníci · vipky.sk" }] }),
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
  const { t } = useI18n();
  const { user } = useAuth();
  const { data: list = [] } = usePosCashiers();
  const { data: sales = [] } = usePosSales({ limit: 200 });
  const saveCashier = useUpsertCashier();
  const removeCashier = useDeleteCashier();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Cashier | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [resetFor, setResetFor] = useState<Cashier | null>(null);
  const [newPin, setNewPin] = useState("");
  const [historyFor, setHistoryFor] = useState<Cashier | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };
  const startEdit = (c: Cashier) => {
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
    if (!user) return;
    if (!form.first_name || !form.last_name)
      return toast.error(t("orgPosCashiers.errNameRequired"));
    if (!form.display_name) return toast.error(t("orgPosCashiers.errDisplayNameRequired"));
    if (!editing && form.pin.length < 4) return toast.error(t("orgPosCashiers.errPinMin4"));
    if (editing && form.pin && form.pin.length < 4)
      return toast.error(t("orgPosCashiers.errNewPinMin4"));

    try {
      // PIN hashuje server — do prehliadača sa nikdy nedostane hash pokladníka.
      await saveCashier.mutateAsync({
        id: editing?.id,
        first_name: form.first_name,
        last_name: form.last_name,
        display_name: form.display_name,
        pin: form.pin || undefined,
        status: form.status,
        permissions: form.permissions,
      });
      toast.success(editing ? t("orgPosCashiers.updated") : t("orgPosCashiers.created"));
      setOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo");
    }
  };

  const remove = async (c: Cashier) => {
    if (!confirm(t("orgPosCashiers.confirmDelete", { name: c.display_name }))) return;
    try {
      const res = await removeCashier.mutateAsync(c.id);
      // Pokladníka s históriou nemažeme — doklad musí vedieť, kto ho vystavil.
      toast.success(res.deactivated ? "Pokladník deaktivovaný" : t("orgPosCashiers.deleted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo");
    }
  };

  const toggleStatus = async (c: Cashier) => {
    const next: "active" | "inactive" = c.status === "active" ? "inactive" : "active";
    try {
      await saveCashier.mutateAsync({
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        display_name: c.display_name,
        status: next,
        permissions: c.permissions,
      });
      toast.success(
        next === "active" ? t("orgPosCashiers.activated") : t("orgPosCashiers.deactivated"),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Zmena stavu zlyhala");
    }
  };

  const submitReset = async () => {
    if (!resetFor) return;
    if (newPin.length < 4) return toast.error(t("orgPosCashiers.errPinMin4"));
    try {
      await saveCashier.mutateAsync({
        id: resetFor.id,
        first_name: resetFor.first_name,
        last_name: resetFor.last_name,
        display_name: resetFor.display_name,
        pin: newPin,
        status: resetFor.status,
        permissions: resetFor.permissions,
      });
      toast.success(t("orgPosCashiers.pinReset"));
      setResetFor(null);
      setNewPin("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Zmena PIN-u zlyhala");
    }
  };

  const historySales = useMemo(
    () => (historyFor ? sales.filter((s) => s.cashier_id === historyFor.id).slice(0, 100) : []),
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
          <h1 className="font-display text-4xl font-bold tracking-tight">
            {t("orgPosCashiers.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("orgPosCashiers.subtitle")}</p>
        </div>
        <Button
          onClick={startCreate}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          <Plus className="size-4 mr-2" /> {t("orgPosCashiers.addButton")}
        </Button>
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        {list.length === 0 ? (
          <div className="text-center py-12">
            <Users className="size-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{t("orgPosCashiers.empty")}</p>
            <Button
              onClick={startCreate}
              className="mt-4 bg-gradient-flame text-primary-foreground shadow-glow"
            >
              <Plus className="size-4 mr-2" /> {t("orgPosCashiers.addFirstButton")}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">{t("orgPosCashiers.thCashier")}</th>
                  <th className="text-left">{t("orgPosCashiers.thDisplayName")}</th>
                  <th className="text-left">{t("orgPosCashiers.thPermissions")}</th>
                  <th className="text-left">{t("orgPosCashiers.thStatus")}</th>
                  <th className="text-right">{t("orgPosCashiers.thSales")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const count = sales.filter((s) => s.cashier_id === c.id).length;
                  return (
                    <tr key={c.id} className="border-b border-border/30">
                      <td className="py-2">
                        <div className="font-medium">
                          {c.first_name} {c.last_name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t("orgPosCashiers.updatedAt", {
                            date: new Date(c.created_at).toLocaleDateString("sk-SK"),
                          })}
                        </div>
                      </td>
                      <td className="font-mono text-xs">{c.display_name}</td>
                      <td className="text-xs">
                        <div className="flex flex-wrap gap-1 max-w-[260px]">
                          {c.permissions.length === 0 ? (
                            <span className="text-muted-foreground">
                              {t("orgPosCashiers.noPermissions")}
                            </span>
                          ) : (
                            c.permissions.map((p) => (
                              <Badge key={p} variant="outline" className="text-[10px]">
                                {p}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td>
                        <Badge
                          variant={c.status === "active" ? "default" : "destructive"}
                          className="text-[10px]"
                        >
                          {c.status === "active"
                            ? t("orgPosCashiers.statusActive")
                            : t("orgPosCashiers.statusInactive")}
                        </Badge>
                      </td>
                      <td className="text-right text-xs">{count}</td>
                      <td>
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            title={t("orgPosCashiers.titleHistory")}
                            onClick={() => setHistoryFor(c)}
                          >
                            <History className="size-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            title={t("orgPosCashiers.titleResetPin")}
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
                            title={
                              c.status === "active"
                                ? t("orgPosCashiers.titleDeactivate")
                                : t("orgPosCashiers.titleActivate")
                            }
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
                            title={t("orgPosCashiers.titleEdit")}
                            onClick={() => startEdit(c)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-destructive"
                            title={t("orgPosCashiers.titleDelete")}
                            onClick={() => remove(c)}
                          >
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
            <DialogTitle>
              {editing ? t("orgPosCashiers.dialogEditTitle") : t("orgPosCashiers.dialogNewTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("orgPosCashiers.labelFirstName")}</Label>
                <Input
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </div>
              <div>
                <Label>{t("orgPosCashiers.labelLastName")}</Label>
                <Input
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>{t("orgPosCashiers.labelDisplayName")}</Label>
              <Input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder={t("orgPosCashiers.displayNamePlaceholder")}
              />
            </div>
            <div>
              <Label>
                {editing
                  ? t("orgPosCashiers.labelNewPinOptional")
                  : t("orgPosCashiers.labelPinCode")}
              </Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={form.pin}
                onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {t("orgPosCashiers.pinHashNote")}
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
              <div>
                <Label className="cursor-pointer">{t("orgPosCashiers.labelActive")}</Label>
                <p className="text-[11px] text-muted-foreground">
                  {t("orgPosCashiers.activeNote")}
                </p>
              </div>
              <Switch
                checked={form.status === "active"}
                onCheckedChange={(v) => setForm({ ...form, status: v ? "active" : "inactive" })}
              />
            </div>
            <div>
              <Label>{t("orgPosCashiers.labelPermissions")}</Label>
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
              {t("orgPosCashiers.cancel")}
            </Button>
            <Button
              onClick={save}
              className="bg-gradient-flame text-primary-foreground shadow-glow"
            >
              {editing ? t("orgPosCashiers.saveChanges") : t("orgPosCashiers.createCashier")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset PIN dialog */}
      <Dialog open={!!resetFor} onOpenChange={(o) => !o && setResetFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("orgPosCashiers.resetPinTitle", { name: resetFor?.display_name })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>{t("orgPosCashiers.labelNewPin")}</Label>
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
              {t("orgPosCashiers.cancel")}
            </Button>
            <Button
              onClick={submitReset}
              className="bg-gradient-flame text-primary-foreground shadow-glow"
            >
              {t("orgPosCashiers.saveNewPin")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History dialog */}
      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("orgPosCashiers.historyTitle", { name: historyFor?.display_name })}
            </DialogTitle>
          </DialogHeader>
          {historySales.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {t("orgPosCashiers.noSales")}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">{t("orgPosCashiers.hThReceipt")}</th>
                  <th className="text-left">{t("orgPosCashiers.hThDate")}</th>
                  <th className="text-left">{t("orgPosCashiers.hThEvent")}</th>
                  <th className="text-left">{t("orgPosCashiers.hThPayment")}</th>
                  <th className="text-right">{t("orgPosCashiers.hThTotal")}</th>
                  <th className="text-left">{t("orgPosCashiers.hThStatus")}</th>
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
                      <Badge
                        variant={s.status === "paid" ? "default" : "destructive"}
                        className="text-[10px]"
                      >
                        {s.status === "paid"
                          ? t("orgPosCashiers.statusPaid")
                          : t("orgPosCashiers.statusVoid")}
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
