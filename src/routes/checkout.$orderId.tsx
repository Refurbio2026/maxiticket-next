import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getOrder,
  releaseExpired,
  releaseOrder,
  upsertOrder,
  type Order,
} from "@/lib/ticketing-db";
import { submitOrder, createGoPayPaymentForOrder } from "@/lib/payments.functions";
import { useEvent } from "@/hooks/use-events";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Calendar,
  MapPin,
  Clock,
  CreditCard,
  ArrowLeft,
  ShieldCheck,
  Lock,
  Mail,
  QrCode,
  Check,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/checkout/$orderId")({
  head: () => ({ meta: [{ title: "Checkout · vipky.sk" }] }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const { orderId } = Route.useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | undefined>();
  const { data: eventData } = useEvent(order?.event_id);
  const event = eventData ?? undefined;
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    consent: false,
  });

  useEffect(() => {
    releaseExpired();
    const o = getOrder(orderId);
    setOrder(o);
    setLoaded(true);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [orderId]);

  const expiresMs = order ? new Date(order.expires_at).getTime() - now : 0;
  const expired = !!order && expiresMs <= 0 && order.status === "pending";
  const mins = Math.max(0, Math.floor(expiresMs / 60000));
  const secs = Math.max(0, Math.floor((expiresMs % 60000) / 1000));

  const [paying, setPaying] = useState(false);
  const submit = useServerFn(submitOrder);
  const createPayment = useServerFn(createGoPayPaymentForOrder);

  const pay = async () => {
    if (!order) return;
    if (!form.first_name || !form.last_name || !form.email) {
      toast.error("Vyplň meno, priezvisko a email");
      return;
    }
    if (!form.consent) {
      toast.error("Musíš súhlasiť s obchodnými podmienkami");
      return;
    }
    upsertOrder({
      ...order,
      customer_name: `${form.first_name} ${form.last_name}`.trim(),
      customer_email: form.email,
      customer_phone: form.phone,
    });
    setPaying(true);
    try {
      const { order_id: supabaseOrderId } = await submit({
        data: {
          event_id: order.event_id,
          customer: {
            first_name: form.first_name,
            last_name: form.last_name,
            email: form.email,
            phone: form.phone || undefined,
          },
          // Ceny sa neposielajú — server si ich odvodí z databázy.
          items: order.items.map((it) => ({
            seat_id: it.seat_id || undefined,
            seat_label: it.seat_id ? it.label : undefined,
            is_vip: it.is_vip ?? false,
            quantity: 1,
          })),
        },
      });
      const { payment_url } = await createPayment({ data: { order_id: supabaseOrderId } });
      window.location.href = payment_url;
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Vytvorenie platby zlyhalo");
      setPaying(false);
    }
  };

  const cancel = () => {
    if (!order) return;
    releaseOrder(order.id);
    upsertOrder({ ...order, status: "cancelled" });
    toast.info("Objednávka zrušená, sedadlá uvoľnené");
    navigate({ to: "/events/$id", params: { id: order.event_id } });
  };

  if (!loaded)
    return (
      <Shell>
        <p className="text-muted-foreground">Načítavam…</p>
      </Shell>
    );
  if (!order)
    return (
      <Shell>
        <Card className="p-12 text-center bg-card/60 border-dashed">Objednávka sa nenašla</Card>
      </Shell>
    );

  if (order.status === "paid") {
    // already paid → redirect to success
    if (typeof window !== "undefined") {
      window.location.replace(`/checkout/success/${order.id}`);
    }
    return null;
  }

  return (
    <Shell>
      <Link
        to="/events/$id"
        params={{ id: order.event_id }}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6"
      >
        <ArrowLeft className="size-4" /> Späť na podujatie
      </Link>

      <Stepper current={2} />

      <div className="grid lg:grid-cols-[1fr_360px] gap-8 mt-6">
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">Pokladňa</h1>
            <p className="text-muted-foreground mt-1">
              Dokonči svoju objednávku v 3 jednoduchých krokoch.
            </p>
          </div>

          <Card className="p-6 bg-card/60 border-border/50">
            <h2 className="font-display font-semibold text-lg mb-4">
              <span className="inline-flex items-center justify-center size-6 rounded-full bg-primary/10 text-primary text-xs font-bold mr-2">
                1
              </span>
              Kontaktné údaje
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Meno">
                <Input
                  autoFocus
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </Field>
              <Field label="Priezvisko">
                <Input
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </Field>
              <Field label="Email (sem pošleme vstupenky)" className="sm:col-span-2">
                <Input
                  type="email"
                  placeholder="meno@email.sk"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field label="Telefón (voliteľné)" className="sm:col-span-2">
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
            </div>
            <label className="flex items-start gap-3 mt-5 text-sm cursor-pointer">
              <Checkbox
                checked={form.consent}
                onCheckedChange={(v) => setForm({ ...form, consent: !!v })}
              />
              <span className="text-muted-foreground">
                Súhlasím s obchodnými podmienkami a so spracovaním osobných údajov.
              </span>
            </label>
          </Card>

          <Card className="p-6 bg-card/60 border-border/50">
            <h2 className="font-display font-semibold text-lg mb-3">
              <span className="inline-flex items-center justify-center size-6 rounded-full bg-primary/10 text-primary text-xs font-bold mr-2">
                2
              </span>
              Platba
            </h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
              <Lock className="size-3.5" />
              Šifrované SSL pripojenie · Platby spracuje GoPay
            </div>
            <Button
              onClick={pay}
              disabled={expired || paying}
              className="w-full bg-gradient-flame text-primary-foreground shadow-glow"
              size="lg"
            >
              <CreditCard className="size-4 mr-2" />
              {paying
                ? "Pripravujem GoPay…"
                : expired
                  ? "Rezervácia vypršala"
                  : `Zaplatiť cez GoPay €${order.total_amount.toFixed(2)}`}
            </Button>

            <div className="mt-5 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
              <div className="flex flex-col items-center text-center gap-1 p-2 rounded-md border border-border/40">
                <ShieldCheck className="size-4 text-emerald-500" />
                Bezpečná platba
              </div>
              <div className="flex flex-col items-center text-center gap-1 p-2 rounded-md border border-border/40">
                <QrCode className="size-4 text-primary" />
                QR vstupenka
              </div>
              <div className="flex flex-col items-center text-center gap-1 p-2 rounded-md border border-border/40">
                <Mail className="size-4 text-primary" />
                Email potvrdenie
              </div>
            </div>

            {!expired && (
              <button
                onClick={cancel}
                className="block w-full text-center text-xs text-muted-foreground hover:text-foreground mt-4"
              >
                Zrušiť objednávku a uvoľniť sedadlá
              </button>
            )}
          </Card>
        </div>

        <Card className="p-6 bg-card/60 border-border/50 h-fit lg:sticky lg:top-28">
          <h2 className="font-display font-semibold text-lg mb-4">Zhrnutie</h2>
          {event && (
            <div className="mb-4 pb-4 border-b border-border/40">
              <div className="font-semibold">{event.title}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                <Calendar className="size-3.5" /> {event.event_date} · {event.event_time}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <MapPin className="size-3.5" /> {event.venue}, {event.city}
              </div>
            </div>
          )}

          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {order.items.map((it, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="truncate pr-2">{it.label}</span>
                <span className="font-semibold whitespace-nowrap">€{it.price.toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-border/40 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Spolu</span>
            <span className="font-display text-2xl font-bold">
              €{order.total_amount.toFixed(2)}
            </span>
          </div>

          <div
            className={`mt-4 p-3 rounded-md border text-xs inline-flex items-center gap-2 w-full ${
              expired
                ? "bg-destructive/10 border-destructive/30 text-destructive"
                : "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400"
            }`}
          >
            <Clock className="size-3.5" />
            {expired ? (
              "Rezervácia vypršala — sedadlá boli uvoľnené."
            ) : (
              <>
                Sedadlá rezervované ešte{" "}
                <strong>
                  {mins}:{String(secs).padStart(2, "0")}
                </strong>
              </>
            )}
          </div>
        </Card>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 pt-28 pb-20">{children}</main>
      <Footer />
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  const steps = ["Výber", "Kontakt", "Platba", "Hotovo"];
  return (
    <ol className="flex items-center gap-2 text-xs">
      {steps.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`inline-flex items-center justify-center size-6 rounded-full font-bold ${
                done
                  ? "bg-emerald-500 text-white"
                  : active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? <Check className="size-3.5" /> : step}
            </span>
            <span
              className={
                active ? "font-semibold text-foreground" : "text-muted-foreground hidden sm:inline"
              }
            >
              {label}
            </span>
            {step < steps.length && (
              <span
                className={`w-6 sm:w-10 h-px ${done ? "bg-emerald-500" : "bg-border"}`}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
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
