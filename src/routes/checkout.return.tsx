import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { settleGoPayOrder, getOrderSummary } from "@/lib/payments.functions";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/checkout/return")({
  head: () => ({ meta: [{ title: "Overujeme platbu · MAXITICKET" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    orderId: typeof s.orderId === "string" ? s.orderId : "",
  }),
  component: ReturnPage,
});

function ReturnPage() {
  const { orderId } = Route.useSearch();
  const navigate = useNavigate();
  const settle = useServerFn(settleGoPayOrder);
  const summary = useServerFn(getOrderSummary);
  const [state, setState] = useState<"checking" | "pending" | "failed" | "missing">("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!orderId) {
      setState("missing");
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const result = await settle({ data: { order_id: orderId } });
        if (cancelled) return;
        if (result.status === "paid") {
          navigate({ to: "/checkout/success/$orderId", params: { orderId } });
          return;
        }
        if (result.status === "cancelled" || result.status === "failed") {
          setState("failed");
          return;
        }
      } catch {
        try {
          const s = await summary({ data: { order_id: orderId } });
          if (s.order?.status === "paid") {
            navigate({ to: "/checkout/success/$orderId", params: { orderId } });
            return;
          }
        } catch {
          /* ignore */
        }
      }
      if (attempt < 6) {
        setTimeout(() => setAttempt((a) => a + 1), 2000);
        setState("checking");
      } else {
        setState("pending");
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [orderId, attempt, navigate, settle, summary]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-xl px-4 pt-32 pb-20">
        <Card className="p-10 text-center bg-card/60 border-border/50">
          {state === "checking" && (
            <>
              <Loader2 className="size-10 mx-auto animate-spin text-primary" />
              <h1 className="font-display text-2xl font-bold mt-4">Overujeme platbu</h1>
              <p className="text-muted-foreground mt-2 text-sm">
                Komunikujeme s GoPay. Toto zaberie pár sekúnd, neopúšťaj stránku.
              </p>
            </>
          )}
          {state === "pending" && (
            <>
              <RefreshCw className="size-10 mx-auto text-amber-500" />
              <h1 className="font-display text-2xl font-bold mt-4">Platbu ešte spracovávame</h1>
              <p className="text-muted-foreground mt-2 text-sm">
                Banka môže potrvať pár minút. Vstupenky a doklad ti pošleme hneď ako platba prejde.
              </p>
              <Button
                onClick={() => {
                  setAttempt(0);
                  setState("checking");
                }}
                className="mt-6"
              >
                Skontrolovať znova
              </Button>
            </>
          )}
          {state === "failed" && (
            <>
              <AlertTriangle className="size-10 mx-auto text-destructive" />
              <h1 className="font-display text-2xl font-bold mt-4">Platba neprešla</h1>
              <p className="text-muted-foreground mt-2 text-sm">
                GoPay platbu zamietol alebo si ju zrušil. Skús to znova.
              </p>
              <Button
                onClick={() => navigate({ to: "/checkout/$orderId", params: { orderId } })}
                className="mt-6"
              >
                Skúsiť platbu znova
              </Button>
            </>
          )}
          {state === "missing" && (
            <>
              <AlertTriangle className="size-10 mx-auto text-destructive" />
              <h1 className="font-display text-2xl font-bold mt-4">Chýba číslo objednávky</h1>
              <p className="text-muted-foreground mt-2 text-sm">Skontroluj odkaz a skús to znova.</p>
            </>
          )}
        </Card>
      </main>
      <Footer />
    </div>
  );
}
