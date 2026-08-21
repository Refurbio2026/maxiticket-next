// Server functions for the GoPay + SuperFaktúra checkout flow.
// Keep this file thin: only createServerFn declarations and their imports.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createGoPayPayment, getGoPayPaymentStatus, mapGoPayStateToOrder } from "./gopay.server";
import { createPaidInvoice } from "./superfaktura.server";
import { signOrderAccess, verifyOrderAccess } from "./order-access.server";
import { newSignedTicket } from "./qr-token.server";
import { sendTicketsEmail } from "./ticket-mail.server";
import { checkCoupon, couponErrorMessage, releaseCoupon, recordRedemption } from "./coupons.server";
import { loadSeatPricing } from "./seat-pricing.server";
import { getRequest } from "@tanstack/react-start/server";

/**
 * IP klienta spoza nginxu.
 *
 * Berieme `X-Real-IP`, ktorý nginx nastavuje na `$remote_addr` a teda prepíše
 * čokoľvek, čo poslal klient. `X-Forwarded-For` je zoznam, do ktorého nginx len
 * pripája — jeho *prvá* položka pochádza od klienta a dá sa podvrhnúť, preto
 * z neho berieme poslednú.
 */
function clientIp(): string {
  try {
    const h = getRequest()?.headers;
    const real = h?.get("x-real-ip");
    if (real) return real.trim();
    const fwd = h?.get("x-forwarded-for");
    if (fwd) {
      const parts = fwd.split(",");
      return parts[parts.length - 1].trim();
    }
  } catch {
    /* mimo requestu (napr. cron) — limit sa potom viaže na "unknown" */
  }
  return "unknown";
}

