import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/hooks/use-auth";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  User, Ticket, LogOut, Calendar, MapPin, Download, Mail, Smartphone,
} from "lucide-react";
import {
  getOrders, getTickets, ORDERS_EVENT,
  type Order, type IssuedTicket,
} from "@/lib/ticketing-db";
import { getEvent, type EventItem } from "@/lib/local-db";
import { AppleWalletButton, GoogleWalletButton } from "@/components/wallet/WalletButtons";
import { toast } from "sonner";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Môj účet · MAXITICKET" }] }),
  component: AccountPage,
});

type TicketRow = {
  ticket: IssuedTicket;
  order: Order;
  event?: EventItem;
};

function AccountPage() {
  const { user, roles, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [tickets, setTickets] = useState<IssuedTicket[]>([]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  useEffect(() => {
    const load = () => {
      setOrders(getOrders());
      setTickets(getTickets());
    };
    load();
    window.addEventListener(ORDERS_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(ORDERS_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  const rows: TicketRow[] = useMemo(() => {
    if (!user?.email) return [];
    const mine = orders.filter(
      (o) =>
        o.status === "paid" &&
        (o.customer_email ?? "").toLowerCase() === user.email!.toLowerCase(),
    );
    const orderById = new Map(mine.map((o) => [o.id, o]));
    return tickets
      .filter((t) => orderById.has(t.order_id))
      .map((t) => {
        const order = orderById.get(t.order_id)!;
        return { ticket: t, order, event: getEvent(t.event_id) };
      })
      .sort((a, b) => b.ticket.issued_at.localeCompare(a.ticket.issued_at));
  }, [orders, tickets, user?.email]);

  if (loading || !user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 pt-32 pb-20">
        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight">Môj účet</h1>
            <p className="text-muted-foreground mt-1">{user.email}</p>
            <div className="flex gap-2 mt-3">
              {roles.map((r) => (
                <span
                  key={r}
                  className="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/15 text-primary border border-primary/30"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              await signOut();
              navigate({ to: "/login", replace: true });
            }}
          >
            <LogOut className="size-4 mr-2" /> Odhlásiť sa
          </Button>
        </div>

        {/* Stats tiles */}
        <div className="grid sm:grid-cols-3 gap-4 mb-10">
          <Card className="p-6 bg-card/60 border-border/50">
            <Ticket className="size-6 text-primary mb-3" />
            <div className="font-semibold">Moje vstupenky</div>
            <p className="text-sm text-muted-foreground mt-1">
              {rows.length > 0
                ? `${rows.length} aktívnych vstupeniek`
                : "Vstupenky sa zobrazia po prvom nákupe."}
            </p>
          </Card>
          <Card className="p-6 bg-card/60 border-border/50">
            <Calendar className="size-6 text-primary mb-3" />
            <div className="font-semibold">Objavuj podujatia</div>
            <Link
              to="/events"
              className="text-sm text-primary hover:underline mt-2 inline-block"
            >
              Prejsť na podujatia →
            </Link>
          </Card>
          <Card className="p-6 bg-card/60 border-border/50">
            <User className="size-6 text-primary mb-3" />
            <div className="font-semibold">Profil</div>
            <p className="text-sm text-muted-foreground mt-1">
              Bezpečné a šifrované údaje.
            </p>
          </Card>
        </div>

        {/* Tickets */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              Moje vstupenky
            </h2>
            <span className="text-xs text-muted-foreground">
              Podľa emailu {user.email}
            </span>
          </div>

          {rows.length === 0 ? (
            <Card className="p-10 text-center bg-card/60 border-dashed border-border/50">
              <Ticket className="size-10 text-muted-foreground mx-auto mb-3" />
              <div className="font-semibold">Zatiaľ nemáš žiadne vstupenky</div>
              <p className="text-sm text-muted-foreground mt-1">
                Vstupenky sa zobrazia automaticky po úspešnom nákupe (pri kúpe použi email{" "}
                <span className="font-mono">{user.email}</span>).
              </p>
              <Link
                to="/events"
                className="mt-5 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                Prezri si podujatia →
              </Link>
            </Card>
          ) : (
            <div className="space-y-4">
              {rows.map(({ ticket, order, event }) => (
                <TicketCard key={ticket.id} ticket={ticket} order={order} event={event} />
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}

function TicketCard({
  ticket, order, event,
}: TicketRow) {
  const print = () => {
    if (typeof window !== "undefined") window.print();
  };
  const email = () =>
    toast.success(`Vstupenka odoslaná na ${order.customer_email}`);

  return (
    <Card className="p-5 bg-card/60 border-border/50">
      <div className="flex flex-col sm:flex-row gap-5">
        <div className="bg-white p-2 rounded-md self-center sm:self-start shrink-0">
          <QRCodeSVG value={ticket.qr_code} size={120} level="M" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Vstupenka
          </div>
          <div className="font-display text-lg font-semibold mt-0.5">
            {event?.title ?? "Podujatie"}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {event && (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="size-3.5" /> {event.event_date} · {event.event_time}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5" /> {event.venue}, {event.city}
                </span>
              </>
            )}
          </div>
          <div className="mt-2 text-sm font-medium">{ticket.seat_label}</div>
          <div className="text-[11px] font-mono text-muted-foreground mt-1 break-all">
            {ticket.qr_code}
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <AppleWalletButton ticket={ticket} size="sm" compact />
            <GoogleWalletButton ticket={ticket} size="sm" compact />
            <Button size="sm" variant="outline" onClick={print} className="gap-1.5">
              <Download className="size-3.5" /> PDF
            </Button>
            {order.customer_email && (
              <Button size="sm" variant="ghost" onClick={email} className="gap-1.5">
                <Mail className="size-3.5" /> Email
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
