import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { QRCodeSVG } from "qrcode.react";
import { getOrder, getTicketsForOrder, type Order, type IssuedTicket } from "@/lib/ticketing-db";
import { getEvent, type EventItem } from "@/lib/local-db";
import { getOrderSummary } from "@/lib/payments.functions";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Calendar,
  MapPin,
  Download,
  ArrowLeft,
  Mail,
  ShieldCheck,
  QrCode,
  Smartphone,
  FileText,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { AppleWalletButton, GoogleWalletButton } from "@/components/wallet/WalletButtons";
import { downloadTicketsPdf } from "@/lib/ticket-pdf";

export const Route = createFileRoute("/checkout/success/$orderId")({
  head: () => ({ meta: [{ title: "Ďakujeme za nákup · MAXITICKET" }] }),
  component: SuccessPage,
});

function SuccessPage() {
  const { orderId } = Route.useParams();
  const [order, setOrder] = useState<Order | undefined>();
  const [event, setEvent] = useState<EventItem | undefined>();
  const [tickets, setTickets] = useState<IssuedTicket[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const o = getOrder(orderId);
    setOrder(o);
    if (o) {
      setEvent(getEvent(o.event_id));
      setTickets(getTicketsForOrder(o.id));
    }
    setLoaded(true);
  }, [orderId]);

  const download = async () => {
    if (!order || tickets.length === 0) {
      toast.error("Vstupenky nie sú pripravené");
      return;
    }
    setGenerating(true);
    try {
      await downloadTicketsPdf({ order, event, tickets });
      toast.success("PDF vstupenka stiahnutá");
    } catch (e) {
      console.error(e);
      toast.error("Generovanie PDF zlyhalo");
    } finally {
      setGenerating(false);
    }
  };

  const sendEmail = () => {
    if (!order?.customer_email) {
      toast.error("Pri objednávke nebol uvedený email");
      return;
    }
    setSending(true);
    setTimeout(() => {
      setSending(false);
      toast.success(`Vstupenky odoslané na ${order.customer_email}`, {
        description: "Skontroluj si aj priečinok spam.",
      });
    }, 900);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 pt-28 pb-20">
        {!loaded ? (
          <p className="text-muted-foreground">Načítavam…</p>
        ) : !order ? (
          <Card className="p-12 text-center bg-card/60 border-dashed">Objednávka sa nenašla</Card>
        ) : (
          <>
            <div className="text-center mb-10">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/15 text-emerald-500 mb-4">
                <CheckCircle2 className="size-8" />
              </div>
              <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
                Ďakujeme za nákup
              </h1>
              <p className="text-muted-foreground mt-2">
                Tvoje vstupenky boli vytvorené. Číslo objednávky:{" "}
                <span className="font-mono font-semibold text-foreground">
                  {order.id.slice(0, 8).toUpperCase()}
                </span>
              </p>
              {order.customer_email && (
                <p className="text-sm text-muted-foreground mt-3 inline-flex items-center gap-1.5">
                  <Mail className="size-4" /> Potvrdenie sme poslali na{" "}
                  <span className="font-medium text-foreground">{order.customer_email}</span>
                </p>
              )}
            </div>

            {event && (
              <Card className="p-6 bg-card/60 border-border/50 mb-6">
                <div className="font-display text-xl font-semibold">{event.title}</div>
                <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="size-4" /> {event.event_date} · {event.event_time}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-4" /> {event.venue}, {event.city}
                  </span>
                </div>
              </Card>
            )}

            {/* Mobile wallet CTA */}
            <Card className="p-5 mb-6 bg-gradient-to-br from-primary/10 via-card/60 to-card/60 border-primary/30">
              <div className="flex items-start gap-4">
                <div className="size-12 rounded-xl bg-primary/15 text-primary grid place-items-center shrink-0">
                  <Smartphone className="size-6" />
                </div>
                <div className="flex-1">
                  <div className="font-display text-lg font-semibold">
                    Pridajte si vstupenku do mobilu
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Netreba tlačiť. Ulož si vstupenku do Apple Wallet alebo Google Wallet a pri vstupe ukáž QR kód z telefónu.
                  </p>
                </div>
              </div>
            </Card>

            <div className="space-y-4">
              {tickets.map((t, i) => (
                <Card
                  key={t.id}
                  className="p-5 bg-card/60 border-border/50 print:break-inside-avoid"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                    <div className="bg-white p-2 rounded-md self-center sm:self-start">
                      <QRCodeSVG value={t.qr_code} size={108} level="M" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Vstupenka #{i + 1}
                      </div>
                      <div className="font-display text-lg font-semibold mt-0.5">{t.seat_label}</div>
                      <div className="text-xs font-mono text-muted-foreground mt-1 break-all">
                        {t.qr_code}
                      </div>

                      <div className="flex flex-wrap gap-2 mt-4 print:hidden">
                        <AppleWalletButton ticket={t} size="sm" compact />
                        <GoogleWalletButton ticket={t} size="sm" compact />
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 mt-8 print:hidden">
              <Button
                onClick={download}
                disabled={generating}
                className="gap-1.5 bg-gradient-flame text-primary-foreground shadow-glow"
              >
                <Download className="size-4" /> {generating ? "Generujem PDF…" : "Stiahnuť PDF vstupenku"}
              </Button>
              <Button onClick={sendEmail} variant="outline" disabled={sending} className="gap-1.5">
                <Mail className="size-4" /> {sending ? "Posielam…" : "Poslať na email"}
              </Button>
              <Link to="/events">
                <Button variant="ghost" className="gap-1.5">
                  <ArrowLeft className="size-4" /> Späť na podujatia
                </Button>
              </Link>
            </div>

            <div className="mt-10 grid sm:grid-cols-3 gap-3 print:hidden">
              <TrustItem icon={<QrCode className="size-4" />} label="QR vstupenka">
                Ukáž QR kód pri vstupe – netreba tlačiť.
              </TrustItem>
              <TrustItem icon={<Mail className="size-4" />} label="Email potvrdenie">
                Vstupenky máš aj v doručenej pošte.
              </TrustItem>
              <TrustItem icon={<ShieldCheck className="size-4" />} label="Bezpečná platba">
                Tvoje údaje sú chránené šifrovaním.
              </TrustItem>
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

function TrustItem({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-primary">{icon}</span> {label}
      </div>
      <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{children}</div>
    </div>
  );
}