/** Zaráta pokus; pri prekročení limitu vyhodí zrozumiteľnú chybu. */
async function enforceRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
  message: string,
) {
  const { data: allowed, error } = await supabaseAdmin.rpc("hit_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  // Pri chybe počítadla radšej požiadavku pustíme, než aby výpadok limitu
  // zastavil predaj — limit je ochrana, nie kritická cesta.
  if (error) {
    console.error("rate limit zlyhal", bucket, error.message);
    return;
  }
  if (allowed === false) throw new Error(message);
}

function getOrigin(): string {
  const fromEnv = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return "https://project--dff07d0a-f011-4a35-b195-c8c7bc1b200f-dev.lovable.app";
}

// Server-side admin check for privileged operations.
async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

/** Bežný strop v ticketingu; bráni aj skupovaniu celej sály jednou objednávkou. */
const MAX_TICKETS_PER_ORDER = 20;
/** Koľko nedoplatených objednávok smie jeden e-mail držať naraz. */
const MAX_OPEN_ORDERS_PER_EMAIL = 2;

const CustomerSchema = z.object({
  first_name: z.string().min(1).max(120),
  last_name: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().max(40).optional().nullable(),
});

// BEZPEČNOSŤ: klient posiela LEN to, ČO kupuje — nikdy za koľko. Cenu aj názov
// položky odvodí server z databázy. Predtým sem chodilo `unit_price` z
// prehliadača a total sa počítal z neho, takže stačilo poslať `unit_price: 0`
// a odísť s platnou vstupenkou zadarmo.
const ItemSchema = z.object({
  ticket_type_id: z.string().uuid().optional().nullable(),
  seat_id: z.string().max(120).optional().nullable(),
  seat_label: z.string().max(200).optional().nullable(),
  is_vip: z.boolean().optional().default(false),
  quantity: z.number().int().positive().max(50).default(1),
});

type PricedItem = {
  ticket_type_id: string | null;
  seat_id: string | null;
  label: string;
  unit_price: number;
  quantity: number;
  is_vip: boolean;
};

/**
 * Koľko kusov daného typu už drží nevypršaná alebo zaplatená objednávka.
 * Počíta sa v rámci TERMÍNU — vypredaná piatková repríza nesmie zavrieť predaj
 * na sobotu.
 */
async function committedQuantity(
  eventDateId: string,
  ticketTypeId: string | null,
): Promise<number> {
  let q = supabaseAdmin
    .from("order_items")
    .select("quantity, orders!inner(event_date_id, status)")
    .eq("orders.event_date_id", eventDateId)
    .in("orders.status", ["pending", "awaiting_payment", "paid"]);
  q = ticketTypeId ? q.eq("ticket_type_id", ticketTypeId) : q.is("ticket_type_id", null);
  const { data } = await q;
  return (data || []).reduce((s, r: { quantity: number }) => s + (r.quantity || 0), 0);
}

// 1) Submit order: create Supabase order + items + seat_inventory reservation.
export const submitOrder = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        event_id: z.string().uuid(),
        // Ktorý termín sa kupuje. Bez neho vezmeme najbližší v predaji, aby
        // staršie odkazy a jednodňové podujatia fungovali ako doteraz.
        event_date_id: z.string().uuid().optional(),
        customer: CustomerSchema,
        items: z.array(ItemSchema).min(1).max(100),
        // Kód zľavového kupónu. Zľavu počíta server — klient posiela len kód.
        coupon_code: z.string().max(40).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // Uvoľní sedadlá po nedokončených objednávkach, aby kontrola kapacity
    // aj rezervácia videli aktuálny stav.
    await supabaseAdmin.rpc("expire_stale_orders");

    // --- Ochrana pred zablokovaním sály ---
    // Rezervácia drží sedadlá 15 minút, takže bez limitu vie skript udržať celú
    // sálu obsadenú donekonečna. Limitujeme podľa IP aj e-mailu — samotný e-mail
    // by útočník menil, samotná IP by potrestala celú firemnú sieť za NAT-om.
    const email = data.customer.email.toLowerCase();
    await enforceRateLimit(
      `order:ip:${clientIp()}`,
      20,
      3600,
      "Príliš veľa pokusov o objednávku. Skús to prosím o chvíľu.",
    );
    await enforceRateLimit(
      `order:email:${email}`,
      10,
      3600,
      "Z tejto e-mailovej adresy prišlo priveľa objednávok. Skús to prosím neskôr.",
    );

    // Koľko vstupeniek je vôbec rozumné kúpiť naraz.
    const totalQuantity = data.items.reduce((s, it) => s + it.quantity, 0);
    if (totalQuantity > MAX_TICKETS_PER_ORDER) {
      throw new Error(`Naraz sa dá kúpiť najviac ${MAX_TICKETS_PER_ORDER} vstupeniek.`);
    }

    // Koľko nedoplatených objednávok smie jeden kupujúci držať súčasne. Bez
    // toho by stačilo objednávať dokola a sedadlá by sa nikdy neuvoľnili.
    const { count: openOrders } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .ilike("customer_email", email)
      .in("status", ["pending", "awaiting_payment"])
      .gt("expires_at", new Date().toISOString());
    if ((openOrders ?? 0) >= MAX_OPEN_ORDERS_PER_EMAIL) {
      throw new Error(
        "Máš rozpracovanú objednávku, ktorá ešte čaká na platbu. Dokonči ju alebo počkaj, kým vyprší.",
      );
    }

    const { data: event } = await supabaseAdmin
      .from("events")
      .select("id, status, base_price, vip_price, total_tickets, venue_layout_id")
      .eq("id", data.event_id)
      .maybeSingle();
    if (!event) throw new Error("Podujatie sa nenašlo");
    if (event.status !== "published") throw new Error("Podujatie nie je v predaji");

    // --- Termín ---
    // Kupuje sa vždy konkrétny termín. Ten určuje obsadenosť sedadiel aj
    // kapacitu, takže si ho server overí sám — klient ho nesmie „prehodiť"
    // na cudzie podujatie.
    const today = new Date().toISOString().slice(0, 10);
    let eventDate: { id: string; total_tickets: number | null };
    if (data.event_date_id) {
      const { data: row } = await supabaseAdmin
        .from("event_dates")
        .select("id, event_id, status, total_tickets, event_date")
        .eq("id", data.event_date_id)
        .maybeSingle();
      if (!row || row.event_id !== data.event_id) throw new Error("Termín sa nenašiel");
      if (row.status !== "on_sale") throw new Error("Tento termín nie je v predaji");
      if (row.event_date < today) throw new Error("Tento termín už prebehol");
      eventDate = { id: row.id, total_tickets: row.total_tickets };
    } else {
      const { data: rows } = await supabaseAdmin
        .from("event_dates")
        .select("id, total_tickets, event_date, event_time")
        .eq("event_id", data.event_id)
        .eq("status", "on_sale")
        .gte("event_date", today)
        .order("event_date", { ascending: true })
        .order("event_time", { ascending: true })
        .limit(1);
      const nearest = rows?.[0];
      if (!nearest) throw new Error("Podujatie nemá žiadny termín v predaji");
      eventDate = { id: nearest.id, total_tickets: nearest.total_tickets };
    }

    const { data: ticketTypes } = await supabaseAdmin
      .from("ticket_types")
      .select("id, name, price, quantity")
      .eq("event_id", data.event_id);
    const typeById = new Map((ticketTypes || []).map((t) => [t.id, t]));

    const basePrice = Number(event.base_price ?? 0);
    const vipPrice = event.vip_price === null ? basePrice : Number(event.vip_price);

    // Cenu sedadla určuje jeho zóna v rozložení sály, nie klient. Spoločné
    // ocenenie s pokladňou je v `seat-pricing.server.ts`.
    const pricing = await loadSeatPricing({
      eventId: data.event_id,
      venueLayoutId: event.venue_layout_id,
      basePrice,
      vipPrice,
    });

    // --- Ocenenie na serveri ---
    const priced: PricedItem[] = data.items.map((it) => {
      if (it.ticket_type_id) {
        const tt = typeById.get(it.ticket_type_id);
        if (!tt) throw new Error("Neplatný typ vstupenky");
        return {
          ticket_type_id: tt.id,
          seat_id: it.seat_id || null,
          label: tt.name,
          unit_price: Number(tt.price),
          quantity: it.quantity,
          is_vip: !!it.is_vip,
        };
      }
      if (it.seat_id) {
        // Zónu aj cenu si server zisťuje sám z rozloženia sály. Príznak od
        // klienta sa ignoruje — inak by si kupujúci označil VIP sedadlo za
        // obyčajné a zaplatil základnú cenu.
        const vip = pricing.isVip(it.seat_id);
        return {
          ticket_type_id: null,
          seat_id: it.seat_id,
          label: it.seat_label || it.seat_id,
          unit_price: pricing.priceFor(it.seat_id),
          quantity: 1,
          is_vip: vip,
        };
      }
      return {
        ticket_type_id: null,
        seat_id: null,
        label: "Vstupenka",
        unit_price: basePrice,
        quantity: it.quantity,
        is_vip: false,
      };
    });

    if (priced.some((p) => p.unit_price <= 0)) {
      throw new Error("Podujatie nemá nastavenú cenu vstupenky");
    }

    // --- Kontrola kapacity pre položky bez sedadla ---
    // Sedadlové položky si kapacitu strážia samy (jedno sedadlo = jeden riadok).
    const seatless = priced.filter((p) => !p.seat_id);
    const byType = new Map<string | null, number>();
    for (const p of seatless) {
      byType.set(p.ticket_type_id, (byType.get(p.ticket_type_id) || 0) + p.quantity);
    }
    for (const [typeId, requested] of byType) {
      // Kapacita termínu má prednosť pred kapacitou podujatia — matiné môže mať
      // otvorený menší sektor než večerné predstavenie.
      const capacity = typeId
        ? Number(typeById.get(typeId)?.quantity ?? 0)
        : Number(eventDate.total_tickets ?? event.total_tickets ?? 0);
      if (capacity <= 0) continue; // 0 = kapacita nie je nastavená, nelimitujeme
      const taken = await committedQuantity(eventDate.id, typeId);
      if (taken + requested > capacity) {
        const left = Math.max(0, capacity - taken);
        throw new Error(
          left === 0
            ? "Vstupenky sú vypredané."
            : `K dispozícii je už len ${left} ks. Uprav prosím počet.`,
        );
      }
    }

    const subtotal = priced.reduce((s, it) => s + it.unit_price * it.quantity, 0);

    // --- Zľavový kupón ---
    // Uplatňuje ho server: klient pošle iba kód, sumu ani percento nie.
    // `claim: true` zároveň zvýši počítadlo použití v tej istej transakcii,
    // takže dvaja súbežní kupujúci nemôžu minúť to isté posledné použitie.
    // Keď objednávka ďalej neprejde, použitie vrátime cez `releaseCoupon`.
    let couponId: string | null = null;
    let discount = 0;
    if (data.coupon_code?.trim()) {
      const result = await checkCoupon({
        code: data.coupon_code,
        eventId: data.event_id,
        amount: subtotal,
        email,
        claim: true,
      });
      if (!result.ok) throw new Error(couponErrorMessage(result.error));
      couponId = result.coupon_id;
      discount = result.discount;
    }

    const total = Math.round((subtotal - discount) * 100) / 100;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        event_id: data.event_id,
        event_date_id: eventDate.id,
        customer_name: `${data.customer.first_name} ${data.customer.last_name}`.trim(),
        customer_email: data.customer.email,
        customer_phone: data.customer.phone || null,
        total_amount: total,
        discount_amount: discount,
        coupon_id: couponId,
        promo_code: couponId ? data.coupon_code!.trim().toUpperCase() : null,
        currency: "EUR",
        status: "pending",
        expires_at: expiresAt,
      })
      .select()
      .single();
    if (orderErr || !order) {
      if (couponId) await releaseCoupon(couponId);
      throw new Error(orderErr?.message || "Nepodarilo sa vytvoriť objednávku");
    }

    const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(
      priced.map((it) => ({
        order_id: order.id,
        ticket_type_id: it.ticket_type_id,
        seat_id: it.seat_id,
        label: it.label,
        unit_price: it.unit_price,
        quantity: it.quantity,
      })),
    );
    if (itemsErr) {
      if (couponId) await releaseCoupon(couponId);
      throw new Error(itemsErr.message);
    }

    // Rezervácia sedadiel je jeden atómický príkaz v databáze (reserve_seats).
    // Kontrola obsadenosti a zápis sa už nedajú rozdeliť, takže dvaja súbežní
    // kupujúci nemôžu dostať to isté sedadlo.
    const seats = priced.filter((p) => p.seat_id);
    if (seats.length > 0) {
      const { error: seatErr } = await supabaseAdmin.rpc("reserve_seats", {
        p_event_id: data.event_id,
        p_event_date_id: eventDate.id,
        p_order_id: order.id,
        p_reserved_until: expiresAt,
        p_seats: seats.map((s) => ({
          seat_id: s.seat_id,
          label: s.label,
          price: s.unit_price,
          is_vip: s.is_vip,
        })),
      });
      if (seatErr) {
        // Objednávka ostala bez sedadiel — zmažeme ju, nech nezavadzia.
        await supabaseAdmin.from("order_items").delete().eq("order_id", order.id);
        await supabaseAdmin.from("orders").delete().eq("id", order.id);
        if (couponId) await releaseCoupon(couponId);
        throw new Error(
          seatErr.message?.includes("SEATS_TAKEN")
            ? "Niektoré sedadlá si medzitým vzal iný kupujúci. Vyber prosím iné."
            : seatErr.message,
        );
      }
    }

    // Uplatnenie zapisujeme až keď je objednávka kompletná — z týchto riadkov
    // sa počíta limit na e-mail aj prehľad využitia kupónu.
    if (couponId) {
      await recordRedemption({ couponId, orderId: order.id, email, discount });
    }

    return { order_id: order.id, total_amount: total, discount_amount: discount };
  });

