import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { type Ticket } from "@/lib/local-db";
import { useEvents } from "@/hooks/use-events";
import { getFiscalSettings, getFiscalReceipts, type PaymentMethod } from "@/lib/pos-db";
import {
  useActivePosSession,
  useClosePosSession,
  useCreatePosSale,
  usePosCashiers,
  usePosClosingPreview,
  usePosSales,
  useVoidPosSale,
  setActiveSessionId,
  type PosCashierRecord,
} from "@/hooks/use-pos";
import type { PosSaleRecord } from "@/lib/pos.functions";
import { previewCoupon } from "@/lib/coupons.functions";
import { paymentTerminal } from "@/lib/payment-terminal-adapter";
import { fiscal } from "@/lib/fiscal-adapter";
import { printTickets } from "@/lib/print-tickets";
import { getReceiptDocument } from "@/lib/pos-documents.functions";
import { downloadBase64 } from "@/lib/download";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Banknote,
  CreditCard,
  Building2,
  Gift,
  Plus,
  Minus,
  Trash2,
  Printer,
  Mail,
  Ticket as TicketIcon,
  Receipt,
  Calendar,
  TrendingUp,
  Ban,
  Usb,
  FileText,
  ShoppingCart,
  LogOut,
  UserCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { CashierLoginGate } from "@/components/pos/CashierLoginGate";

export const Route = createFileRoute("/organizer/pos/")({
  head: () => ({ meta: [{ title: "Pokladňa · vipky.sk" }] }),
  component: PosPage,
});

type CartItem = { ticket: Ticket; qty: number };

function PosPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { data: events = [] } = useEvents({ scope: "mine" });
  const [eventId, setEventId] = useState<string>("");
  const [dateId, setDateId] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [promo, setPromo] = useState<string>("");
  /**
   * Kupón overený serverom (`null` = nie je uplatnený). Držíme si aj typ zľavy,
   * aby sa suma prepočítala pri zmene košíka bez ďalšieho dotazu; záväzne ju
   * aj tak počíta server pri uložení predaja.
   */
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    type: "percent" | "amount";
    value: number;
  } | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);
  const [terminalStatus, setTerminalStatus] = useState<
    "disconnected" | "connected" | "busy" | "error"
  >("disconnected");
  const [processing, setProcessing] = useState(false);
  const [lastSale, setLastSale] = useState<PosSaleRecord | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);

  // Pokladničný doklad sa generuje na serveri a odkladá k objednávke, takže sa
  // dá stiahnuť aj neskôr z prehľadu predajov — nielen hneď po predaji.
  const fetchReceipt = useServerFn(getReceiptDocument);
  const stiahniDoklad = async (orderId: string) => {
    setReceiptBusy(true);
    try {
      const doc = await fetchReceipt({ data: { order_id: orderId, refresh: false } });
      downloadBase64(doc.filename, doc.base64);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Doklad sa nepodarilo vytvoriť");
    } finally {
      setReceiptBusy(false);
    }
  };

  // Smena aj tržby sú v databáze; prehliadač si pamätá len to, ktorá smena je
  // otvorená na tejto pokladni.
  const { session: activeSession, activate } = useActivePosSession();
  const { data: cashiers = [] } = usePosCashiers();
  const activeCashier: PosCashierRecord | null =
    cashiers.find((c) => c.id === activeSession?.cashier_id) ?? null;

  const checkCouponFn = useServerFn(previewCoupon);
  const createSale = useCreatePosSale();
  const voidSaleMutation = useVoidPosSale();
  const closeSession = useClosePosSession();

  const todayStart = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
  const { data: todayStats } = usePosClosingPreview({
    from: todayStart,
    enabled: !!activeSession,
  });
  const { data: recentSales = [] } = usePosSales({ limit: 8 });

  const selectedEvent = useMemo(() => events.find((e) => e.id === eventId), [events, eventId]);
  const sellableDates = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (selectedEvent?.dates ?? []).filter(
      (d) => d.status === "on_sale" && d.event_date >= today,
    );
  }, [selectedEvent]);
  const activeDate = sellableDates.find((d) => d.id === dateId) ?? sellableDates[0];

  // Pri prepnutí podujatia sa výber termínu prestaví na najbližší.
  useEffect(() => {
    setDateId(sellableDates[0]?.id ?? "");
  }, [eventId, sellableDates]);

  // Kupón môže platiť len na jedno podujatie — po prepnutí sa musí overiť znovu.
  useEffect(() => {
    setAppliedCoupon(null);
    setPromo("");
  }, [eventId]);

  const subtotal = cart.reduce((s, i) => s + i.ticket.price * i.qty, 0);
  // Kupón má prednosť pred ručnou zľavou — rovnako to počíta aj server.
  const discount = appliedCoupon
    ? Math.min(
        appliedCoupon.type === "percent"
          ? Math.round(((subtotal * appliedCoupon.value) / 100) * 100) / 100
          : appliedCoupon.value,
        subtotal,
      )
    : Math.round(((subtotal * discountPct) / 100) * 100) / 100;
  const total = Math.max(0, subtotal - discount);

  const addToCart = (t: Ticket) => {
    setCart((c) => {
      const i = c.findIndex((x) => x.ticket.id === t.id);
      if (i >= 0) {
        const next = [...c];
        next[i] = { ...next[i], qty: next[i].qty + 1 };
        return next;
      }
      return [...c, { ticket: t, qty: 1 }];
    });
  };
  const inc = (id: string) =>
    setCart((c) => c.map((i) => (i.ticket.id === id ? { ...i, qty: i.qty + 1 } : i)));
  const dec = (id: string) =>
    setCart((c) =>
      c.flatMap((i) => (i.ticket.id === id ? (i.qty <= 1 ? [] : [{ ...i, qty: i.qty - 1 }]) : [i])),
    );
  const remove = (id: string) => setCart((c) => c.filter((i) => i.ticket.id !== id));
  /**
   * Kupón overuje server nad tabuľkou `coupons`. Predtým tu bola trojica kódov
   * natvrdo v komponente — dala sa prečítať z JavaScriptu a použiť donekonečna.
   * Toto je len náhľad, záväzne kupón uplatní až `createPosSale`.
   */
  const applyPromo = async () => {
    const code = promo.trim().toUpperCase();
    if (!code || !eventId) return;
    setCheckingPromo(true);
    try {
      const result = await checkCouponFn({
        data: { code, event_id: eventId, amount: subtotal },
      });
      if (!result.ok) {
        setAppliedCoupon(null);
        toast.error(result.message || t("orgPos.invalidPromo"));
        return;
      }
      setAppliedCoupon({
        code: result.code,
        type: result.discount_type ?? "percent",
        value: result.discount_value ?? 0,
      });
      setDiscountPct(0);
      toast.success(`${result.code}: −€${result.discount.toFixed(2)}`);
    } catch (e) {
      setAppliedCoupon(null);
      toast.error(e instanceof Error ? e.message : t("orgPos.invalidPromo"));
    } finally {
      setCheckingPromo(false);
    }
  };

  const clearPromo = () => {
    setPromo("");
    setAppliedCoupon(null);
  };

  const connect = async () => {
    setTerminalStatus("busy");
    const s = await paymentTerminal.connectTerminal();
    setTerminalStatus(s);
    toast.success(t("orgPos.terminalConnected"));
  };

  const checkout = async (method: PaymentMethod) => {
    if (!user || !selectedEvent || cart.length === 0) return;
    if (!activeCashier || !activeSession) {
      toast.error(t("orgPos.loginCashierFirst"));
      return;
    }
    if (!activeCashier.permissions.includes("sale")) {
      toast.error(t("orgPos.noSalePermission"));
      return;
    }
    if (!activeDate) {
      toast.error("Podujatie nemá termín v predaji.");
      return;
    }
    setProcessing(true);
    try {
      // Platobný terminál aj eKasa sú zatiaľ adaptéry (simulácia) — ich číslo
      // dokladu sa uloží k objednávke, keď pribudne skutočné zariadenie.
      let terminalTxId: string | undefined;
      if (method === "card") {
        if (terminalStatus !== "connected") await paymentTerminal.connectTerminal();
        const r = await paymentTerminal.sendPayment(total, "EUR", activeSession.id, user.id);
        if (!r.ok) throw new Error(r.error || t("orgPos.paymentDeclined"));
        terminalTxId = r.tx_id;
      }
      let fiscalReceiptId: string | undefined;
      if (getFiscalSettings().connection_status === "connected") {
        const fr = await fiscal.createReceipt({
          organizer_id: user.id,
          sale_id: terminalTxId || activeSession.id,
          total,
          payment_method: method,
          items: cart.map((i) => ({ name: i.ticket.name, qty: i.qty, unit_price: i.ticket.price })),
        });
        await fiscal.sendReceiptToFiscalSystem(fr);
        fiscalReceiptId = fr.id;
      }

      // Ceny počíta server z databázy — pokladňa posiela len to, ČO predáva.
      const sale = await createSale.mutateAsync({
        session_id: activeSession.id,
        event_id: selectedEvent.id,
        event_date_id: activeDate.id,
        payment_method: method,
        discount_pct: appliedCoupon ? 0 : discountPct,
        promo_code: appliedCoupon ? appliedCoupon.code : null,
        fiscal_receipt_id: fiscalReceiptId ?? null,
        items: cart.map((i) => ({ ticket_type_id: i.ticket.id, quantity: i.qty })),
      });

      setLastSale({
        id: sale.order_id,
        receipt_number: sale.receipt_number,
        created_at: new Date().toISOString(),
        event_id: selectedEvent.id,
        event_title: selectedEvent.title,
        event_date: `${activeDate.event_date} ${activeDate.event_time}`,
        cashier_id: activeCashier.id,
        cashier_name: activeCashier.display_name,
        pos_session_id: activeSession.id,
        payment_method: method,
        status: "paid",
        subtotal: sale.subtotal,
        discount: sale.discount,
        total: sale.total,
        items: cart.map((i) => ({
          label: i.ticket.name,
          quantity: i.qty,
          unit_price: i.ticket.price,
        })),
        tickets: sale.tickets,
      });
      setCart([]);
      setDiscountPct(0);
      clearPromo();
      toast.success(t("orgPos.saleCompleted", { number: sale.receipt_number }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("orgPos.paymentError"));
    } finally {
      setProcessing(false);
    }
  };

  const recent = recentSales;

  const voidLast = async (id: string) => {
    if (!activeSession) return;
    const reason = prompt(t("orgPos.voidReasonPrompt")) || "";
    if (!reason) return;
    try {
      await voidSaleMutation.mutateAsync({
        order_id: id,
        session_id: activeSession.id,
        reason,
      });
      toast.success(t("orgPos.saleVoided"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Storno zlyhalo");
    }
  };

  // Cashier login gate — must happen before everything else.
  if (user && !activeSession) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-4xl font-bold tracking-tight">{t("orgPos.titleEkasa")}</h1>
        <CashierLoginGate organizerId={user.id} onAuthed={(_c, s) => activate(s.id)} />
      </div>
    );
  }

  const logoutCashier = async () => {
    if (!activeSession) return;
    if (!confirm(t("orgPos.logoutConfirm"))) return;
    try {
      await closeSession.mutateAsync({ session_id: activeSession.id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Smenu sa nepodarilo uzavrieť");
      return;
    }
    setActiveSessionId(null);
    activate(null);
    setCart([]);
    setEventId("");
    toast.success(t("orgPos.cashierLoggedOut"));
  };

  // No events at all
  if (events.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-4xl font-bold tracking-tight">{t("orgPos.titlePos")}</h1>
        <Card className="p-12 text-center bg-card/60 border-dashed border-border/50 max-w-xl mx-auto">
          <TicketIcon className="size-12 text-muted-foreground mx-auto mb-4" />
          <div className="font-display text-xl font-bold">{t("orgPos.createEventFirst")}</div>
          <p className="text-sm text-muted-foreground mt-2">{t("orgPos.createEventDesc")}</p>
          <Button asChild className="mt-6 bg-gradient-flame text-primary-foreground shadow-glow">
            <Link to="/organizer/events/new">{t("orgPos.createEvent")}</Link>
          </Button>
        </Card>
      </div>
    );
  }

  // POS not opened yet — show event picker gate
  if (!eventId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">{t("orgPos.openPos")}</h1>
          <p className="text-muted-foreground mt-1">{t("orgPos.openPosDesc")}</p>
        </div>
        <Card className="p-8 bg-card/60 border-border/50 max-w-2xl">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            {t("orgPos.selectEvent")}
          </div>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="w-full h-12 rounded-xl bg-background border border-border/50 px-4 text-base focus:outline-none focus:border-primary"
          >
            <option value="">{t("orgPos.selectEventPlaceholder")}</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} · {e.event_date} · {e.city}
              </option>
            ))}
          </select>
          <Button
            size="lg"
            disabled={!eventId}
            onClick={() => toast.success(t("orgPos.posOpened"))}
            className="w-full mt-5 h-14 text-base bg-gradient-flame text-primary-foreground shadow-glow"
          >
            <ShoppingCart className="size-5 mr-2" /> {t("orgPos.openPosButton")}
          </Button>
          <p className="text-xs text-muted-foreground mt-4 text-center">
            {t("orgPos.afterOpenDesc")}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">{t("orgPos.titlePos")}</h1>
          <p className="text-muted-foreground mt-1">{t("orgPos.posSubtitle")}</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {activeCashier && (
            <Badge
              variant="default"
              className="gap-1.5 bg-primary/15 text-primary border-primary/30"
            >
              <UserCircle2 className="size-3.5" /> {activeCashier.display_name}
            </Badge>
          )}
          <Badge variant="outline" className="gap-1.5">
            <Usb className="size-3.5" />
            {t("orgPos.terminalLabel")}{" "}
            {terminalStatus === "connected"
              ? t("orgPos.terminalConnectedShort")
              : terminalStatus === "busy"
                ? t("orgPos.terminalBusy")
                : t("orgPos.terminalDisconnected")}
          </Badge>
          {terminalStatus !== "connected" && (
            <Button size="sm" variant="outline" onClick={connect}>
              {t("orgPos.connectTerminal")}
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to="/organizer/pos/closing">
              <FileText className="size-4 mr-2" /> {t("orgPos.dailyClosing")}
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={logoutCashier}>
            <LogOut className="size-4 mr-2" /> {t("orgPos.logoutCashier")}
          </Button>
        </div>
      </div>

      {/* Dashboard tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat
          label={t("orgPos.statRevenue")}
          value={`€${(todayStats ? todayStats.cash_total + todayStats.card_total + todayStats.transfer_total : 0).toLocaleString("sk-SK")}`}
          icon={<TrendingUp className="size-4 text-primary" />}
        />
        <Stat
          label={t("orgPos.statCash")}
          value={`€${todayStats?.cash_total.toLocaleString("sk-SK") ?? 0}`}
          icon={<Banknote className="size-4 text-primary" />}
        />
        <Stat
          label={t("orgPos.statCard")}
          value={`€${todayStats?.card_total.toLocaleString("sk-SK") ?? 0}`}
          icon={<CreditCard className="size-4 text-primary" />}
        />
        <Stat
          label={t("orgPos.statTickets")}
          value={String(todayStats?.tickets_count ?? 0)}
          icon={<TicketIcon className="size-4 text-primary" />}
        />
        <Stat
          label={t("orgPos.statVoids")}
          value={`€${todayStats?.voided_total.toLocaleString("sk-SK") ?? 0}`}
          icon={<Ban className="size-4 text-destructive" />}
        />
      </div>

      {/* ORP / eKasa card */}
      <OrpStatusCard />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* LEFT: event + tickets */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-5 bg-card/60 border-border/50">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              {t("orgPos.selectEvent")}
            </div>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("orgPos.noEvents")}{" "}
                <Link to="/organizer/events/new" className="text-primary underline">
                  {t("orgPos.addEvent")}
                </Link>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {events.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => {
                      setEventId(e.id);
                      setCart([]);
                    }}
                    className={`px-3 py-2 rounded-lg text-sm border transition ${
                      eventId === e.id
                        ? "bg-primary/15 border-primary text-foreground"
                        : "bg-muted/40 border-border/50 hover:border-primary/50"
                    }`}
                  >
                    <div className="font-medium">{e.title}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Calendar className="size-3" /> {e.event_date} · {e.city}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {sellableDates.length > 1 && (
              <div className="mt-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Termín
                </div>
                <div className="flex flex-wrap gap-2">
                  {sellableDates.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => {
                        setDateId(d.id);
                        setCart([]);
                      }}
                      className={`px-3 py-2 rounded-lg text-sm border transition ${
                        activeDate?.id === d.id
                          ? "bg-primary/15 border-primary text-foreground"
                          : "bg-muted/40 border-border/50 hover:border-primary/50"
                      }`}
                    >
                      {d.event_date} · {d.event_time}
                      {d.note && (
                        <span className="block text-[11px] text-muted-foreground">{d.note}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="p-5 bg-card/60 border-border/50">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              {t("orgPos.ticketTypes")}
            </div>
            {!selectedEvent ? (
              <p className="text-sm text-muted-foreground">{t("orgPos.selectEventFirst")}</p>
            ) : selectedEvent.tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("orgPos.noTicketsConfigured")}</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {selectedEvent.tickets.map((tk) => (
                  <button
                    key={tk.id}
                    onClick={() => addToCart(tk)}
                    className="group p-4 rounded-xl border border-border/50 bg-background hover:border-primary hover:shadow-glow transition text-left"
                  >
                    <div className="font-display font-semibold leading-tight">{tk.name}</div>
                    <div className="text-2xl font-bold mt-2">€{tk.price}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {t("orgPos.capacity", { count: tk.quantity })}
                    </div>
                    <div className="mt-3 text-xs text-primary opacity-0 group-hover:opacity-100 transition">
                      {t("orgPos.addToCart")}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT: cart */}
        <Card className="p-5 bg-card/60 border-border/50 flex flex-col h-fit lg:sticky lg:top-24">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            {t("orgPos.cart")}
          </div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {cart.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t("orgPos.cartEmpty")}
              </p>
            ) : (
              cart.map((i) => (
                <div
                  key={i.ticket.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-muted/40"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{i.ticket.name}</div>
                    <div className="text-xs text-muted-foreground">
                      €{i.ticket.price} × {i.qty}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => dec(i.ticket.id)}
                  >
                    <Minus className="size-3.5" />
                  </Button>
                  <span className="w-6 text-center text-sm">{i.qty}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => inc(i.ticket.id)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-destructive"
                    onClick={() => remove(i.ticket.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <Separator className="my-4" />
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder={t("orgPos.promoPlaceholder")}
                value={promo}
                onChange={(e) => setPromo(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && applyPromo()}
                className="h-9 font-mono"
                disabled={!!appliedCoupon}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={appliedCoupon ? clearPromo : applyPromo}
                disabled={checkingPromo || (!promo.trim() && !appliedCoupon)}
              >
                {appliedCoupon ? t("orgPos.remove") : t("orgPos.apply")}
              </Button>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("orgPos.subtotal")}</span>
              <span>€{subtotal.toFixed(2)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-sm text-primary">
                <span>
                  {appliedCoupon ? appliedCoupon.code : t("orgPos.discount", { pct: discountPct })}
                </span>
                <span>−€{discount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-display text-2xl font-bold pt-1">
              <span>{t("orgPos.total")}</span>
              <span>€{total.toFixed(2)}</span>
            </div>
          </div>

          <Separator className="my-4" />
          <div className="grid grid-cols-2 gap-2">
            <PayBtn
              icon={<Banknote className="size-5" />}
              label={t("orgPos.payCash")}
              onClick={() => checkout("cash")}
              disabled={processing || cart.length === 0}
            />
            <PayBtn
              icon={<CreditCard className="size-5" />}
              label={t("orgPos.payCard")}
              onClick={() => checkout("card")}
              disabled={processing || cart.length === 0}
              primary
            />
            <PayBtn
              icon={<Building2 className="size-5" />}
              label={t("orgPos.payTransfer")}
              onClick={() => checkout("transfer")}
              disabled={processing || cart.length === 0}
            />
            <PayBtn
              icon={<Gift className="size-5" />}
              label={t("orgPos.payGuestlist")}
              onClick={() => checkout("free")}
              disabled={processing || cart.length === 0}
            />
          </div>
        </Card>
      </div>

      {/* Recent sales */}
      <Card className="p-5 bg-card/60 border-border/50">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("orgPos.recentSales")}
          </div>
          <Badge variant="outline">{recent.length}</Badge>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("orgPos.noSales")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2">{t("orgPos.thReceipt")}</th>
                  <th className="text-left">{t("orgPos.thEvent")}</th>
                  <th className="text-left">{t("orgPos.thPayment")}</th>
                  <th className="text-right">{t("orgPos.thAmount")}</th>
                  <th className="text-left">{t("orgPos.thStatus")}</th>
                  <th className="text-left">{t("orgPos.thCashier")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr key={s.id} className="border-b border-border/30">
                    <td className="py-2 font-mono text-xs">{s.receipt_number}</td>
                    <td className="truncate max-w-[200px]">{s.event_title}</td>
                    <td className="capitalize">{s.payment_method}</td>
                    <td className="text-right">€{s.total.toFixed(2)}</td>
                    <td>
                      <Badge
                        variant={s.status === "paid" ? "default" : "destructive"}
                        className="text-[10px]"
                      >
                        {s.status === "paid" ? t("orgPos.statusPaid") : t("orgPos.statusVoid")}
                      </Badge>
                    </td>
                    <td className="text-xs text-muted-foreground">{s.cashier_name}</td>
                    <td>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() => setLastSale(s)}
                        >
                          <Receipt className="size-3.5" />
                        </Button>
                        {s.status === "paid" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-destructive"
                            onClick={() => voidLast(s.id)}
                          >
                            <Ban className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Tickets dialog */}
      <Dialog open={!!lastSale} onOpenChange={(o) => !o && setLastSale(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("orgPos.ticketsDialogTitle", { number: lastSale?.receipt_number })}
            </DialogTitle>
          </DialogHeader>
          {lastSale &&
            (() => {
              const saleTickets = lastSale.tickets.map((tk, i) => ({
                id: tk.id,
                code: tk.qr_code,
                ticket_type_name: tk.seat_label,
                price: lastSale.items[Math.min(i, lastSale.items.length - 1)]?.unit_price ?? 0,
                status: lastSale.status === "paid" ? "valid" : "void",
              }));
              const ev = events.find((e) => e.id === lastSale.event_id);
              return (
                <div className="space-y-4 text-sm">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {new Date(lastSale.created_at).toLocaleString("sk-SK")} ·{" "}
                      {lastSale.cashier_name}
                    </span>
                    <span>
                      {t("orgPos.totalLabel")}{" "}
                      <strong className="text-foreground">€{lastSale.total.toFixed(2)}</strong>
                    </span>
                  </div>
                  <div className="font-medium">{lastSale.event_title}</div>
                  <Separator />
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {t("orgPos.ticketsCreated", { count: saleTickets.length })}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {saleTickets.map((tk, idx) => (
                      <div
                        key={tk.id}
                        className="rounded-xl border border-border/50 bg-background p-3 flex gap-3 items-center"
                      >
                        <div className="aspect-square w-20 bg-white rounded-md p-1 flex items-center justify-center shrink-0">
                          <img
                            alt={t("orgPos.qrAlt")}
                            className="w-full h-full"
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(tk.code)}`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {t("orgPos.ticketNumber", { num: idx + 1 })}
                          </div>
                          <div className="font-semibold truncate">{tk.ticket_type_name}</div>
                          <div className="text-xs">€{tk.price.toFixed(2)}</div>
                          <div className="font-mono text-[10px] text-muted-foreground truncate mt-1">
                            {tk.code}
                          </div>
                          <Badge variant="outline" className="mt-1 text-[10px] uppercase">
                            {tk.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                  <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
                    <Button
                      size="sm"
                      className="bg-gradient-flame text-primary-foreground shadow-glow"
                      onClick={() => printTickets(saleTickets, lastSale, ev)}
                    >
                      <Printer className="size-4 mr-1.5" />{" "}
                      {t("orgPos.printAllTickets", { count: saleTickets.length })}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toast.success(t("orgPos.ticketsEmailed"))}
                    >
                      <Mail className="size-4 mr-1.5" /> {t("orgPos.email")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={receiptBusy}
                      onClick={() => stiahniDoklad(lastSale.id)}
                    >
                      <Receipt className="size-4 mr-1.5" /> Doklad (PDF)
                    </Button>
                  </DialogFooter>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card className="p-4 bg-card/60 border-border/50">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="font-display text-lg font-bold mt-0.5">{value}</div>
        </div>
        {icon}
      </div>
    </Card>
  );
}

function PayBtn({
  icon,
  label,
  onClick,
  disabled,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-16 rounded-xl border flex flex-col items-center justify-center gap-1 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
        primary
          ? "bg-gradient-flame text-primary-foreground border-transparent shadow-glow hover:opacity-90"
          : "bg-background border-border/50 hover:border-primary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function OrpStatusCard() {
  const { t } = useI18n();
  const settings = getFiscalSettings();
  const receipts = getFiscalReceipts();
  const last = receipts[0];
  const status = settings.connection_status;
  const connected = status === "connected";
  return (
    <Card className="p-5 bg-card/60 border-border/50">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span
            className={`size-2.5 rounded-full ${connected ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.7)]" : "bg-muted-foreground/40"}`}
          />
          <div>
            <div className="font-display font-semibold">ORP / eKasa</div>
            <div className="text-xs text-muted-foreground">
              {t("orgPos.orpStatusLabel")}{" "}
              <span className={connected ? "text-foreground font-medium" : ""}>
                {connected
                  ? t("orgPos.orpConnected")
                  : status === "error"
                    ? t("orgPos.orpError")
                    : t("orgPos.orpDisconnected")}
              </span>
              {last && (
                <>
                  {" "}
                  · {t("orgPos.orpLastReceipt")}{" "}
                  <span className="font-mono">{last.receipt_number}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/organizer/pos/fiscal">{t("orgPos.configure")}</Link>
        </Button>
      </div>
    </Card>
  );
}
