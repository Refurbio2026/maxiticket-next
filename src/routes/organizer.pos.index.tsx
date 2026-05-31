import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  getEvents, EVENTS_EVENT, type EventItem, type Ticket, uid,
} from "@/lib/local-db";
import {
  addSale, getSales, nextReceiptNumber, voidSale, logAudit,
  computeClosing, POS_EVENT, addSession, addTickets, getTickets,
  getFiscalSettings, getFiscalReceipts,
  type PaymentMethod, type PosSale, type PosSaleItem, type PosTicket,
} from "@/lib/pos-db";
import { paymentTerminal } from "@/lib/payment-terminal-adapter";
import { fiscal } from "@/lib/fiscal-adapter";
import { printTickets } from "@/lib/print-tickets";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Banknote, CreditCard, Building2, Gift, Plus, Minus, Trash2,
  Printer, Mail, Ticket as TicketIcon, Receipt, Calendar,
  TrendingUp, Ban, Usb, FileText, ShoppingCart, LogOut, UserCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { CashierLoginGate } from "@/components/pos/CashierLoginGate";
import {
  getActiveSession, getActiveCashier, closeSession as closeCashierSession,
  setActiveSessionId, type Cashier, type CashierSession,
} from "@/lib/cashier-db";

export const Route = createFileRoute("/organizer/pos/")({
  head: () => ({ meta: [{ title: "Pokladňa · MAXITICKET" }] }),
  component: PosPage,
});

type CartItem = { ticket: Ticket; qty: number };

function PosPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [promo, setPromo] = useState<string>("");
  const [terminalStatus, setTerminalStatus] = useState<"disconnected" | "connected" | "busy" | "error">("disconnected");
  const [processing, setProcessing] = useState(false);
  const [lastSale, setLastSale] = useState<PosSale | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [activeCashier, setActiveCashier] = useState<Cashier | null>(null);
  const [activeSession, setActiveSession] = useState<CashierSession | null>(null);

  // Hydrate active cashier session from localStorage
  useEffect(() => {
    setActiveCashier(getActiveCashier());
    setActiveSession(getActiveSession());
  }, [refresh]);

  useEffect(() => {
    const load = () => {
      if (!user) return setEvents([]);
      setEvents(getEvents().filter((e) => user.role === "admin" || e.organizer_id === user.id));
    };
    load();
    const tick = () => setRefresh((r) => r + 1);
    window.addEventListener(EVENTS_EVENT, load);
    window.addEventListener(POS_EVENT, tick);
    return () => {
      window.removeEventListener(EVENTS_EVENT, load);
      window.removeEventListener(POS_EVENT, tick);
    };
  }, [user]);

  const selectedEvent = useMemo(() => events.find((e) => e.id === eventId), [events, eventId]);

  const subtotal = cart.reduce((s, i) => s + i.ticket.price * i.qty, 0);
  const discount = Math.round((subtotal * discountPct) / 100 * 100) / 100;
  const total = Math.max(0, subtotal - discount);

  const addToCart = (t: Ticket) => {
    setCart((c) => {
      const i = c.findIndex((x) => x.ticket.id === t.id);
      if (i >= 0) { const next = [...c]; next[i] = { ...next[i], qty: next[i].qty + 1 }; return next; }
      return [...c, { ticket: t, qty: 1 }];
    });
  };
  const inc = (id: string) => setCart((c) => c.map((i) => i.ticket.id === id ? { ...i, qty: i.qty + 1 } : i));
  const dec = (id: string) => setCart((c) => c.flatMap((i) => i.ticket.id === id ? (i.qty <= 1 ? [] : [{ ...i, qty: i.qty - 1 }]) : [i]));
  const remove = (id: string) => setCart((c) => c.filter((i) => i.ticket.id !== id));
  const applyPromo = () => {
    const code = promo.trim().toUpperCase();
    if (!code) return;
    const map: Record<string, number> = { WELCOME10: 10, VIP20: 20, EARLYBIRD: 15 };
    if (map[code]) { setDiscountPct(map[code]); toast.success(`Promo aplikované: -${map[code]}%`); }
    else { toast.error("Neplatný promo kód"); }
  };

  const connect = async () => {
    setTerminalStatus("busy");
    const s = await paymentTerminal.connectTerminal();
    setTerminalStatus(s);
    toast.success("Platobný terminál pripojený (USB mock)");
  };

  const checkout = async (method: PaymentMethod) => {
    if (!user || !selectedEvent || cart.length === 0) return;
    if (!activeCashier || !activeSession) {
      toast.error("Najprv sa prihláste ako pokladník");
      return;
    }
    if (!activeCashier.permissions.includes("sale")) {
      toast.error("Tento pokladník nemá oprávnenie predávať");
      return;
    }
    setProcessing(true);
    try {
      const order_id = uid();
      let terminal_tx_id: string | undefined;
      if (method === "card") {
        if (terminalStatus !== "connected") await paymentTerminal.connectTerminal();
        const r = await paymentTerminal.sendPayment(total, "EUR", order_id, user.id);
        if (!r.ok) throw new Error(r.error || "Platba zamietnutá");
        terminal_tx_id = r.tx_id;
      }
      const orpSettings = getFiscalSettings();
      let fr: Awaited<ReturnType<typeof fiscal.createReceipt>> | null = null;
      if (orpSettings.connection_status === "connected") {
        fr = await fiscal.createReceipt({
          organizer_id: user.id,
          sale_id: order_id,
          total,
          payment_method: method,
          items: cart.map((i) => ({ name: i.ticket.name, qty: i.qty, unit_price: i.ticket.price })),
        });
        await fiscal.sendReceiptToFiscalSystem(fr);
      }

      const items: PosSaleItem[] = cart.map((i) => ({
        ticket_id: i.ticket.id, ticket_name: i.ticket.name,
        unit_price: i.ticket.price, quantity: i.qty, subtotal: i.ticket.price * i.qty,
      }));
      const qr_codes: string[] = [];
      const tickets: PosTicket[] = [];
      for (const i of cart) {
        for (let k = 0; k < i.qty; k++) {
          const tid = uid();
          // unikátny QR kód per kus
          const code = `MT-${order_id}-${i.ticket.id}-${tid}`;
          qr_codes.push(code);
          tickets.push({
            id: tid, code,
            organizer_id: user.id, event_id: selectedEvent.id,
            sale_id: order_id, ticket_type_id: i.ticket.id, ticket_type_name: i.ticket.name,
            price: i.ticket.price, status: "valid",
            created_at: new Date().toISOString(),
          });
        }
      }
      addTickets(tickets);

      const sale: PosSale = {
        id: order_id,
        receipt_number: nextReceiptNumber(),
        organizer_id: user.id,
        cashier_id: activeCashier.id,
        cashier_name: activeCashier.display_name,
        cashier_session_id: activeSession.id,
        event_id: selectedEvent.id,
        event_title: selectedEvent.title,
        items, subtotal, discount,
        promo_code: discountPct > 0 ? promo.toUpperCase() : undefined,
        total,
        payment_method: method,
        status: "paid",
        fiscal_receipt_id: fr?.id,
        terminal_tx_id,
        created_at: new Date().toISOString(),
        qr_codes,
      };
      addSale(sale);
      logAudit({
        user_id: user.id, user_name: user.full_name || user.email,
        action: "pos.sale", entity: "pos_sales", entity_id: sale.id,
        meta: { total, method, tickets: qr_codes.length, receipt: sale.receipt_number },
      });
      setLastSale(sale);
      setCart([]); setDiscountPct(0); setPromo("");
      toast.success(`Predaj dokončený · doklad ${sale.receipt_number}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chyba pri spracovaní platby");
    } finally {
      setProcessing(false);
    }
  };

  // Dashboard data
  const today = new Date().toISOString().slice(0, 10);
  const todayStats = user ? computeClosing(user.id, today) : null;
  const recent = user ? getSales().filter((s) => s.organizer_id === user.id).slice(0, 8) : [];
  void refresh;

  const voidLast = (id: string) => {
    const reason = prompt("Dôvod storna:") || "";
    if (!reason) return;
    voidSale(id, reason);
    if (user) logAudit({
      user_id: user.id, user_name: user.full_name || user.email,
      action: "pos.void", entity: "pos_sales", entity_id: id, meta: { reason },
    });
    toast.success("Predaj stornovaný");
  };

  // Cashier login gate — must happen before everything else.
  if (user && (!activeCashier || !activeSession)) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-4xl font-bold tracking-tight">Pokladňa / eKasa</h1>
        <CashierLoginGate
          organizerId={user.id}
          onAuthed={(c, s) => { setActiveCashier(c); setActiveSession(s); }}
        />
      </div>
    );
  }

  const logoutCashier = () => {
    if (!activeSession) return;
    if (!confirm("Odhlásiť pokladníka a uzavrieť jeho session?")) return;
    closeCashierSession(activeSession.id);
    setActiveSessionId(null);
    setActiveCashier(null);
    setActiveSession(null);
    setCart([]); setEventId("");
    toast.success("Pokladník odhlásený");
  };

  // No events at all
  if (events.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-4xl font-bold tracking-tight">Pokladňa / POS</h1>
        <Card className="p-12 text-center bg-card/60 border-dashed border-border/50 max-w-xl mx-auto">
          <TicketIcon className="size-12 text-muted-foreground mx-auto mb-4" />
          <div className="font-display text-xl font-bold">Najprv vytvorte podujatie</div>
          <p className="text-sm text-muted-foreground mt-2">
            Pokladňu môžete otvoriť až po vytvorení podujatia s nakonfigurovanými vstupenkami.
          </p>
          <Button asChild className="mt-6 bg-gradient-flame text-primary-foreground shadow-glow">
            <Link to="/organizer/events/new">Vytvoriť podujatie</Link>
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
          <h1 className="font-display text-4xl font-bold tracking-tight">Otvoriť pokladňu</h1>
          <p className="text-muted-foreground mt-1">Vyber podujatie, pre ktoré chceš predávať vstupenky.</p>
        </div>
        <Card className="p-8 bg-card/60 border-border/50 max-w-2xl">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Vyber podujatie</div>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="w-full h-12 rounded-xl bg-background border border-border/50 px-4 text-base focus:outline-none focus:border-primary"
          >
            <option value="">— Vyberte podujatie —</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} · {e.event_date} · {e.city}
              </option>
            ))}
          </select>
          <Button
            size="lg"
            disabled={!eventId}
            onClick={() => {
              if (user && eventId) {
                const ev = events.find((e) => e.id === eventId);
                addSession({
                  id: uid(), organizer_id: user.id,
                  cashier_id: user.id, cashier_name: user.full_name || user.email,
                  event_id: eventId, event_title: ev?.title || "",
                  opened_at: new Date().toISOString(), status: "open",
                });
                logAudit({
                  user_id: user.id, user_name: user.full_name || user.email,
                  action: "pos.session_open", entity: "pos_sessions", entity_id: eventId,
                });
                toast.success("Pokladňa otvorená");
              }
            }}
            className="w-full mt-5 h-14 text-base bg-gradient-flame text-primary-foreground shadow-glow"
          >
            <ShoppingCart className="size-5 mr-2" /> OTVORIŤ POKLADŇU
          </Button>
          <p className="text-xs text-muted-foreground mt-4 text-center">
            Po otvorení sa zobrazí predajná obrazovka s vstupenkami a košíkom.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Pokladňa / POS</h1>
          <p className="text-muted-foreground mt-1">Fyzický predaj vstupeniek na mieste podujatia.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {activeCashier && (
            <Badge variant="default" className="gap-1.5 bg-primary/15 text-primary border-primary/30">
              <UserCircle2 className="size-3.5" /> {activeCashier.display_name}
            </Badge>
          )}
          <Badge variant="outline" className="gap-1.5">
            <Usb className="size-3.5" />
            Terminál: {terminalStatus === "connected" ? "pripojený" : terminalStatus === "busy" ? "spracovanie…" : "odpojený"}
          </Badge>
          {terminalStatus !== "connected" && (
            <Button size="sm" variant="outline" onClick={connect}>Pripojiť terminál</Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to="/organizer/pos/closing"><FileText className="size-4 mr-2" /> Denná uzávierka</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={logoutCashier}>
            <LogOut className="size-4 mr-2" /> Odhlásiť pokladníka
          </Button>
        </div>
            <Button size="sm" variant="outline" onClick={connect}>Pripojiť terminál</Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to="/organizer/pos/closing"><FileText className="size-4 mr-2" /> Denná uzávierka</Link>
          </Button>
        </div>
      </div>

      {/* Dashboard tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Dnešné tržby" value={`€${(todayStats ? todayStats.cash_total + todayStats.card_total + todayStats.transfer_total : 0).toLocaleString("sk-SK")}`} icon={<TrendingUp className="size-4 text-primary" />} />
        <Stat label="Hotovosť" value={`€${todayStats?.cash_total.toLocaleString("sk-SK") ?? 0}`} icon={<Banknote className="size-4 text-primary" />} />
        <Stat label="Karta" value={`€${todayStats?.card_total.toLocaleString("sk-SK") ?? 0}`} icon={<CreditCard className="size-4 text-primary" />} />
        <Stat label="Vstupeniek" value={String(todayStats?.tickets_count ?? 0)} icon={<TicketIcon className="size-4 text-primary" />} />
        <Stat label="Storná" value={`€${todayStats?.voided_total.toLocaleString("sk-SK") ?? 0}`} icon={<Ban className="size-4 text-destructive" />} />
      </div>

      {/* ORP / eKasa card */}
      <OrpStatusCard />


      <div className="grid lg:grid-cols-3 gap-6">
        {/* LEFT: event + tickets */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-5 bg-card/60 border-border/50">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Vyber podujatie</div>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nemáš žiadne podujatia. <Link to="/organizer/events/new" className="text-primary underline">Pridať podujatie</Link></p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {events.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => { setEventId(e.id); setCart([]); }}
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
          </Card>

          <Card className="p-5 bg-card/60 border-border/50">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Typy vstupeniek</div>
            {!selectedEvent ? (
              <p className="text-sm text-muted-foreground">Najprv vyber podujatie.</p>
            ) : selectedEvent.tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Toto podujatie nemá nakonfigurované vstupenky.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {selectedEvent.tickets.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => addToCart(t)}
                    className="group p-4 rounded-xl border border-border/50 bg-background hover:border-primary hover:shadow-glow transition text-left"
                  >
                    <div className="font-display font-semibold leading-tight">{t.name}</div>
                    <div className="text-2xl font-bold mt-2">€{t.price}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">Kapacita: {t.quantity}</div>
                    <div className="mt-3 text-xs text-primary opacity-0 group-hover:opacity-100 transition">+ Pridať do košíka</div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT: cart */}
        <Card className="p-5 bg-card/60 border-border/50 flex flex-col h-fit lg:sticky lg:top-24">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Košík</div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {cart.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Košík je prázdny</p>
            ) : cart.map((i) => (
              <div key={i.ticket.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/40">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{i.ticket.name}</div>
                  <div className="text-xs text-muted-foreground">€{i.ticket.price} × {i.qty}</div>
                </div>
                <Button size="icon" variant="ghost" className="size-7" onClick={() => dec(i.ticket.id)}><Minus className="size-3.5" /></Button>
                <span className="w-6 text-center text-sm">{i.qty}</span>
                <Button size="icon" variant="ghost" className="size-7" onClick={() => inc(i.ticket.id)}><Plus className="size-3.5" /></Button>
                <Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => remove(i.ticket.id)}><Trash2 className="size-3.5" /></Button>
              </div>
            ))}
          </div>

          <Separator className="my-4" />
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input placeholder="Promo kód" value={promo} onChange={(e) => setPromo(e.target.value)} className="h-9" />
              <Button variant="outline" size="sm" onClick={applyPromo}>Použiť</Button>
            </div>
            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Medzisúčet</span><span>€{subtotal.toFixed(2)}</span></div>
            {discount > 0 && (
              <div className="flex justify-between text-sm text-primary"><span>Zľava ({discountPct}%)</span><span>−€{discount.toFixed(2)}</span></div>
            )}
            <div className="flex justify-between font-display text-2xl font-bold pt-1">
              <span>Spolu</span><span>€{total.toFixed(2)}</span>
            </div>
          </div>

          <Separator className="my-4" />
          <div className="grid grid-cols-2 gap-2">
            <PayBtn icon={<Banknote className="size-5" />} label="Hotovosť" onClick={() => checkout("cash")} disabled={processing || cart.length === 0} />
            <PayBtn icon={<CreditCard className="size-5" />} label="Karta" onClick={() => checkout("card")} disabled={processing || cart.length === 0} primary />
            <PayBtn icon={<Building2 className="size-5" />} label="Prevod" onClick={() => checkout("transfer")} disabled={processing || cart.length === 0} />
            <PayBtn icon={<Gift className="size-5" />} label="Guestlist" onClick={() => checkout("free")} disabled={processing || cart.length === 0} />
          </div>
        </Card>
      </div>

      {/* Recent sales */}
      <Card className="p-5 bg-card/60 border-border/50">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Posledné predaje</div>
          <Badge variant="outline">{recent.length}</Badge>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatiaľ žiadne predaje.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr><th className="text-left py-2">Doklad</th><th className="text-left">Podujatie</th><th className="text-left">Platba</th><th className="text-right">Suma</th><th className="text-left">Stav</th><th className="text-left">Pokladník</th><th></th></tr>
              </thead>
              <tbody>
                {recent.map((s) => (
                  <tr key={s.id} className="border-b border-border/30">
                    <td className="py-2 font-mono text-xs">{s.receipt_number}</td>
                    <td className="truncate max-w-[200px]">{s.event_title}</td>
                    <td className="capitalize">{s.payment_method}</td>
                    <td className="text-right">€{s.total.toFixed(2)}</td>
                    <td>
                      <Badge variant={s.status === "paid" ? "default" : "destructive"} className="text-[10px]">
                        {s.status === "paid" ? "Zaplatené" : "Storno"}
                      </Badge>
                    </td>
                    <td className="text-xs text-muted-foreground">{s.cashier_name}</td>
                    <td>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="size-7" onClick={() => setLastSale(s)}><Receipt className="size-3.5" /></Button>
                        {s.status === "paid" && (
                          <Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => voidLast(s.id)}><Ban className="size-3.5" /></Button>
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
            <DialogTitle>Vstupenky · doklad {lastSale?.receipt_number}</DialogTitle>
          </DialogHeader>
          {lastSale && (() => {
            const saleTickets = getTickets().filter((t) => t.sale_id === lastSale.id);
            const ev = events.find((e) => e.id === lastSale.event_id);
            return (
              <div className="space-y-4 text-sm">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{new Date(lastSale.created_at).toLocaleString("sk-SK")} · {lastSale.cashier_name}</span>
                  <span>Spolu: <strong className="text-foreground">€{lastSale.total.toFixed(2)}</strong></span>
                </div>
                <div className="font-medium">{lastSale.event_title}</div>
                <Separator />
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Vytvorených vstupeniek: {saleTickets.length} (1 kus = 1 unikátna vstupenka)
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {saleTickets.map((t, idx) => (
                    <div key={t.id} className="rounded-xl border border-border/50 bg-background p-3 flex gap-3 items-center">
                      <div className="aspect-square w-20 bg-white rounded-md p-1 flex items-center justify-center shrink-0">
                        <img alt="QR" className="w-full h-full" src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(t.code)}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Vstupenka #{idx + 1}</div>
                        <div className="font-semibold truncate">{t.ticket_type_name}</div>
                        <div className="text-xs">€{t.price.toFixed(2)}</div>
                        <div className="font-mono text-[10px] text-muted-foreground truncate mt-1">{t.code}</div>
                        <Badge variant="outline" className="mt-1 text-[10px] uppercase">{t.status}</Badge>
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
                    <Printer className="size-4 mr-1.5" /> Vytlačiť všetky vstupenky ({saleTickets.length})
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => toast.success("Vstupenky odoslané emailom")}>
                    <Mail className="size-4 mr-1.5" /> Email
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => window.print()}>
                    <Receipt className="size-4 mr-1.5" /> Vytlačiť doklad
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

function PayBtn({ icon, label, onClick, disabled, primary }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
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
  const settings = getFiscalSettings();
  const receipts = getFiscalReceipts();
  const last = receipts[0];
  const status = settings.connection_status;
  const connected = status === "connected";
  return (
    <Card className="p-5 bg-card/60 border-border/50">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className={`size-2.5 rounded-full ${connected ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.7)]" : "bg-muted-foreground/40"}`} />
          <div>
            <div className="font-display font-semibold">ORP / eKasa</div>
            <div className="text-xs text-muted-foreground">
              Stav: <span className={connected ? "text-foreground font-medium" : ""}>{connected ? "Pripojené" : status === "error" ? "Chyba" : "Nepripojené"}</span>
              {last && <> · Posledný doklad: <span className="font-mono">{last.receipt_number}</span></>}
            </div>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/organizer/pos/fiscal">Konfigurovať</Link>
        </Button>
      </div>
    </Card>
  );
}