// 2) Create GoPay payment for an existing pending order.
export const createGoPayPaymentForOrder = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", data.order_id)
      .single();
    if (error || !order) throw new Error("Objednávka sa nenašla");
    if (order.status !== "pending" && order.status !== "awaiting_payment") {
      throw new Error(`Objednávka má stav ${order.status}, nedá sa znovu zaplatiť`);
    }
    if (order.gopay_payment_url && order.status === "awaiting_payment") {
      return { payment_url: order.gopay_payment_url, payment_id: order.gopay_payment_id };
    }
    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("*")
      .eq("order_id", order.id);

    const origin = getOrigin();
    const orderShort = order.id.slice(0, 8).toUpperCase();

    let result;
    try {
      result = await createGoPayPayment({
        orderNumber: orderShort,
        orderDescription: `Vstupenky vipky.sk ${orderShort}`,
        amountCents: Math.round(Number(order.total_amount) * 100),
        currency: order.currency || "EUR",
        customer: {
          firstName: (order.customer_name || "").split(" ")[0] || "",
          lastName: (order.customer_name || "").split(" ").slice(1).join(" ") || "",
          email: order.customer_email || "",
          phone: order.customer_phone || "",
        },
        items: (items || []).map((it) => ({
          name: it.label,
          amountCents: Math.round(Number(it.unit_price) * 100),
          count: it.quantity || 1,
        })),
        returnUrl: `${origin}/checkout/return?orderId=${order.id}&t=${signOrderAccess(order.id)}`,
        notificationUrl: `${origin}/api/public/payments/gopay/webhook?orderId=${order.id}`,
        lang: "SK",
      });
    } catch (e: any) {
      await supabaseAdmin.from("payment_logs").insert({
        order_id: order.id,
        provider: "gopay",
        endpoint: "/payments/payment",
        request_payload: { order_id: order.id },
        status: "error",
        error_message: String(e?.message || e),
      });
      throw e;
    }

    await supabaseAdmin.from("payment_logs").insert({
      order_id: order.id,
      provider: "gopay",
      endpoint: "/payments/payment",
      request_payload: { order_id: order.id, total: order.total_amount },
      response_payload: result.raw as any,
      status: "ok",
    });

    await supabaseAdmin
      .from("orders")
      .update({
        gopay_payment_id: String(result.id),
        gopay_payment_url: result.gw_url,
        status: "awaiting_payment",
      })
      .eq("id", order.id);

    await supabaseAdmin.from("payments").insert({
      order_id: order.id,
      provider: "gopay",
      provider_payment_id: String(result.id),
      amount: order.total_amount,
      currency: order.currency || "EUR",
      status: "pending",
      raw_response: result.raw as any,
    });

    return { payment_url: result.gw_url, payment_id: String(result.id) };
  });

