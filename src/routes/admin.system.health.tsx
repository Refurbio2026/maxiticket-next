import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOperationsHealth, type Zavada } from "@/lib/health.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Activity } from "lucide-react";

export const Route = createFileRoute("/admin/system/health")({
  head: () => ({ meta: [{ title: "Prevádzka · Admin · vipky.sk" }] }),
  component: HealthPage,
});

function HealthPage() {
  const fetchHealth = useServerFn(getOperationsHealth);
  const q = useQuery({
    queryKey: ["operations-health"],
    queryFn: () => fetchHealth({ data: { hours: 72 } }),
    // Prehľad je na to, aby na ňom mohla byť otvorená karta počas predaja.
    refetchInterval: 60_000,
  });

  if (q.isLoading || !q.data) {
    return (
      <div className="p-10 text-center">
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { zavady, skenNaposledy, posledneChyby } = q.data;
  const chyby = zavady.filter((z) => z.uroven === "chyba");

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">Prevádzka</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Čo sa za posledné tri dni pokazilo a či beží, čo bežať má.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} className="gap-1.5">
          <RefreshCw className={q.isFetching ? "size-4 animate-spin" : "size-4"} /> Obnoviť
        </Button>
      </div>

      {zavady.length === 0 ? (
        <Card className="border-emerald-500/40 bg-emerald-500/5 p-5">
          <div className="flex gap-3">
            <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
            <div className="text-sm">
              <div className="font-medium">Všetko sedí</div>
              <p className="text-muted-foreground mt-1">
                Za posledné tri dni žiadne zlyhania platieb, faktúr ani e-mailov.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {zavady.map((z) => (
            <ZavadaKarta key={z.nazov} zavada={z} />
          ))}
        </div>
      )}

      <Card className="bg-card/60 border-border/50 p-4">
        <div className="flex gap-3 text-sm">
          <Activity className="size-5 shrink-0 text-primary" />
          <div>
            <div className="font-medium">Dopytovací sken</div>
            <p className="text-muted-foreground mt-1">
              {skenNaposledy
                ? `Naposledy zbehol ${new Date(skenNaposledy).toLocaleString("sk")}.`
                : "Zatiaľ nikdy nezbehol — cron pravdepodobne nie je nastavený."}
            </p>
          </div>
        </div>
      </Card>

      {posledneChyby.length > 0 && (
        <Card className="bg-card/60 border-border/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40 text-sm font-medium">
            Posledné chyby ({chyby.length > 0 ? "najnovšie hore" : "len záznam"})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="text-left p-3 font-medium">Kedy</th>
                  <th className="text-left p-3 font-medium">Kde</th>
                  <th className="text-left p-3 font-medium">Objednávka</th>
                  <th className="text-left p-3 font-medium">Čo sa stalo</th>
                </tr>
              </thead>
              <tbody>
                {posledneChyby.map((r, i) => (
                  <tr key={`${r.kedy}-${i}`} className="border-b border-border/20">
                    <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(r.kedy).toLocaleString("sk")}
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-muted-foreground">
                        {r.zdroj}
                      </Badge>
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {r.order_id ? r.order_id.slice(0, 8).toUpperCase() : "—"}
                    </td>
                    <td className="p-3 text-xs">{r.sprava || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ZavadaKarta({ zavada }: { zavada: Zavada }) {
  const jeChyba = zavada.uroven === "chyba";
  return (
    <Card
      className={
        jeChyba
          ? "border-destructive/50 bg-destructive/5 p-4"
          : "border-amber-500/50 bg-amber-500/5 p-4"
      }
    >
      <div className="flex gap-3">
        <AlertTriangle
          className={
            jeChyba ? "size-5 shrink-0 text-destructive" : "size-5 shrink-0 text-amber-500"
          }
        />
        <div className="text-sm">
          <div className="font-medium">
            {zavada.nazov}
            {zavada.pocet > 0 && (
              <span className="text-muted-foreground font-normal"> · {zavada.pocet}×</span>
            )}
          </div>
          <p className="text-muted-foreground mt-1">{zavada.detail}</p>
        </div>
      </div>
    </Card>
  );
}
