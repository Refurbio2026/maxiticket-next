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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Loader2, RefreshCw, Search, X } from "lucide-react";
import {
  listOmPredaj,
  rozhodniOmVazbu,
  navrhniOmMapovanie,
  type OmPredajRiadok,
} from "@/lib/om-mapovanie.functions";

export const Route = createFileRoute("/admin/eticketo/om-predaj")({
  head: () => ({ meta: [{ title: "Starý systém · eticketo.eu Admin" }] }),
  component: Page,
});

const STAV_POPIS: Record<string, { text: string; variant: "default" | "secondary" | "outline" }> = {
  confirmed: { text: "potvrdené", variant: "default" },
  suggested: { text: "návrh", variant: "secondary" },
  rejected: { text: "bez náprotivku", variant: "outline" },
  unmapped: { text: "nespárované", variant: "outline" },
};

function eur(n: number) {
  return new Intl.NumberFormat("sk-SK", { style: "currency", currency: "EUR" }).format(n);
}

function cas(t: string | null) {
  return t ? t.slice(0, 5) : "";
}

export default function Page() {
  const qc = useQueryClient();
  const nacitaj = useServerFn(listOmPredaj);
  const rozhodni = useServerFn(rozhodniOmVazbu);
  const navrhni = useServerFn(navrhniOmMapovanie);

  const [hladaj, setHladaj] = useState("");
  const [mapovanie, setMapovanie] = useState<string>("vsetko");
  const [lenSPredajom, setLenSPredajom] = useState(true);

  const predaj = useQuery({
    queryKey: ["om-predaj", hladaj, mapovanie, lenSPredajom],
    queryFn: () =>
      nacitaj({
        data: {
          hladaj: hladaj || undefined,
          mapovanie: mapovanie as "vsetko",
          len_s_predajom: lenSPredajom,
          limit: 200,
        },
      }),
  });

  const rozhodnutie = useMutation({
    mutationFn: (v: { id_plan: number; rozhodnutie: "confirmed" | "rejected" }) =>
      rozhodni({ data: v }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["om-predaj"] });
      toast.success(
        v.rozhodnutie === "confirmed"
          ? "Väzba potvrdená — skener túto vstupenku už prijme"
          : "Označené ako bez náprotivku",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Nepodarilo sa uložiť"),
  });

  const doplnNavrhy = useMutation({
    mutationFn: () => navrhni({}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["om-predaj"] });
      toast.success(
        r.pridanych ? `Pribudlo ${r.pridanych} návrhov` : "Žiadne nové návrhy — všetko je posúdené",
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Nepodarilo sa"),
  });

  const suhrn = predaj.data?.suhrn;
  const riadky = predaj.data?.riadky ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Starý systém</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Predaj z MaxiTicket OM. Organizátori tam účty nemali — sú to záznamy, nie používatelia.
            Tržba je <strong>vrátane DPH</strong>.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => doplnNavrhy.mutate()}
          disabled={doplnNavrhy.isPending}
        >
          {doplnNavrhy.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Doplniť návrhy
        </Button>
      </div>

      {suhrn && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card className="p-4">
            <div className="text-muted-foreground text-xs">Podujatí</div>
            <div className="text-2xl font-semibold">{suhrn.podujati}</div>
          </Card>
          <Card className="p-4">
            <div className="text-muted-foreground text-xs">Predaných vstupeniek</div>
            <div className="text-2xl font-semibold">{suhrn.predanych.toLocaleString("sk-SK")}</div>
          </Card>
          <Card className="p-4">
            <div className="text-muted-foreground text-xs">Tržba s DPH</div>
            <div className="text-2xl font-semibold">{eur(suhrn.trzba_s_dph)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-muted-foreground text-xs">Čaká na potvrdenie</div>
            <div className="text-2xl font-semibold">{suhrn.navrhov}</div>
          </Card>
          <Card className="p-4">
            <div className="text-muted-foreground text-xs">Potvrdených väzieb</div>
            <div className="text-2xl font-semibold">{suhrn.potvrdenych}</div>
          </Card>
        </div>
      )}

      {suhrn?.potvrdenych === 0 && suhrn.navrhov > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          Skener zatiaľ starú vstupenku neprijme — vpustí ju až potvrdená väzba. Návrh je odhad
          podľa názvu, dátumu a času; potvrdením zaň preberáš zodpovednosť.
        </Card>
      )}

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Label htmlFor="hladaj">Podujatie alebo organizátor</Label>
            <div className="relative">
              <Search className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
              <Input
                id="hladaj"
                className="pl-8"
                value={hladaj}
                onChange={(e) => setHladaj(e.target.value)}
                placeholder="napr. Bábkové divadlo"
              />
            </div>
          </div>
          <div className="w-48">
            <Label>Stav väzby</Label>
            <Select value={mapovanie} onValueChange={setMapovanie}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vsetko">Všetko</SelectItem>
                <SelectItem value="suggested">Čaká na potvrdenie</SelectItem>
                <SelectItem value="confirmed">Potvrdené</SelectItem>
                <SelectItem value="unmapped">Bez náprotivku</SelectItem>
                <SelectItem value="rejected">Odmietnuté</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant={lenSPredajom ? "default" : "outline"}
            onClick={() => setLenSPredajom((v) => !v)}
          >
            Len s predajom
          </Button>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3 font-medium">Podujatie</th>
              <th className="p-3 font-medium">Organizátor</th>
              <th className="p-3 text-right font-medium">Predaných</th>
              <th className="p-3 text-right font-medium">Tržba s DPH</th>
              <th className="p-3 text-right font-medium">Naskenovaných</th>
              <th className="p-3 font-medium">Väzba na eticketo</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {predaj.isLoading && (
              <tr>
                <td colSpan={7} className="text-muted-foreground p-6 text-center">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Načítavam…
                </td>
              </tr>
            )}
            {!predaj.isLoading && riadky.length === 0 && (
              <tr>
                <td colSpan={7} className="text-muted-foreground p-6 text-center">
                  Nič nesedí na filter.
                </td>
              </tr>
            )}
            {riadky.map((r: OmPredajRiadok) => {
              const stav = STAV_POPIS[r.mapovanie] ?? STAV_POPIS.unmapped;
              return (
                <tr key={r.id_plan} className="border-t">
                  <td className="p-3">
                    <div className="font-medium">{r.drama_name ?? `plán ${r.id_plan}`}</div>
                    <div className="text-muted-foreground text-xs">
                      {r.datum} {cas(r.start_time)} · {r.hall_name ?? "—"}
                    </div>
                  </td>
                  <td className="text-muted-foreground max-w-56 truncate p-3 text-xs">
                    {r.promoter ?? "—"}
                  </td>
                  <td className="p-3 text-right tabular-nums">{r.predanych}</td>
                  <td className="p-3 text-right tabular-nums">{eur(Number(r.trzba_s_dph))}</td>
                  <td className="p-3 text-right tabular-nums">{r.naskenovanych}</td>
                  <td className="p-3">
                    <Badge variant={stav.variant}>{stav.text}</Badge>
                    {r.nase_podujatie && (
                      <div className="text-muted-foreground mt-1 text-xs">
                        {r.nase_podujatie}
                        {r.nas_datum ? ` · ${r.nas_datum} ${cas(r.nas_cas)}` : ""}
                        {r.confidence != null ? ` · istota ${r.confidence}` : ""}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {r.mapovanie === "suggested" && (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          disabled={rozhodnutie.isPending}
                          onClick={() =>
                            rozhodnutie.mutate({ id_plan: r.id_plan, rozhodnutie: "confirmed" })
                          }
                        >
                          <Check className="mr-1 h-4 w-4" />
                          Potvrdiť
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rozhodnutie.isPending}
                          onClick={() =>
                            rozhodnutie.mutate({ id_plan: r.id_plan, rozhodnutie: "rejected" })
                          }
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