// Internal helper used by the webhook + verify endpoint.
async function settleOrderIfPaid(orderId: string) {
  const { data: order } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).single();
  if (!order) throw new Error("Objednávka sa nenašla");
  if (!order.gopay_payment_id) {
    return { changed: false, status: order.status, reason: "no_payment_id" };
  }

  const status = await getGoPayPaymentStatus(order.gopay_payment_id);
  const mapped = mapGoPayStateToOrder(status.state);

  await supabaseAdmin.from("payment_logs").insert({
    order_id: order.id,
    provider: "gopay",
    endpoint: `/payments/payment/${order.gopay_payment_id}`,
    request_payload: null,
    response_payload: status.raw as any,
    status: "ok",
  });

  await supabaseAdmin
    .from("payments")
    .update({
      status:
        mapped === "paid"
          ? "paid"
          : mapped === "cancelled"
            ? "cancelled"
            : mapped === "failed"
              ? "failed"
              : mapped === "refunded"
                ? "refunded"
                : "pending",
      raw_response: status.raw as any,
    })
    .eq("order_id", order.id)
    .eq("provider_payment_id", String(order.gopay_payment_id));

  // Idempotency: if already paid in DB, just return.
  if (order.status === "paid" && mapped === "paid") {
    return { changed: false, status: "paid" };
  }

  if (mapped === "paid") {
    // 1) order paid
    await supabaseAdmin
      .from("orders")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", order.id);

    // 2) seats sold
    await supabaseAdmin
      .from("seat_inventory")
      .update({ status: "sold", reserved_until: null })
      .eq("order_id", order.id);

    // 3) issue tickets if none exist yet
    const { data: existingTickets } = await supabaseAdmin
      .from("tickets")
      .select("id")
      .eq("order_id", order.id)
      .limit(1);
    if (!existingTickets || existingTickets.length === 0) {
      const { data: items } = await supabaseAdmin
        .from("order_items")
        .select("*")
        .eq("order_id", order.id);
      const tickets = (items || []).flatMap((it) =>
        Array.from({ length: it.quantity || 1 }).map((_, i) => {
          // Signed, verifiable token — identical scheme to the webhook path.
          const { id, token } = newSignedTicket();
          return {
            id,
            order_id: order.id,
            event_id: order.event_id,
            event_date_id: order.event_date_id,
            seat_id: it.seat_id,
            seat_label: it.label + ((it.quantity || 1) > 1 ? ` #${i + 1}` : ""),
            qr_code: token,
            qr_token: token,
          };
        }),
      );
      if (tickets.length > 0) {
        await supabaseAdmin.from("tickets").insert(tickets);
      }
    }

    // 4) SuperFaktúra — vystaviť faktúru, ak ešte nie je
    if (!order.superfaktura_invoice_id) {
      try {
        const { data: items } = await supabaseAdmin
          .from("order_items")
          .select("*")
          .eq("order_id", order.id);
        const orderShort = order.id.slice(0, 8).toUpperCase();
        const result = await createPaidInvoice({
          orderId: order.id,
          variableSymbol: orderShort,
          customer: {
            name: order.customer_name || "Zákazník",
            email: order.customer_email || "",
            phone: order.customer_phone || undefined,
          },
          items: (items || []).map((it) => ({
            name: it.label,
            unit_price: Number(it.unit_price),
            quantity: it.quantity || 1,
            tax: 20,
          })),
          paymentType: "card",
        });
        await supabaseAdmin
          .from("orders")
          .update({
            superfaktura_invoice_id: result.invoice_id,
            superfaktura_invoice_number: result.invoice_number,
            superfaktura_invoice_pdf_url: result.pdf_url,
          })
          .eq("id", order.id);
        await supabaseAdmin.from("superfaktura_logs").insert({
          order_id: order.id,
          invoice_id: result.invoice_id,
          endpoint: "/invoices/create",
          response_payload: result.raw as any,
          status: "ok",
        });
      } catch (e: any) {
        await supabaseAdmin.from("superfaktura_logs").insert({
          order_id: order.id,
          endpoint: "/invoices/create",
          status: "error",
          error_message: String(e?.message || e),
        });
        console.error("SuperFaktúra failed for order", order.id, e);
        // nepadáme — platba je úspešná, faktúru môže admin vystaviť znovu
      }
    }

    // 5) Vstupenky e-mailom. Idempotentné cez `orders.tickets_emailed_at`,
    // takže opakovaná notifikácia z GoPay ich nepošle druhýkrát. Zlyhanie
    // nesmie zhodiť vysporiadanie — peniaze sú prijaté, vstupenky vydané.
    try {
      await sendTicketsEmail(order.id);
    } catch (e) {
      console.error("Odoslanie vstupeniek zlyhalo pre objednávku", order.id, e);
    }

    return { changed: true, status: "paid" };
  }

  if (mapped === "cancelled" || mapped === "failed") {
    await supabaseAdmin.from("orders").update({ status: mapped }).eq("id", order.id);
    await supabaseAdmin
      .from("seat_inventory")
      .update({ status: "available", reserved_until: null, order_id: null })
      .eq("order_id", order.id);
    return { changed: true, status: mapped };
  }

  return { changed: false, status: order.status };
}

