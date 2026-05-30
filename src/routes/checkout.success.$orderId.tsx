import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getOrder, getTicketsForOrder, type Order, type IssuedTicket } from "@/lib/ticketing-db";
import { getEvent, type EventItem } from "@/lib/local-db";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Calendar, MapPin, Download, ArrowLeft } from "lucide-react";

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

  useEffect(() => {
    const o = getOrder(orderId);
    setOrder(o);
    if (o) {
      setEvent(getEvent(o.event_id));
      setTickets(getTicketsForOrder(o.id));
    }
    setLoaded(true);
  }, [orderId]);

  const download = () => {
    if (typeof window !== "undefined") window.print();
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
              <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">Ďakujeme za nákup</h1>
              <p className="text-muted-foreground mt-2">
                Tvoje vstupenky boli vytvorené. Číslo objednávky:{" "}
                <span className="font-mono font-semibold text-foreground">{order.id.slice(0, 8).toUpperCase()}</span>
              </p>
            </div>

            {event && (
              <Card className="p-6 bg-card/60 border-border/50 mb-6">
                <div className="font-display text-xl font-semibold">{event.title}</div>
                <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><Calendar className="size-4" /> {event.event_date} · {event.event_time}</span>
                  <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" /> {event.venue}, {event.city}</span>
                </div>
              </Card>
            )}

            <div className="space-y-4">
              {tickets.map((t, i) => (
                <Card key={t.id} className="p-5 bg-card/60 border-border/50 flex items-center gap-5 print:break-inside-avoid">
                  <div className="bg-white p-2 rounded-md">
                    <QRCodeSVG value={t.qr_code} size={108} level="M" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Vstupenka #{i + 1}</div>
                    <div className="font-display text-lg font-semibold mt-0.5">{t.seat_label}</div>
                    <div className="text-xs font-mono text-muted-foreground mt-1 break-all">{t.qr_code}</div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 mt-8 print:hidden">
              <Button onClick={download} variant="outline" className="gap-1.5">
                <Download className="size-4" /> Stiahnuť vstupenky
              </Button>
              <Link to="/events">
                <Button variant="ghost" className="gap-1.5">
                  <ArrowLeft className="size-4" /> Späť na podujatia
                </Button>
              </Link>
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
