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

      <Card className="p-3 sm:p-4 bg-card/60 border-border/50 flex items-center gap-2 sm:gap-3">
        {/* Na telefóne si prepínač rozdelí šírku na polovice — dva malé
            terčíky vedľa seba sa na dotyk míňajú. */}
        <div className="flex flex-1 gap-2 sm:flex-initial">
          <Button
            variant={podane ? "outline" : "default"}
            onClick={() => setPodane(false)}
            className="flex-1 sm:flex-initial"
          >
            <Truck className="size-4 mr-2" /> Čaká na podaj
          </Button>
          <Button
            variant={podane ? "default" : "outline"}
            onClick={() => setPodane(true)}
            className="flex-1 sm:flex-initial"
          >
            Podané
          </Button>
        </div>
        <div className="hidden sm:block sm:flex-1" />
        <Button
          variant="outline"
          onClick={() => qc.invalidateQueries({ queryKey: ["zasielky"] })}
          aria-label="Obnoviť"
          className="shrink-0"
        >
          <RefreshCw className="size-4 sm:mr-2" />
          <span className="hidden sm:inline">Obnoviť</span>
        </Button>
      </Card>

      {!podane && ids.length > 0 && (
        // Na telefóne lišta drží pri spodku obrazovky: zásielky sa vyberajú
        // scrollovaním a tlačidlo podaja by inak zostalo niekde nad hlavou.
        <Card className="p-3 sm:p-4 bg-card/95 sm:bg-card/60 border-border/50 backdrop-blur sm:backdrop-blur-none sticky bottom-3 z-20 sm:static shadow-lg sm:shadow-none flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
          <div className="flex items-center justify-between sm:block">
            <span className="text-sm font-medium">Vybraných {ids.length}</span>
            <button
              onClick={() => setVybrane(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground sm:hidden"
            >
              Zrušiť výber
            </button>
          </div>
          <div className="hidden sm:block sm:flex-1" />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
            <Button
              variant="outline"
              onClick={() => tlacStitky.mutate()}
              disabled={tlacStitky.isPending}
            >
              <Printer className="size-4 mr-2" /> Štítky
            </Button>
            {/* Nasucho najprv: poskladá hárok a povie, čo by odišlo, bez toho,
                aby pošte niečo poslal. Pri prvom podaji to chce človek vedieť. */}
            <Button
              variant="outline"
              onClick={() => vytvor.mutate(true)}
              disabled={vytvor.isPending || !stavPosty?.pripravene}
            >
              Nasucho
            </Button>
          </div>
          <Button
            onClick={() => vytvor.mutate(false)}
            disabled={vytvor.isPending || !stavPosty?.pripravene}
            className="bg-gradient-flame text-primary-foreground w-full sm:w-auto"
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
        <Card className="p-3 sm:p-4 bg-card/60 border-border/50 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
          <span className="text-sm text-muted-foreground">
            Po podaji si vyžiadaj podacie čísla — pošta ich prideľuje až pri spracovaní hárku.
          </span>
          <div className="hidden sm:block sm:flex-1" />
          <div className="flex flex-wrap gap-2">
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
          </div>
        </Card>
      )}

      {data.isLoading ? (
        <Card className="p-10 text-center bg-card/60 border-border/50">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        </Card>
      ) : riadky.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground bg-card/60 border-border/50">
          {podane
            ? "Zatiaľ nič podané."
            : "Nič nečaká na podaj. Objednávky s doručením poštou sa tu zjavia po zaplatení."}
        </Card>
      ) : (
        <>
          {/* TELEFÓN — karty.
              Tabuľka so siedmimi stĺpcami sa do 360 bodov nezmestí a vodorovné
              posúvanie znamená, že adresu si človek prečíta až po scrollovaní.
              Na obálku ju pritom prepisuje z obrazovky, takže musí byť vidieť
              celá naraz. Celá karta je zároveň terč na výber — nie len malý
              štvorček pri okraji. */}
          <div className="space-y-3 md:hidden">
            {!podane && (
              <button
                onClick={vsetky}
                className="w-full text-xs text-muted-foreground hover:text-foreground text-right px-1"
              >
                {vybrane.size === riadky.length ? "Odznačiť všetky" : "Označiť všetky"}
              </button>
            )}
            {riadky.map((r) => {
              const oznacena = vybrane.has(r.order_id);
              return (
                <Card
                  key={r.order_id}
                  // Výber obsluhuje celá karta. Zaškrtávadlo je preto len
                  // obrázok stavu (`pointer-events-none`) — keby reagovalo
                  // samo, kliknutie priamo naň by sa spočítalo dvakrát
                  // (raz zaškrtávadlo, raz karta pod ním) a výber by sa
                  // hneď zrušil.
                  role={podane ? undefined : "button"}
                  tabIndex={podane ? undefined : 0}
                  aria-pressed={podane ? undefined : oznacena}
                  onClick={() => !podane && prepni(r.order_id)}
                  onKeyDown={(e) => {
                    if (podane) return;
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      prepni(r.order_id);
                    }
                  }}
                  className={`p-4 border transition-colors ${
                    oznacena ? "border-primary bg-primary/5" : "bg-card/60 border-border/50"
                  } ${podane ? "" : "cursor-pointer"}`}
                >
                  <div className="flex items-start gap-3">
                    {!podane && (
                      <Checkbox
                        checked={oznacena}
                        tabIndex={-1}
                        aria-hidden
                        className="mt-0.5 shrink-0 pointer-events-none"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      {/* Adresa v tvare, v akom ide na obálku. */}
                      <div className="font-medium leading-snug">{r.adresa.meno || "—"}</div>
                      <div className="text-sm text-muted-foreground leading-snug">
                        {r.adresa.ulica}
                      </div>
                      <div className="text-sm text-muted-foreground leading-snug">
                        {r.adresa.psc} {r.adresa.mesto}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline" className="font-normal">
                          {r.pocet_vstupeniek}× vstupenka
                        </Badge>
                        <Badge variant="outline" className="font-normal">
                          {eur(r.delivery_fee)}
                        </Badge>
                        <span className="text-muted-foreground">zapl. {datum(r.paid_at)}</span>
                      </div>

                      {r.event_title && (
                        <div className="mt-2 text-xs text-muted-foreground truncate">
                          {r.event_title}
                        </div>
                      )}

                      <div className="mt-2 text-xs">
                        {podane ? (
                          r.eph_code ? (
                            <span className="font-mono">{r.eph_code}</span>
                          ) : (
                            <span className="text-muted-foreground">čaká na podacie číslo</span>
                          )
                        ) : (
                          <span className="font-mono text-muted-foreground">
                            obj. {r.order_id.slice(0, 8)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* TABLET A VIAC — tabuľka, tam sa vedľa seba prečíta viac riadkov. */}
          <Card className="hidden md:block bg-card/60 border-border/50 overflow-x-auto">
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
          </Card>
        </>
      )}
    </div>
  );
}
