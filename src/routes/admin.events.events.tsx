import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type SaleType } from "@/lib/local-db";
import {
  useEvents,
  useUpsertEvent,
  useDeleteEvent,
  toEventInput,
  type EventRecord,
} from "@/hooks/use-events";
import { useLayouts } from "@/hooks/use-layouts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Sparkles, ExternalLink, QrCode, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { renderEventTicketsPdf } from "@/lib/ticket-pdf.functions";
import { downloadBase64 } from "@/lib/download";

export const Route = createFileRoute("/admin/events/events")({
  head: () => ({ meta: [{ title: "Podujatia · vipky.sk Admin" }] }),
  component: Page,
});

const CATEGORIES = [
  "Koncert",
  "Festival",
  "Šport",
  "Divadlo",
  "Konferencia",
  "Stand-up",
  "Kultúra",
];

type FormState = {
  title: string;
  category: string;
  organizer_name: string;
  event_date: string;
  event_time: string;
  venue: string;
  city: string;
  description: string;
  image_url: string;
  status: "draft" | "published";
  sale_type: SaleType;
  venue_layout_id: string;
  base_price: string;
  vip_price: string;
  total_tickets: string;
};

const blankForm = (): FormState => ({
  title: "",
  category: "Koncert",
  organizer_name: "",
  event_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  event_time: "19:00",
  venue: "",
  city: "",
  description: "",
  image_url: "",
  status: "published",
  sale_type: "seating_map",
  venue_layout_id: "",
  base_price: "25",
  vip_price: "55",
  total_tickets: "100",
});

