// Platobné údaje pre objednávku platenú prevodom.
//
// Zákazníka sem checkout pošle namiesto brány. Tie isté údaje odchádzajú aj
// e-mailom, ale e-mail sa vie stratiť v spame — a bez variabilného symbolu je
// platba nespárovateľná a skončí u supportu.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, CalendarClock, Check, Copy, Landmark } from "lucide-react";
import { getTransferDetails } from "@/lib/payments.functions";

export const Route = createFileRoute("/checkout/transfer/$orderId")({
  head: () => ({ meta: [{ title: "Platobné údaje · eticketo.eu" }] }),
  component: TransferPage,
});

type Udaje = Awaited<ReturnType<typeof getTransferDetails>>;

function Riadok({
  label,
  hodnota,
  zvyraznene,
}: {
  label: string;
  hodnota: string;
  zvyraznene?: boolean;
}) {
  const [skopirovane, setSkopirovane] = useState(false);

  const kopiruj = async () => {
    try {
      await navigator.clipboard.writeText(hodnota);
      setSkopirovane(true);
      setTimeout(() => setSkopirovane(false), 1500);
    } catch {
      toast.error("Kopírovanie sa nepodarilo, prepíš prosím údaj ručne.");
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className={zvyraznene ? "font-mono text-base font-semibold" : "font-mono text-sm"}>
          {hodnota}
        </span>
        <Button size="sm" variant="ghost" onClick={kopiruj} aria-label={`Kopírovať ${label}`}>
          {skopirovane ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </span>
    </div>
  );
}

function TransferPage() {
  const { orderId } = Route.useParams();
  const nacitaj = useServerFn(getTransferDetails);
  const [udaje, setUdaje] = useState<Udaje>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let zrusene = false;
    nacitaj({ data: { order_id: orderId } })
      .then((r) => {
        if (!zrusene) setUdaje(r);
      })
      .finally(() => {
        if (!zrusene) setLoaded(true);
      });
    return () => {
      zrusene = true;
    };
  }, [nacitaj, orderId]);

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="container mx-auto max-w-2xl flex-1 px-4 py-10">
        {!loaded ? (
          <p className="text-muted-foreground">Načítavam…</p>
        ) : !udaje ? (
          <Card className="border-dashed bg-card/60 p-12 text-center">
            Objednávka sa nenašla alebo sa neplatí prevodom.
          </Card>
        ) : udaje.status === "paid" ? (
          <Card className="p-8 text-center">
            <h1 className="mb-2 text-2xl font-semibold">Platba dorazila</h1>
            <p className="mb-6 text-muted-foreground">Vstupenky sme poslali na váš e-mail.</p>
            <Button asChild>
              <Link to="/account">Moje vstupenky</Link>
            </Button>
          </Card>
        ) : (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold">Zaplaťte prevodom</h1>
              <p className="text-sm text-muted-foreground">
                Vstupenky sme pre vás odložili. Pošlite prosím platbu podľa údajov nižšie — tie isté
                sme vám poslali aj e-mailom.
              </p>
            </div>

            <Card className="p-6">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium">
                <Landmark className="size-4" />
                Platobné údaje
              </div>
              {udaje.iban && <Riadok label="IBAN" hodnota={udaje.iban} zvyraznene />}
              {udaje.variable_symbol && (
                <Riadok label="Variabilný symbol" hodnota={udaje.variable_symbol} zvyraznene />
              )}
              <Riadok
                label="Suma"
                hodnota={`${udaje.amount.toFixed(2)} ${udaje.currency}`}
                zvyraznene
              />
              {udaje.holder && <Riadok label="Príjemca" hodnota={udaje.holder} />}
              {udaje.bank_name && <Riadok label="Banka" hodnota={udaje.bank_name} />}
            </Card>

            <Card className="space-y-3 p-6 text-sm">
              <div className="flex gap-3">
                <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <p>
                  <strong>Variabilný symbol nevynechajte.</strong> Podľa neho platbu priradíme k
                  vašej objednávke. Bez neho ju musíme dohľadávať ručne a vstupenky prídu neskôr.
                </p>
              </div>
              {udaje.due_at && (
                <div className="flex gap-3">
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <p>
                    Platba musí doraziť do{" "}
                    <strong>{new Date(udaje.due_at).toLocaleDateString("sk-SK")}</strong>. Po tomto
                    termíne miesta uvoľníme ďalším záujemcom.
                  </p>
                </div>
              )}
            </Card>

            <p className="text-sm text-muted-foreground">
              Vstupenky vám pošleme hneď, ako peniaze prídu na účet — býva to jeden až dva pracovné
              dni.
            </p>

            <Button asChild variant="ghost">
              <Link to="/">
                <ArrowLeft className="size-4" />
                Späť na úvod
              </Link>
            </Button>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
