import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { User, Ticket, LogOut, Calendar, MapPin, Download, Mail } from "lucide-react";
import { getMyTickets } from "@/lib/account.functions";
import type { IssuedTicket } from "@/lib/ticketing-db";
import {
  AppleWalletButton,
  GoogleWalletButton,
  type WalletEventInfo,
} from "@/components/wallet/WalletButtons";
import { toast } from "sonner";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Môj účet · vipky.sk" }] }),
  component: AccountPage,
});

type Row = {
  ticket: IssuedTicket;
  event: (WalletEventInfo & { title?: string }) | null;
  customer_email: string | null;
};

function AccountPage() {
  const { t } = useI18n();
  const { user, roles, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const fetchMine = useServerFn(getMyTickets);
  const [rows, setRows] = useState<Row[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setTicketsLoading(true);
    fetchMine()
      .then((res: { rows: Row[] }) => {
        if (!cancelled) setRows(res.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setTicketsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, fetchMine]);

  if (loading || !user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 pt-32 pb-20">
        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight">{t("account.title")}</h1>
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
            <LogOut className="size-4 mr-2" /> {t("account.signOut")}
          </Button>
        </div>

        {/* Stats tiles */}
        <div className="grid sm:grid-cols-3 gap-4 mb-10">
          <Card className="p-6 bg-card/60 border-border/50">
            <Ticket className="size-6 text-primary mb-3" />
            <div className="font-semibold">{t("account.myTickets")}</div>
            <p className="text-sm text-muted-foreground mt-1">
              {rows.length > 0
                ? t("account.activeTicketsCount", { count: rows.length })
                : t("account.ticketsAfterFirstPurchase")}
            </p>
          </Card>
          <Card className="p-6 bg-card/60 border-border/50">
            <Calendar className="size-6 text-primary mb-3" />
            <div className="font-semibold">{t("account.discoverEvents")}</div>
            <Link to="/events" className="text-sm text-primary hover:underline mt-2 inline-block">
              {t("account.goToEvents")} →
            </Link>
          </Card>
          <Card className="p-6 bg-card/60 border-border/50">
            <User className="size-6 text-primary mb-3" />
            <div className="font-semibold">{t("account.profile")}</div>
            <p className="text-sm text-muted-foreground mt-1">{t("account.profileSecure")}</p>
          </Card>
        </div>

        {/* Tickets */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              {t("account.myTickets")}
            </h2>
            <span className="text-xs text-muted-foreground">
              {t("account.byEmail", { email: user.email })}
            </span>
          </div>

          {ticketsLoading ? (
            <Card className="p-10 text-center bg-card/60 border-dashed border-border/50">
              <p className="text-sm text-muted-foreground">{t("account.loadingTickets")}</p>
            </Card>
          ) : rows.length === 0 ? (
            <Card className="p-10 text-center bg-card/60 border-dashed border-border/50">
              <Ticket className="size-10 text-muted-foreground mx-auto mb-3" />
              <div className="font-semibold">{t("account.noTicketsYet")}</div>
              <p className="text-sm text-muted-foreground mt-1">
                {t("account.noTicketsHintBefore")} <span className="font-mono">{user.email}</span>
                {t("account.noTicketsHintAfter")}
              </p>
              <Link
                to="/events"
                className="mt-5 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                {t("account.browseEvents")} →
              </Link>
            </Card>
          ) : (
            <div className="space-y-4">
              {rows.map((row) => (
                <TicketCard key={row.ticket.id} row={row} />
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}

function TicketCard({ row }: { row: Row }) {
  const { t } = useI18n();
  const { ticket, event, customer_email } = row;
  const print = () => {
    if (typeof window !== "undefined") window.print();
  };
  const email = () => toast.success(t("account.ticketSent", { email: customer_email }));

  return (
    <Card className="p-5 bg-card/60 border-border/50">
      <div className="flex flex-col sm:flex-row gap-5">
        <div className="bg-white p-2 rounded-md self-center sm:self-start shrink-0">
          <QRCodeSVG value={ticket.qr_code} size={120} level="M" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {t("account.ticketLabel")}
          </div>
          <div className="font-display text-lg font-semibold mt-0.5">
            {event?.title ?? t("account.eventFallback")}
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
            <GoogleWalletButton ticket={ticket} event={event ?? undefined} size="sm" compact />
            <Button size="sm" variant="outline" onClick={print} className="gap-1.5">
              <Download className="size-3.5" /> PDF
            </Button>
            {customer_email && (
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
