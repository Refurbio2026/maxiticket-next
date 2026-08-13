import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Pencil, Plus, Trash2, Scan, CreditCard, Printer, Monitor } from "lucide-react";
import {
  listDevices,
  upsertDevice,
  deleteDevice,
  DEVICE_TYPES,
  type DeviceRecord,
  type DeviceType,
} from "@/lib/devices.functions";
import { useEvents } from "@/hooks/use-events";

export const Route = createFileRoute("/admin/maxiticket/devices")({
  head: () => ({ meta: [{ title: "Zariadenia / čítačky · vipky.sk Admin" }] }),
  component: Page,
});

const ALL_EVENTS = "__all__";

const TYPE_LABEL: Record<DeviceType, string> = {
  scanner: "Čítačka vstupeniek",
  terminal: "Platobný terminál",
  printer: "Tlačiareň",
  kiosk: "Samoobslužný kiosk",
};

const TYPE_ICON: Record<DeviceType, React.ComponentType<{ className?: string }>> = {
  scanner: Scan,
  terminal: CreditCard,
  printer: Printer,
  kiosk: Monitor,
};

type Form = {
  id?: string;
  name: string;
  device_type: DeviceType;
  serial_number: string;
  location: string;
  event_id: string;
  status: "active" | "inactive";
  note: string;
};

const emptyForm: Form = {
  name: "",
  device_type: "scanner",
  serial_number: "",
  location: "",
  event_id: ALL_EVENTS,
  status: "active",
  note: "",
};

function toForm(d: DeviceRecord): Form {
  return {
    id: d.id,
    name: d.name,
    device_type: d.device_type,
    serial_number: d.serial_number ?? "",
    location: d.location ?? "",
    event_id: d.event_id ?? ALL_EVENTS,
    status: d.status,
    note: d.note ?? "",
  };
}

/** „Naposledy videné" má zmysel čítať relatívne — zaujíma nás, či zariadenie žije. */
function lastSeen(iso: string | null): string {
  if (!iso) return "nikdy";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "práve teraz";
  if (mins < 60) return `pred ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `pred ${hours} h`;
  return new Date(iso).toLocaleDateString("sk-SK");
}

function Page() {
  const qc = useQueryClient();
  const fetchDevices = useServerFn(listDevices);
  const saveDevice = useServerFn(upsertDevice);
  const removeDevice = useServerFn(deleteDevice);
  const { data: events = [] } = useEvents({ scope: "mine" });

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Form | null>(null);

  const devices = useQuery({ queryKey: ["devices"], queryFn: () => fetchDevices({ data: undefined as never }) });

  const saveMutation = useMutation({
    mutationFn: (form: Form) =>
      saveDevice({
        data: {
          id: form.id,
          name: form.name,
          device_type: form.device_type,
          serial_number: form.serial_number || null,
          location: form.location || null,
          event_id: form.event_id === ALL_EVENTS ? null : form.event_id,
          status: form.status,
          note: form.note || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Zariadenie uložené");
      setEditing(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Uloženie zlyhalo"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeDevice({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
      toast.success("Zariadenie zmazané");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Zmazanie zlyhalo"),
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = devices.data ?? [];
    if (!needle) return list;
    return list.filter(
      (d) =>
        d.name.toLowerCase().includes(needle) ||
        (d.serial_number || "").toLowerCase().includes(needle) ||
        (d.location || "").toLowerCase().includes(needle),
    );
  }, [devices.data, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Zariadenia / čítačky</h1>
          <p className="text-muted-foreground mt-1">
            Čítačky pri dverách, platobné terminály a tlačiarne. Čítačku si skener na tablete
            vyberie zo zoznamu, takže pri každom skene je vidieť, ktorý vchod vstupenku načítal.
          </p>
        </div>
        <Button
          onClick={() => setEditing({ ...emptyForm })}
          className="bg-gradient-flame text-primary-foreground shadow-glow"
        >
          <Plus className="size-4 mr-2" /> Nové zariadenie
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Hľadať názov, sériové číslo alebo umiestnenie…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <span className="text-sm text-muted-foreground">
          {rows.length}{" "}
          {rows.length === 1 ? "zariadenie" : rows.length < 5 ? "zariadenia" : "zariadení"}
        </span>
      </div>

      {devices.isLoading && (
        <Card className="bg-card/60 border-border/50 p-10 text-center text-muted-foreground">
          <Loader2 className="mx-auto size-5 animate-spin" />
        </Card>
      )}

      {!devices.isLoading && rows.length === 0 && (
        <Card className="bg-card/60 border-dashed p-10 text-center text-muted-foreground">
          Zatiaľ žiadne zariadenia. Založ prvú čítačku — napríklad „Hlavný vchod".
        </Card>
      )}

      {rows.length > 0 && (
        <Card className="bg-card/60 border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Zariadenie</th>
                  <th className="px-4 py-3 font-medium">Typ</th>
                  <th className="px-4 py-3 font-medium">Podujatie</th>
                  <th className="px-4 py-3 font-medium text-right">Skeny</th>
                  <th className="px-4 py-3 font-medium">Naposledy</th>
                  <th className="px-4 py-3 font-medium">Stav</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const Icon = TYPE_ICON[d.device_type];
                  return (
                    <tr key={d.id} className="border-b border-border/30 last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-medium">
                          <Icon className="size-3.5 text-muted-foreground" />
                          {d.name}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {[d.location, d.serial_number].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {TYPE_LABEL[d.device_type]}
                      </td>
                      <td className="px-4 py-3">
                        {d.event_title ?? <span className="text-muted-foreground">všetky</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{d.scans_count || "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {lastSeen(d.last_seen_at)}
                      </td>
                      <td className="px-4 py-3">
                        {d.status === "active" ? (
                          <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 text-[10px]">
                            v prevádzke
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            odstavené
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => setEditing(toForm(d))}>
                            <Pencil className="size-3.5 mr-1.5" /> Upraviť
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm(`Zmazať zariadenie ${d.name}?`))
                                deleteMutation.mutate(d.id);
                            }}
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
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Upraviť zariadenie" : "Nové zariadenie"}</DialogTitle>
            <DialogDescription>
              Názov uvidí obsluha pri výbere čítačky a zapíše sa ku každému skenu.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Názov</Label>
                <Input
                  placeholder="Hlavný vchod"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Typ</Label>
                <Select
                  value={editing.device_type}
                  onValueChange={(v) => setEditing({ ...editing, device_type: v as DeviceType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEVICE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Stav</Label>
                <Select
                  value={editing.status}
                  onValueChange={(v) => setEditing({ ...editing, status: v as Form["status"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">V prevádzke</SelectItem>
                    <SelectItem value="inactive">Odstavené</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Umiestnenie</Label>
                <Input
                  placeholder="Foyer, vpravo od pokladne"
                  value={editing.location}
                  onChange={(e) => setEditing({ ...editing, location: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Sériové číslo</Label>
                <Input
                  className="font-mono"
                  value={editing.serial_number}
                  onChange={(e) => setEditing({ ...editing, serial_number: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Používa sa na</Label>
                <Select
                  value={editing.event_id}
                  onValueChange={(v) => setEditing({ ...editing, event_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_EVENTS}>Všetky podujatia</SelectItem>
                    {events.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Poznámka</Label>
                <Textarea
                  rows={2}
                  placeholder="napr. požičané od dodávateľa, vrátiť do konca sezóny"
                  value={editing.note}
                  onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Zrušiť
            </Button>
            <Button
              onClick={() => editing && saveMutation.mutate(editing)}
              disabled={saveMutation.isPending || !editing?.name.trim()}
            >
              {saveMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Uložiť
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
