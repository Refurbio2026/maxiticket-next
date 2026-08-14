import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { runAccountingChecks } from "@/lib/accounting-checks.functions";

export const Route = createFileRoute("/admin/maxiticket/accounting-checks")({
  head: () => ({ meta: [{ title: "Účtovanie · kontroly · vipky.sk Admin" }] }),
  component: Page,
});

function Page() {
  const fetchChecks = useServerFn(runAccountingChecks);
  const checks = useQuery({
    queryKey: ["accounting-checks"],
    queryFn: () => fetchChecks({ data: undefined as never }),
  });

  const rows = checks.data ?? [];
  const failed = rows.filter((c) => c.count > 0);
  const errors = failed.filter((c) => c.severity === "error");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Účtovanie · kontroly</h1>
          <p className="text-muted-foreground mt-1">
            Nezhody vnútri predajných dát. Porovnanie protokolov s prepočtom nájdeš v{" "}
            <Link to="/admin/maxiticket/control" className="text-primary hover:underline">
              Kontrole zostavy
            </Link>
            .
          </p>
        </div>
        <Button variant="outline" onClick={() => checks.refetch()} disabled={checks.isFetching}>
          {checks.isFetching ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="size-4 mr-2" />
          )}
          Spustiť znovu
        </Button>
      </div>

      {checks.isLoading ? (
        <Card className="bg-card/60 border-border/50 p-10 text-center">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        </Card>
      ) : (
        <>
          <Card
            className={`p-5 border ${
              errors.length > 0
                ? "bg-destructive/10 border-destructive/30"
                : failed.length > 0
                  ? "bg-amber-500/10 border-amber-500/30"
                  : "bg-emerald-500/10 border-emerald-500/30"
            }`}
          >
            <div className="flex items-center gap-3">
              {errors.length > 0 ? (
                <XCircle className="size-6 text-destructive shrink-0" />
              ) : failed.length > 0 ? (
                <AlertTriangle className="size-6 text-amber-500 shrink-0" />
              ) : (
                <CheckCircle2 className="size-6 text-emerald-500 shrink-0" />
              )}
              <div>
                <div className="font-display font-semibold">
                  {failed.length === 0
                    ? "Všetko sedí"
                    : [
                        errors.length > 0 ? `${errors.length}× chyba` : null,
                        failed.length - errors.length > 0
                          ? `${failed.length - errors.length}× upozornenie`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </div>
                <div className="text-sm text-muted-foreground">
                  Prebehlo {rows.length} kontrol. Žiadna z nich dáta nemení — je to len diagnostika.
                </div>
              </div>
            </div>
          </Card>

          <div className="grid gap-3">
            {rows.map((c) => {
              const ok = c.count === 0;
              return (
                <Card
                  key={c.key}
                  className={`p-4 bg-card/60 ${
                    ok
                      ? "border-border/40"
                      : c.severity === "error"
                        ? "border-destructive/40"
                        : "border-amber-500/40"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {ok ? (
                      <CheckCircle2 className="size-4 mt-0.5 text-emerald-500 shrink-0" />
                    ) : c.severity === "error" ? (
                      <XCircle className="size-4 mt-0.5 text-destructive shrink-0" />
                    ) : (
                      <AlertTriangle className="size-4 mt-0.5 text-amber-500 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{c.title}</span>
                        {ok ? (
                          <Badge variant="outline" className="text-[10px]">
                            v poriadku
                          </Badge>
                        ) : (
                          <Badge
                            variant={c.severity === "error" ? "destructive" : "secondary"}
                            className="text-[10px]"
                          >
                            {c.count}
                            {c.count >= 10 ? "+" : ""} nálezov
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{c.explanation}</p>
                      {!ok && (
                        <ul className="mt-2 space-y-0.5">
                          {c.samples.map((s) => (
                            <li key={s} className="font-mono text-xs text-muted-foreground">
                              {s}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
