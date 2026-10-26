// Zásielky na podaj (Slovenská pošta).
//
// Odpovedá na otázku „čo mám dnes odniesť na poštu?". Postup je zámerne
// v tomto poradí:
//   1. vytlačiť štítky a zalepiť obálky,
//   2. až potom vytvoriť ePodací hárok — od jeho vytvorenia beží desaťdňová
//      lehota na podaj a po nej ho pošta zmaže,
//   3. po podaji si vyžiadať podacie čísla, aby sa dalo zásielku dohľadať.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Printer, RefreshCw, Send, Truck } from "lucide-react";
import {
  dopytajPodacieCisla,
  listZasielky,
  stitkyZasielok,
  vytvorHarok,
  type ZasielkaRiadok,
} from "@/lib/posta/zasielky.functions";
import { downloadBase64 } from "@/lib/download";
import { errorMessage } from "@/lib/error-message";

export const Route = createFileRoute("/admin/sales/posta")({
  head: () => ({ meta: [{ title: "Zásielky · eticketo.eu Admin" }] }),
  component: Page,
});

const eur = (n: number) =>
  `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const datum = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("sk-SK", { day: "numeric", month: "numeric" }) : "—";

function Page() {
  const qc = useQueryClient();
  const nacitaj = useServerFn(listZasielky);
  const tlac = useServerFn(stitkyZasielok);
  const podaj = useServerFn(vytvorHarok);
  const dopytaj = useServerFn(dopytajPodacieCisla);

  const [podane, setPodane] = useState(false);
  const [vybrane, setVybrane] = useState<Set<string>>(new Set());

  const data = useQuery({
    queryKey: ["zasielky", podane],
    queryFn: () => nacitaj({ data: { podane } }),
  });
  const riadky: ZasielkaRiadok[] = data.data?.riadky ?? [];
  const stavPosty = data.data?.posta;

  const prepni = (id: string) =>
    setVybrane((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const vsetky = () =>
    setVybrane((s) =>
      s.size === riadky.length ? new Set() : new Set(riadky.map((r) => r.order_id)),
    );

  const ids = [...vybrane];

  const tlacStitky = useMutation({
    mutationFn: () => tlac({ data: { order_ids: ids } }),
    onSuccess: (r) => {
      downloadBase64(`stitky-${new Date().toISOString().slice(0, 10)}.pdf`, r.pdf);
      toast.success(`Štítky pre ${r.pocet} zásielok`);
    },
    onError: (e) => toast.error(errorMessage(e) || "Štítky sa nepodarilo vytvoriť"),
  });

  const vytvor = useMutation({
    mutationFn: (nasucho: boolean) => podaj({ data: { order_ids: ids, nasucho } }),
    onSuccess: (r) => {
      if (r.nasucho) {
        toast.success(`Nasucho v poriadku: ${r.pocet} zásielok by odišlo. Nič sa neposlalo.`);
        return;
      }
      toast.success(`Hárok ${r.sheetId} prijatý — ${r.pocet} zásielok.`);
      setVybrane(new Set());
      qc.invalidateQueries({ queryKey: ["zasielky"] });
    },
    onError: (e) => toast.error(errorMessage(e) || "Hárok sa nepodarilo vytvoriť"),
  });

  const cisla = useMutation({
    mutationFn: (sheetId: string) => dopytaj({ data: { sheet_id: sheetId } }),
    onSuccess: (r) => {
      toast.success(
        `Hárok je v stave ${r.stav}. Z ${r.najdenych} zásielok doplnených ${r.doplnene} podacích čísel.`,
      );
      qc.invalidateQueries({ queryKey: ["zasielky"] });
    },
    onError: (e) => toast.error(errorMessage(e) || "Podacie čísla sa nepodarilo zistiť"),
  });

  const harky = [...new Set(riadky.map((r) => r.eph_sheet_id).filter(Boolean))] as string[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Zásielky</h1>
        <p className="text-muted-foreground mt-1">
          Objednávky s doručením poštou. Najprv štítky a obálky, potom ePodací hárok — od jeho
          vytvorenia má podaj lehotu desať dní.
        </p>
      </div>

      {stavPosty && !stavPosty.pripravene && (
        <Card className="p-4 bg-amber-500/10 border-amber-500/30 text-sm">
          <strong>Pošta nie je nastavená:</strong> {stavPosty.detail}{" "}
          <Link to="/admin/system/payments" className="underline">
            Doplniť prístupy
          </Link>
        </Card>
      )}

      <Card className="p-4 bg-card/60 border-border/50 flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          <Button variant={podane ? "outline" : "default"} onClick={() => setPodane(false)}>
            <Truck className="size-4 mr-2" /> Čaká na podaj
          </Button>
          <Button variant={podane ? "default" : "outline"} onClick={() => setPodane(true)}>
            Podané
          </Button>
        </div>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["zasielky"] })}>
          <RefreshCw className="size-4 mr-2" /> Obnoviť
        </Button>
      </Card>

      {!podane && ids.length > 0 && (
        <Card className="p-4 bg-card/60 border-border/50 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Vybraných {ids.length}</span>
          <div className="flex-1" />
          <Button
            variant="outline"
            onClick={() => tlacStitky.mutate()}
            disabled={tlacStitky.isPending}
          >
            <Printer className="size-4 mr-2" /> Štítky na obálky
          </Button>
          {/* Nasucho najprv: poskladá hárok a povie, čo by odišlo, bez toho,
              aby pošte niečo poslal. Pri prvom podaji to chce človek vedieť. */}
          <Button
            variant="outline"
            onClick={() => vytvor.mutate(true)}
            disabled={vytvor.isPending || !stavPosty?.pripravene}
          >
            Skúsiť nasucho
          </Button>
          <Button
            onClick={() => vytvor.mutate(false)}
            disabled={vytvor.isPending || !stavPosty?.pripravene}
            className="bg-gradient-flame text-primary-foreground"
          >
            {vytvor.isPending ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Send className="size-4 mr-2" />
            )}
            Vytvoriť ePodací hárok
          </Button>
        </Card>
      )}

      {podane && harky.length > 0 && (
        <Card className="p-4 bg-card/60 border-border/50 flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">
            Po podaji si vyžiadaj podacie čísla — pošta ich prideľuje až pri spracovaní hárku.
          </span>
          <div className="flex-1" />
          {harky.map((h) => (
            <Button
              key={h}
              variant="outline"
              size="sm"
              onClick={() => cisla.mutate(h)}
              disabled={cisla.isPending}
            >
              Hárok {h}
            </Button>
          ))}
        </Card>
      )}

      <Card className="bg-card/60 border-border/50 overflow-x-auto">
        {data.isLoading ? (
          <div className="p-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : riadky.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            {podane
              ? "Zatiaľ nič podané."
              : "Nič nečaká na podaj. Objednávky s doručením poštou sa tu zjavia po zaplatení."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border/50">
              <tr>
                <th className="p-3 w-10">
                  {!podane && (
                    <Checkbox
                      checked={vybrane.size === riadky.length && riadky.length > 0}
                      onCheckedChange={vsetky}
                    />
                  )}
                </th>
                <th className="text-left p-3">Zaplatené</th>
                <th className="text-left p-3">Adresát</th>
                <th className="text-left p-3">Podujatie</th>
                <th className="text-right p-3">Vstupeniek</th>
                <th className="text-right p-3">Poštovné</th>
                <th className="text-left p-3">{podane ? "Podacie číslo" : "Objednávka"}</th>
              </tr>
            </thead>
            <tbody>
              {riadky.map((r) => (
                <tr key={r.order_id} className="border-b border-border/30 last:border-0">
                  <td className="p-3">
                    {!podane && (
                      <Checkbox
                        checked={vybrane.has(r.order_id)}
                        onCheckedChange={() => prepni(r.order_id)}
                      />
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap text-muted-foreground">
                    {datum(r.paid_at)}
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{r.adresa.meno || "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.adresa.ulica}, {r.adresa.psc} {r.adresa.mesto}
                    </div>
                  </td>
                  <td className="p-3 max-w-[220px] truncate">{r.event_title ?? "—"}</td>
                  <td className="p-3 text-right">{r.pocet_vstupeniek}</td>
                  <td className="p-3 text-right">{eur(r.delivery_fee)}</td>
                  <td className="p-3">
                    {podane ? (
                      r.eph_code ? (
                        <span className="font-mono text-xs">{r.eph_code}</span>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          čaká na číslo
                        </Badge>
                      )
                    ) : (
                      <Link
                        to="/admin/sales/sales"
                        className="font-mono text-xs text-muted-foreground hover:text-foreground"
                      >
                        {r.order_id.slice(0, 8)}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
