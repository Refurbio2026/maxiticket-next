// Zrušenie podujatia. Pred potvrdením ukáže, koho a koľko peňazí sa to týka —
// hromadný refund je nevratná operácia a obsluha má vedieť, do čoho ide.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  cancelEvent,
  previewEventCancellation,
  type ZruseniePodujatiaVysledok,
} from "@/lib/event-cancellation.functions";
import type { EventRecord } from "@/hooks/use-events";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Loader2 } from "lucide-react";
import { errorMessage } from "@/lib/error-message";

type Nahlad = { objednavok: number; suma: number; vstupeniek: number; emailov: number };

export function CancelEventDialog({
  event,
  onOpenChange,
}: {
  event: EventRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const nacitajNahlad = useServerFn(previewEventCancellation);
  const zrus = useServerFn(cancelEvent);

  const [terminId, setTerminId] = useState<string>("all");
  const [dovod, setDovod] = useState("");
  const [refundovat, setRefundovat] = useState(true);
  const [upovedomit, setUpovedomit] = useState(true);
  const [nahlad, setNahlad] = useState<Nahlad | null>(null);
  const [bezi, setBezi] = useState(false);
  const [vysledok, setVysledok] = useState<ZruseniePodujatiaVysledok | null>(null);

  // Pri každom otvorení a pri zmene termínu si vypýtame čerstvý náhľad —
  // medzitým mohol niekto dokúpiť.
  useEffect(() => {
    if (!event) {
      setNahlad(null);
      setVysledok(null);
      setDovod("");
      setTerminId("all");
      return;
    }
    let zrusene = false;
    nacitajNahlad({
      data: { event_id: event.id, event_date_id: terminId === "all" ? null : terminId },
    })
      .then((r) => !zrusene && setNahlad(r))
      .catch(() => !zrusene && setNahlad(null));
    return () => {
      zrusene = true;
    };
  }, [event, terminId, nacitajNahlad]);

  const potvrd = async () => {
    if (!event || !dovod.trim()) return;
    setBezi(true);
    try {
      const r = await zrus({
        data: {
          event_id: event.id,
          event_date_id: terminId === "all" ? null : terminId,
          reason: dovod.trim(),
          refund: refundovat,
          notify: upovedomit,
        },
      });
      setVysledok(r);
      await qc.invalidateQueries({ queryKey: ["events"] });
      toast.success(
        r.zlyhalo.length === 0
          ? `Zrušené. Vrátených ${r.vratenych} z ${r.objednavok} objednávok.`
          : `Zrušené, ale ${r.zlyhalo.length} refundov neprešlo.`,
      );
    } catch (e) {
      toast.error(errorMessage(e) || "Zrušenie zlyhalo");
    } finally {
      setBezi(false);
    }
  };

  const terminy = event?.dates ?? [];

  return (
    <Dialog open={!!event} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Zrušiť podujatie</DialogTitle>
          <DialogDescription>{event?.title}</DialogDescription>
        </DialogHeader>

        {vysledok ? (
          <div className="space-y-3 text-sm">
            <p>
              Zrušené. Vrátených <strong>{vysledok.vratenych}</strong> z{" "}
              <strong>{vysledok.objednavok}</strong> objednávok, spolu{" "}
              <strong>{vysledok.vratenaSuma.toFixed(2)} €</strong>. Upovedomených{" "}
              {vysledok.upovedomenych}.
            </p>
            {vysledok.rucne.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <div className="font-medium text-amber-500">
                  {vysledok.rucne.length} platieb treba vrátiť ručne
                </div>
                <p className="text-xs text-muted-foreground mt-1">{vysledok.rucne[0].poznamka}</p>
              </div>
            )}
            {vysledok.zlyhalo.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <div className="font-medium text-destructive">
                  {vysledok.zlyhalo.length} refundov neprešlo
                </div>
                <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  {vysledok.zlyhalo.slice(0, 5).map((z) => (
                    <li key={z.order_id}>
                      {z.order_id.slice(0, 8).toUpperCase()} — {z.dovod}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground mt-2">
                  Spusti zrušenie znovu — už vrátené objednávky sa preskočia.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {terminy.length > 1 && (
              <div className="space-y-1.5">
                <Label className="text-sm">Čo sa ruší</Label>
                <Select value={terminId} onValueChange={setTerminId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Celé podujatie ({terminy.length} termínov)</SelectItem>
                    {terminy.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {new Date(d.event_date).toLocaleDateString("sk")} · {d.event_time}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex gap-2">
                <AlertTriangle className="size-4 shrink-0 text-amber-500 mt-0.5" />
                <div className="text-sm">
                  {nahlad ? (
                    <>
                      Týka sa to <strong>{nahlad.objednavok}</strong> zaplatených objednávok,{" "}
                      <strong>{nahlad.vstupeniek}</strong> vstupeniek a{" "}
                      <strong>{nahlad.suma.toFixed(2)} €</strong>. E-mail dostane {nahlad.emailov}{" "}
                      ľudí.
                    </>
                  ) : (
                    "Zisťujem, koho sa to týka…"
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Dôvod pre zákazníka</Label>
              <Textarea
                rows={3}
                value={dovod}
                onChange={(e) => setDovod(e.target.value)}
                placeholder="Napríklad: Koncert sa ruší pre chorobu účinkujúceho."
              />
              <p className="text-[11px] text-muted-foreground">
                Tento text príde ľuďom do e-mailu, tak ho píš pre nich.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={refundovat} onCheckedChange={(v) => setRefundovat(v === true)} />
              Vrátiť peniaze
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={upovedomit} onCheckedChange={(v) => setUpovedomit(v === true)} />
              Poslať zákazníkom e-mail
            </label>
          </div>
        )}

        <DialogFooter>
          {vysledok ? (
            <Button onClick={() => onOpenChange(false)}>Zavrieť</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={bezi}>
                Späť
              </Button>
              <Button variant="destructive" onClick={potvrd} disabled={bezi || !dovod.trim()}>
                {bezi && <Loader2 className="size-4 mr-2 animate-spin" />}
                {refundovat ? "Zrušiť a vrátiť peniaze" : "Zrušiť bez refundu"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