export const settleGoPayOrder = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    return settleOrderIfPaid(data.order_id);
  });

// Read shape for /checkout/return and /checkout/success.
// SECURITY: personal data (customer name/email/phone) is only returned when the
// caller presents a valid per-order access token (issued in the GoPay return
// URL). Without it we still return the event/items/tickets so the QR renders,
// but strip PII — so a stranger who only knows the order id can't harvest it.
export const getOrderSummary = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ order_id: z.string().uuid(), access_token: z.string().optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", data.order_id)
      .single();
    if (error || !order) return { order: null, items: [], tickets: [], event: null };
    const [{ data: items }, { data: tickets }, { data: event }, { data: eventDate }] =
      await Promise.all([
        supabaseAdmin.from("order_items").select("*").eq("order_id", order.id),
        // BEZPEČNOSŤ: nie select("*") — vstupenka nesie aj `qr_token` a stopy po
        // skenovaní. Stránka potrebuje len týchto šesť polí.
        supabaseAdmin
          .from("tickets")
          .select("id, order_id, event_id, seat_label, qr_code, issued_at")
          .eq("order_id", order.id),
        // BEZPEČNOSŤ: nie select("*") — ten by kupujúcemu poslal aj `scanner_token`,
        // teda tajomstvo, ktorým sa autorizuje označovanie vstupeniek za použité.
        supabaseAdmin
          .from("events")
          .select("id, title, category, event_date, event_time, venue, city, address, image_url")
          .eq("id", order.event_id)
          .maybeSingle(),
        supabaseAdmin
          .from("event_dates")
          .select("event_date, event_time")
          .eq("id", order.event_date_id)
          .maybeSingle(),
      ]);

    // Zákazník musí vidieť termín, ktorý si kúpil — `events.event_date` je len
    // najbližší termín podujatia a po pridaní reprízy by ukázal iný deň.
    const eventForOrder =
      event && eventDate
        ? { ...event, event_date: eventDate.event_date, event_time: eventDate.event_time }
        : event;

    const authorized = verifyOrderAccess(order.id, data.access_token);
    const safeOrder = authorized
      ? order
      : { ...order, customer_name: null, customer_email: null, customer_phone: null };

    // BEZPEČNOSŤ: QR kód je to, čím sa vchádza na podujatie — je teda cennejší
    // než meno kupujúceho a nesmie visieť len na uhádnutí `order_id`. Bez
    // podpísaného tokenu vraciame zhrnutie bez vstupeniek. Obe legitímne cesty
    // token nesú: návrat z GoPay aj odkaz v potvrdzovacom e-maile.
    return {
      order: safeOrder,
      items: items || [],
      tickets: authorized ? tickets || [] : [],
      event: eventForOrder || null,
    };
  });