function Page() {
  // Admin vidí všetky podujatia vrátane konceptov (vynucuje to server podľa roly).
  const { data: events = [] } = useEvents({ scope: "all" });
  const upsert = useUpsertEvent();
  const del = useDeleteEvent();
  const { data: layouts = [] } = useLayouts();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm());
  const [qrLoading, setQrLoading] = useState<string | null>(null);
  const renderPdf = useServerFn(renderEventTicketsPdf);

  const downloadQrs = async (e: EventRecord) => {
    setQrLoading(e.id);
    try {
      // Server overí vlastníctvo podujatia a vráti hotové PDF — QR kódy
      // ani údaje kupujúcich sa tak nedostanú k nepovolanému.
      const res = await renderPdf({ data: { event_id: e.id } });
      downloadBase64(res.filename, res.base64);
      toast.success("PDF s vstupenkami stiahnuté.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Nepodarilo sa vygenerovať PDF.");
    } finally {
      setQrLoading(null);
    }
  };

  const setStatus = async (e: EventRecord, status: "draft" | "published") => {
    try {
      await upsert.mutateAsync(toEventInput(e, { status }));
      toast.success(status === "published" ? "Publikované" : "Stiahnuté ako koncept");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Zmena stavu zlyhala");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Naozaj zmazať podujatie?")) return;
    try {
      await del.mutateAsync(id);
      toast.success("Zmazané");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Zmazanie zlyhalo");
    }
  };

  const openNew = () => {
    const fresh = blankForm();
    if (layouts.length > 0) fresh.venue_layout_id = layouts[0].id;
    setForm(fresh);
    setOpen(true);
  };

  const submit = async () => {
    if (!form.title.trim()) return toast.error("Vyplň názov podujatia");
    if (!form.venue.trim() || !form.city.trim()) return toast.error("Vyplň miesto konania a mesto");
    if (form.sale_type === "seating_map" && !form.venue_layout_id) {
      return toast.error("Vyber rozloženie haly z Editora hál");
    }
    try {
      await upsert.mutateAsync({
        title: form.title.trim(),
        category: form.category,
        event_date: form.event_date,
        event_time: form.event_time,
        venue: form.venue.trim(),
        city: form.city.trim(),
        description: form.description.trim() || null,
        image_url: form.image_url.trim() || null,
        status: form.status,
        sale_type: form.sale_type,
        venue_layout_id: form.sale_type === "seating_map" ? form.venue_layout_id : null,
        base_price: Number(form.base_price) || 0,
        vip_price: Number(form.vip_price) || 0,
        total_tickets: Number(form.total_tickets) || 0,
        tickets: [
          {
            name: "Štandard",
            price: Number(form.base_price) || 0,
            quantity: Number(form.total_tickets) || 0,
          },
        ],
      });
      setOpen(false);
      toast.success("Podujatie vytvorené");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Podujatie sa nepodarilo vytvoriť");
    }
  };

  const seedTest = async () => {
    if (layouts.length === 0) {
      toast.error("Najprv vytvor rozloženie haly v Editore hál.");
      return;
    }
    const layout = layouts[0];
    try {
      await upsert.mutateAsync({
        title: "Test koncert s mapou sedenia",
        category: "Koncert",
        event_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
        event_time: "20:00",
        venue: layout.name,
        city: layout.city || "Bratislava",
        description:
          "Testovacie podujatie vytvorené pre overenie celého predajného flow s mapou sedenia.",
        image_url: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1600&q=80",
        status: "published",
        sale_type: "seating_map",
        venue_layout_id: layout.id,
        base_price: 25,
        vip_price: 55,
        total_tickets: 100,
        tickets: [{ name: "Štandard", price: 25, quantity: 100 }],
      });
      toast.success("Testovacie podujatie vytvorené a publikované");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Testovacie podujatie sa nepodarilo vytvoriť",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Podujatia</h1>
          <p className="text-muted-foreground mt-1">Všetky podujatia v systéme.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={seedTest} className="gap-1.5">
            <Sparkles className="size-4" /> Test koncert s mapou sedenia
          </Button>
          <Button onClick={openNew} className="gap-1.5 bg-gradient-flame text-primary-foreground">
            <Plus className="size-4" /> Pridať podujatie
          </Button>
        </div>
      </div>

      {events.length === 0 ? (
        <Card className="p-12 text-center bg-card/60 border-dashed">
          <div className="font-semibold">Žiadne podujatia</div>
          <p className="text-sm text-muted-foreground mt-1">
            Použi tlačidlo „Pridať podujatie" alebo vytvor testovacie.
          </p>
        </Card>
      ) : (
        <Card className="bg-card/60 border-border/50 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border/40">
                <th className="text-left p-3">Názov</th>
                <th className="text-left p-3">Kategória</th>
                <th className="text-left p-3">Dátum</th>
                <th className="text-left p-3">Typ</th>
                <th className="text-left p-3">Stav</th>
                <th className="text-right p-3">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-border/20 hover:bg-muted/10">
                  <td className="p-3 font-medium">{e.title}</td>
                  <td className="p-3 text-muted-foreground">{e.category}</td>
                  <td className="p-3 text-muted-foreground">
                    {e.event_date} · {e.event_time}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {e.sale_type === "seating_map"
                      ? "Mapa sedenia"
                      : e.sale_type === "seating"
                        ? "Sedenie"
                        : e.sale_type === "standing"
                          ? "Státie"
                          : "—"}
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        e.status === "published"
                          ? "bg-primary/15 text-primary border-primary/30"
                          : "bg-muted text-muted-foreground border-border/50"
                      }`}
                    >
                      {e.status === "published" ? "Publikované" : "Koncept"}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-1">
                    <Link to="/events/$id" params={{ id: e.id }} target="_blank">
                      <Button size="sm" variant="ghost" className="gap-1">
                        <ExternalLink className="size-3.5" />
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => downloadQrs(e)}
                      disabled={qrLoading === e.id}
                      title="Stiahnuť QR kódy predaných lístkov (PDF)"
                    >
                      {qrLoading === e.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <QrCode className="size-3.5" />
                      )}
                      QR lístky
                    </Button>
                    {e.status === "draft" ? (
                      <Button size="sm" variant="outline" onClick={() => setStatus(e, "published")}>
                        Publikovať
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setStatus(e, "draft")}>
                        Stiahnuť
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(e.id)}
                    >
                      Zmazať
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nové podujatie</DialogTitle>
          </DialogHeader>
          <div className="grid sm:grid-cols-2 gap-4 py-2">
            <Field label="Názov podujatia" className="sm:col-span-2">
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="Kategória">
              <Select
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Organizátor">
              <Input
                value={form.organizer_name}
                onChange={(e) => setForm({ ...form, organizer_name: e.target.value })}
                placeholder="Demo Organizátor"
              />
            </Field>
            <Field label="Dátum">
              <Input
                type="date"
                value={form.event_date}
                onChange={(e) => setForm({ ...form, event_date: e.target.value })}
              />
            </Field>
            <Field label="Čas začiatku">
              <Input
                type="time"
                value={form.event_time}
                onChange={(e) => setForm({ ...form, event_time: e.target.value })}
              />
            </Field>
            <Field label="Miesto konania">
              <Input
                value={form.venue}
                onChange={(e) => setForm({ ...form, venue: e.target.value })}
              />
            </Field>
            <Field label="Mesto">
              <Input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </Field>
            <Field label="URL obrázka" className="sm:col-span-2">
              <Input
                value={form.image_url}
                onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                placeholder="https://…"
              />
            </Field>
            <Field label="Popis" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <Field label="Stav">
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as "draft" | "published" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Koncept</SelectItem>
                  <SelectItem value="published">Publikované</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Typ predaja">
              <Select
                value={form.sale_type}
                onValueChange={(v) => setForm({ ...form, sale_type: v as SaleType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standing">Státie</SelectItem>
                  <SelectItem value="seating">Sedenie</SelectItem>
                  <SelectItem value="seating_map">Sedenie s mapou</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.sale_type === "seating_map" && (
              <Field label="Rozloženie haly" className="sm:col-span-2">
                {layouts.length === 0 ? (
                  <div className="text-xs text-destructive">
                    Žiadne rozloženie. Vytvor ho v{" "}
                    <Link to="/admin/events/venue-layouts" className="underline">
                      Editore hál
                    </Link>
                    .
                  </div>
                ) : (
                  <Select
                    value={form.venue_layout_id}
                    onValueChange={(v) => setForm({ ...form, venue_layout_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Vyber rozloženie" />
                    </SelectTrigger>
                    <SelectContent>
                      {layouts.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}
            <Field label="Cena vstupenky (€)">
              <Input
                type="number"
                min={0}
                step={0.5}
                value={form.base_price}
                onChange={(e) => setForm({ ...form, base_price: e.target.value })}
              />
            </Field>
            <Field label="VIP cena (€)">
              <Input
                type="number"
                min={0}
                step={0.5}
                value={form.vip_price}
                onChange={(e) => setForm({ ...form, vip_price: e.target.value })}
              />
            </Field>
            <Field label="Počet vstupeniek">
              <Input
                type="number"
                min={0}
                step={1}
                value={form.total_tickets}
                onChange={(e) => setForm({ ...form, total_tickets: e.target.value })}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Zrušiť
            </Button>
            <Button onClick={submit} className="bg-gradient-flame text-primary-foreground">
              Uložiť podujatie
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
