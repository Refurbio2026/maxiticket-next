import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  useEvents,
  useUpsertEvent,
  useDeleteEvent,
  toEventInput,
  type EventRecord,
} from "@/hooks/use-events";
import { useLayouts } from "@/hooks/use-layouts";
import { EventFormDialog } from "@/components/events/EventFormDialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Plus, Sparkles, ExternalLink, QrCode, Loader2, Pencil } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { renderEventTicketsPdf } from "@/lib/ticket-pdf.functions";
import { downloadBase64 } from "@/lib/download";

export const Route = createFileRoute("/admin/events/events")({
  head: () => ({ meta: [{ title: "Podujatia · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  // Admin vidí všetky podujatia vrátane konceptov (vynucuje to server podľa roly).
  const { data: events = [] } = useEvents({ scope: "all" });
  const upsert = useUpsertEvent();
  const del = useDeleteEvent();
  const { data: layouts = [] } = useLayouts();
  // `event: null` = zakladá sa nové podujatie.
  const [dialog, setDialog] = useState<{ open: boolean; event: EventRecord | null }>({
    open: false,
    event: null,
  });
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
        group_id: "",
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
          <Button
            onClick={() => setDialog({ open: true, event: null })}
            className="gap-1.5 bg-gradient-flame text-primary-foreground"
          >
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
                    {e.dates && e.dates.length > 1 && (
                      <Link
                        to="/admin/events/dates"
                        className="ml-2 text-primary hover:underline whitespace-nowrap"
                      >
                        +{e.dates.length - 1} ďalších
                      </Link>
                    )}
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
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => setDialog({ open: true, event: e })}
                    >
                      <Pencil className="size-3.5" /> Upraviť
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

      <EventFormDialog
        mode="admin"
        open={dialog.open}
        event={dialog.event}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </div>
  );
}