// Admin: re-issue invoice manually
export const reissueInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", data.order_id)
      .single();
    if (!order) throw new Error("Objednávka sa nenašla");
    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("*")
      .eq("order_id", order.id);
    const orderShort = order.id.slice(0, 8).toUpperCase();
    const result = await createPaidInvoice({
      orderId: order.id,
      variableSymbol: orderShort,
      customer: {
        name: order.customer_name || "Zákazník",
        email: order.customer_email || "",
        phone: order.customer_phone || undefined,
      },
      items: (items || []).map((it) => ({
        name: it.label,
        unit_price: Number(it.unit_price),
        quantity: it.quantity || 1,
        tax: 20,
      })),
      paymentType: "card",
    });
    await supabaseAdmin
      .from("orders")
      .update({
        superfaktura_invoice_id: result.invoice_id,
        superfaktura_invoice_number: result.invoice_number,
        superfaktura_invoice_pdf_url: result.pdf_url,
      })
      .eq("id", order.id);
    await supabaseAdmin.from("superfaktura_logs").insert({
      order_id: order.id,
      invoice_id: result.invoice_id,
      endpoint: "/invoices/create",
      response_payload: result.raw as any,
      status: "ok",
    });
    return { invoice_number: result.invoice_number, pdf_url: result.pdf_url };
  });

// Admin: poslať vstupenky e-mailom znovu (napr. keď zákazníkovi neprišli).
export const resendTicketsEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const result = await sendTicketsEmail(data.order_id, { force: true });
    if (!result.sent) {
      const reasons: Record<string, string> = {
        not_configured: "Odosielanie e-mailov nie je aktivované (chýba RESEND_API_KEY).",
        order_not_found: "Objednávka sa nenašla.",
        not_paid: "Objednávka nie je zaplatená.",
        no_email: "Objednávka nemá e-mailovú adresu.",
        no_tickets: "K objednávke nie sú vydané žiadne vstupenky.",
      };
      throw new Error(reasons[result.reason ?? ""] || "Odoslanie zlyhalo, pozri email_logs.");
    }
    return { ok: true };
  });
