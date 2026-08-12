import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Pencil, Percent, Landmark } from "lucide-react";
import {
  listOrganizerAccounts,
  updateOrganizerAccount,
  getPlatformSettings,
  updatePlatformSettings,
  type OrganizerAccount,
} from "@/lib/settlements.functions";

export const Route = createFileRoute("/admin/maxiticket/organizers")({
  head: () => ({ meta: [{ title: "Organizátori · vipky.sk Admin" }] }),
  component: Page,
});

const fmtEur = (n: number) =>
  `€ ${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type EditForm = {
  company_name: string;
  ico: string;
  dic: string;
  ic_dph: string;
  billing_address: string;
  phone: string;
  payout_iban: string;
  commission_rate: string;
};

function Page() {
  const qc = useQueryClient();
  const fetchOrganizers = useServerFn(listOrganizerAccounts);
  const saveOrganizer = useServerFn(updateOrganizerAccount);
  const fetchSettings = useServerFn(getPlatformSettings);
  const saveSettings = useServerFn(updatePlatformSettings);

  const [editing, setEditing] = useState<OrganizerAccount | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [defaultRate, setDefaultRate] = useState("");

  const organizers = useQuery({
    queryKey: ["admin-organizers"],
    queryFn: () => fetchOrganizers({ data: undefined as never }),
  });

  const settings = useQuery({
    queryKey: ["platform-settings"],
    queryFn: () => fetchSettings({ data: undefined as never }),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!editing || !form) throw new Error("Nie je čo uložiť");
      const rate = form.commission_rate.trim();
      return saveOrganizer({
        data: {
          id: editing.id,
          company_name: form.company_name || null,
          ico: form.ico || null,
          dic: form.dic || null,
          ic_dph: form.ic_dph || null,
          billing_address: form.billing_address || null,
          phone: form.phone || null,
          payout_iban: form.payout_iban || null,
          // Prázdne pole = nechať predvolenú sadzbu platformy.
          commission_rate: rate === "" ? null : Number(rate.replace(",", ".")),
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-organizers"] });
      toast.success("Údaje organizátora uložené");
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const settingsMutation = useMutation({
    mutationFn: () =>
      saveSettings({ data: { default_commission_rate: Number(defaultRate.replace(",", ".")) } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-settings"] });
      qc.invalidateQueries({ queryKey: ["admin-organizers"] });
      toast.success("Predvolená sadzba uložená");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const openEdit = (o: OrganizerAccount) => {
    setEditing(o);
    setForm({
      company_name: o.company_name ?? "",
      ico: o.ico ?? "",
      dic: o.dic ?? "",
      ic_dph: o.ic_dph ?? "",
      billing_address: o.billing_address ?? "",
      phone: o.phone ?? "",
      payout_iban: o.payout_iban ?? "",
      commission_rate: o.commission_rate === null ? "" : String(o.commission_rate),
    });
  };

  const rows = organizers.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Organizátori</h1>
        <p className="text-muted-foreground mt-1">
          Fakturačné údaje, výplatný účet a provízia. Z tejto sadzby počíta vyúčtovanie.
        </p>
      </div>

      <Card className="p-5 bg-card/60 border-border/50">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Percent className="size-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">Predvolená provízia platformy</div>
              <div className="text-xs text-muted-foreground">
                Použije sa u organizátora, ktorý nemá vlastnú sadzbu.
              </div>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Sadzba (%)</Label>
              <Input
                className="w-28"
                inputMode="decimal"
                value={
                  defaultRate !== ""
                    ? defaultRate
                    : settings.data
                      ? String(settings.data.default_commission_rate)
                      : ""
                }
                onChange={(e) => setDefaultRate(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={settingsMutation.isPending || defaultRate === ""}
              onClick={() => settingsMutation.mutate()}
            >
              Uložiť
            </Button>
          </div>
        </div>
      </Card>

      <Card className="bg-card/60 border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Organizátor</th>
                <th className="px-4 py-3 font-medium">IČO / DIČ</th>
                <th className="px-4 py-3 font-medium">Výplatný účet</th>
                <th className="px-4 py-3 font-medium text-right">Provízia</th>
                <th className="px-4 py-3 font-medium text-right">Podujatia</th>
                <th className="px-4 py-3 font-medium text-right">Hrubá tržba</th>
                <th className="px-4 py-3 font-medium text-right">Vyplatené</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {organizers.isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </td>
                </tr>
              )}
              {!organizers.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    Zatiaľ žiadny organizátor. Rolu prideľuješ v sekcii Používatelia.
                  </td>
                </tr>
              )}
              {rows.map((o) => (
                <tr key={o.id} className="border-b border-border/30 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{o.company_name || o.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{o.email}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {o.ico || "—"}
                    {o.dic ? ` / ${o.dic}` : ""}
                  </td>
                  <td className="px-4 py-3">
                    {o.payout_iban ? (
                      <span className="font-mono text-xs">{o.payout_iban}</span>
                    ) : (
                      <Badge className="border-0 bg-destructive/15 text-destructive">chýba</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {o.effective_rate.toLocaleString("sk-SK", { minimumFractionDigits: 1 })} %
                    {o.commission_rate === null && (
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        predvolená
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{o.events_count || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtEur(o.gross_all_time)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {fmtEur(o.settled_all_time)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => openEdit(o)}>
                      <Pencil className="size-3.5 mr-1.5" /> Upraviť
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.full_name || editing?.email}</DialogTitle>
            <DialogDescription>
              Údaje sa použijú na vyúčtovacom protokole a pri výplate tržby.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Obchodné meno</Label>
                <Input
                  value={form.company_name}
                  onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>IČO</Label>
                <Input
                  value={form.ico}
                  onChange={(e) => setForm({ ...form, ico: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>DIČ</Label>
                <Input
                  value={form.dic}
                  onChange={(e) => setForm({ ...form, dic: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>IČ DPH</Label>
                <Input
                  value={form.ic_dph}
                  onChange={(e) => setForm({ ...form, ic_dph: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Telefón</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Fakturačná adresa</Label>
                <Input
                  value={form.billing_address}
                  onChange={(e) => setForm({ ...form, billing_address: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Landmark className="size-3.5" /> IBAN na výplatu
                </Label>
                <Input
                  className="font-mono"
                  placeholder="SK00 0000 0000 0000 0000 0000"
                  value={form.payout_iban}
                  onChange={(e) => setForm({ ...form, payout_iban: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Provízia (%)</Label>
                <Input
                  inputMode="decimal"
                  placeholder={`predvolená ${settings.data?.default_commission_rate ?? ""}`}
                  value={form.commission_rate}
                  onChange={(e) => setForm({ ...form, commission_rate: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Nechaj prázdne, ak má platiť predvolená sadzba platformy.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Zrušiť
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Uložiť
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
