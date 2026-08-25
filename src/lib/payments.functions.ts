// Server functions pre checkout: platobné brány + SuperFaktúra.
// Keep this file thin: only createServerFn declarations and their imports.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { siteUrl } from "./site-url.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { signOrderAccess, verifyOrderAccess } from "./order-access.server";
import { sendTicketsEmail } from "./ticket-mail.server";
import { checkCoupon, couponErrorMessage, releaseCoupon, recordRedemption } from "./coupons.server";
import { loadSeatPricing } from "./seat-pricing.server";
import { getRequest } from "@tanstack/react-start/server";
import { errorMessage } from "./error-message";
import { pocetVstupeniek } from "./plural";
import { branaPodlaId, branyPreZakaznika } from "./payment-gateways/index.server";
import { adresaNasehoPdf, dopytajCakajuce, settleOrder } from "./order-settlement.server";
import { fakturacnySystem } from "./invoicing/index.server";
import { firemneUdaje } from "./invoicing/types";
import { sadzbaPodujatia } from "./dph.server";

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

/**
 * Firemné údaje na faktúru. Všetko nepovinné — kto nekupuje na firmu, nič
 * z toho nevypĺňa a faktúra ide na fyzickú osobu ako doteraz.
 */
const CompanySchema = z.object({
  name: z.string().max(200),
  ico: z.string().max(20).optional().nullable(),
  dic: z.string().max(20).optional().nullable(),
  ic_dph: z.string().max(20).optional().nullable(),
  street: z.string().max(200).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  country: z.string().max(2).optional().nullable(),
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
    .in("orders.status", ["pending", "awaiting_payment", "paid"])
    // Sedadlové položky sem nepatria — tie si kapacitu strážia samy cez
    // `seat_inventory`. Bez tohto by pri zmiešanej objednávke ukrojili
    // z kapacity na státie.
    .is("seat_id", null);
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
        company: CompanySchema.optional().nullable(),
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
      throw new Error(`Naraz sa dá kúpiť najviac ${pocetVstupeniek(MAX_TICKETS_PER_ORDER)}.`);
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
      .select(
        "id, status, base_price, vip_price, total_tickets, venue_layout_id, max_tickets_per_person",
      )
      .eq("id", data.event_id)
      .maybeSingle();
    if (!event) throw new Error("Podujatie sa nenašlo");
    if (event.status !== "published") throw new Error("Podujatie nie je v predaji");

    // Strop na osobu za celé podujatie. Globálny limit na objednávku sám
    // nebráni tomu, aby si niekto kúpil dvadsať, zaplatil a hneď ďalších
    // dvadsať — pri vypredanom koncerte je to cesta k prekupníkom.
    if (event.max_tickets_per_person) {
      // Zámerne dva dotazy namiesto vnoreného filtra — ten sa v PostgREST
      // správa inak, než sa na prvý pohľad zdá, a limit, ktorý ticho nefunguje,
      // je horší než žiadny.
      const { data: mojeObjednavky } = await supabaseAdmin
        .from("orders")
        .select("id")
        .eq("event_id", data.event_id)
        .ilike("customer_email", email)
        .in("status", ["pending", "awaiting_payment", "paid"]);
      const ids = (mojeObjednavky || []).map((o) => o.id);
      let doteraz = 0;
      if (ids.length > 0) {
        const { data: uzKupene } = await supabaseAdmin
          .from("order_items")
          .select("quantity")
          .in("order_id", ids);
        doteraz = (uzKupene || []).reduce((s, r) => s + (r.quantity || 0), 0);
      }
      if (doteraz + totalQuantity > event.max_tickets_per_person) {
        const zostava = Math.max(0, event.max_tickets_per_person - doteraz);
        throw new Error(
          zostava > 0
            ? `Na toto podujatie si môže jeden človek kúpiť najviac ${pocetVstupeniek(event.max_tickets_per_person)}. Zostáva ti ${zostava}.`
            : `Na toto podujatie si už kúpil maximum ${pocetVstupeniek(event.max_tickets_per_person)}.`,
        );
      }
    }

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

    // --- Rýchla kontrola kapacity pre položky bez sedadla ---
    // Sedadlové položky si kapacitu strážia samy (jedno sedadlo = jeden riadok).
    // POZOR: toto je len zdvorilá kontrola vopred, aby zákazník dostal zrozumiteľnú
    // hlášku skôr, než mu vznikne objednávka. Záväzné slovo má `assert_order_capacity`
    // nižšie — tá kontrola je atómická a rozhodne aj dvoch súbežných kupujúcich.
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
        customer_company: data.company?.name?.trim() || null,
        customer_ico: data.company?.ico?.trim() || null,
        customer_dic: data.company?.dic?.trim() || null,
        customer_ic_dph: data.company?.ic_dph?.trim() || null,
        customer_street: data.company?.street?.trim() || null,
        customer_city: data.company?.city?.trim() || null,
        customer_zip: data.company?.zip?.trim() || null,
        customer_country: data.company?.country?.trim()?.toUpperCase() || null,
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

    // --- Záväzná kontrola kapacity ---
    // Až tu, keď sú položky zapísané, vie databáza pod zámkom termínu povedať,
    // či sa objednávka ešte zmestí. Pri dvoch súbežných kupujúcich prejde tá
    // staršia a druhá sa dozvie, koľko naozaj zostalo.
    const { error: capErr } = await supabaseAdmin.rpc("assert_order_capacity", {
      p_order_id: order.id,
    });
    if (capErr) {
      await supabaseAdmin.from("order_items").delete().eq("order_id", order.id);
      await supabaseAdmin.from("orders").delete().eq("id", order.id);
      if (couponId) await releaseCoupon(couponId);
      const zostava = capErr.message?.match(/CAPACITY_EXCEEDED:(\d+)/)?.[1];
      throw new Error(
        zostava && Number(zostava) > 0
          ? `K dispozícii je už len ${zostava} ks. Uprav prosím počet.`
          : "Vstupenky sú vypredané.",
      );
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

// 2) Založenie platby pre existujúcu objednávku — cez ktorúkoľvek bránu.
export const startPaymentForOrder = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        order_id: z.string().uuid(),
        provider: z.enum(["gopay", "gpwebpay", "tatrapayplus"]).optional(),
      })
      .parse(input),
  )
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

    const { brany, predvolena } = await branyPreZakaznika();
    // Zákazník si môže vybrať len z brán, ktoré sú naozaj v ponuke — inak by
    // sa dalo podstrčiť id vypnutej brány.
    const brana = data.provider ? brany.find((b) => b.id === data.provider) || null : predvolena;
    if (!brana) {
      throw new Error(
        data.provider
          ? `Brána ${data.provider} nie je v ponuke — buď nemá prístupy, alebo je v admine vypnutá.`
          : "Nie je zapnutá ani jedna platobná brána. Pozri Systém → Platobné brány.",
      );
    }
    // Rozrobenú platbu tej istej brány netreba zakladať znovu. Pri zmene brány
    // áno — každá si drží vlastný identifikátor.
    if (
      order.payment_url &&
      order.status === "awaiting_payment" &&
      order.payment_provider === brana.id
    ) {
      return {
        payment_url: order.payment_url,
        payment_id: order.payment_ref,
        provider: brana.id,
      };
    }

    // Prepnutie brány nesmie nechať dva živé odkazy na zaplatenie tej istej
    // objednávky — zákazník by mohol zaplatiť oba.
    if (order.payment_provider && order.payment_ref && order.payment_provider !== brana.id) {
      await zrusPredoslyZamer(order.id, order.payment_provider, order.payment_ref);
    }

    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("*")
      .eq("order_id", order.id);

    const origin = siteUrl();
    // GP webpay chce číselné ORDERNUMBER, ktoré sa nesmie opakovať, tatrapay+
    // číselný variabilný symbol. UUID objednávky ani jedno nespĺňa, preto
    // sekvencia v databáze.
    const { data: cislo, error: cisloErr } = await supabaseAdmin.rpc("next_payment_ref");
    if (cisloErr || !cislo) throw new Error("Nepodarilo sa prideliť číslo platby");
    const reference = String(cislo);

    let result;
    try {
      result = await brana.start({
        orderId: order.id,
        reference,
        amount: Number(order.total_amount),
        currency: order.currency || "EUR",
        description: `Vstupenky ${reference}`,
        customer: {
          firstName: (order.customer_name || "").split(" ")[0] || "",
          lastName: (order.customer_name || "").split(" ").slice(1).join(" ") || "",
          email: order.customer_email || "",
          phone: order.customer_phone || "",
        },
        items: (items || []).map((it) => ({
          name: it.label,
          unitPrice: Number(it.unit_price),
          quantity: it.quantity || 1,
        })),
        returnUrl: navratovaAdresa(brana.id, origin, order.id),
        notifyUrl: `${origin}/api/public/payments/${brana.id}/webhook?orderId=${order.id}`,
        clientIp: clientIp(),
        lang: "sk",
      });
    } catch (e) {
      await supabaseAdmin.from("payment_logs").insert({
        order_id: order.id,
        provider: brana.id,
        endpoint: "start",
        request_payload: { order_id: order.id, reference },
        status: "error",
        error_message: errorMessage(e),
      });
      throw e;
    }

    await supabaseAdmin.from("payment_logs").insert({
      order_id: order.id,
      provider: brana.id,
      endpoint: "start",
      request_payload: { order_id: order.id, reference, total: order.total_amount },
      response_payload: result.raw,
      status: "ok",
    });

    await supabaseAdmin
      .from("orders")
      .update({
        payment_provider: brana.id,
        payment_ref: result.providerRef,
        payment_url: result.redirectUrl,
        payment_vs: Number(reference),
        // GoPay vetva zapisuje aj staré stĺpce, nech admin prehľad a refundy
        // fungujú na rozrobených objednávkach rovnako ako doteraz.
        ...(brana.id === "gopay"
          ? { gopay_payment_id: result.providerRef, gopay_payment_url: result.redirectUrl }
          : {}),
        status: "awaiting_payment",
      })
      .eq("id", order.id);

    await supabaseAdmin.from("payments").insert({
      order_id: order.id,
      provider: brana.id,
      provider_payment_id: result.providerRef,
      amount: order.total_amount,
      currency: order.currency || "EUR",
      status: "pending",
      raw_response: result.raw,
    });

    return {
      payment_url: result.redirectUrl,
      payment_id: result.providerRef,
      provider: brana.id,
    };
  });

/**
 * Zruší rozrobený zámer u predošlej brány. Keď to brána nevie (GP webpay),
 * odkaz zostane u nej použiteľný — preto sa to zapíše, nech je pri prípadnej
 * dvojitej platbe jasné, odkiaľ sa vzala.
 */
async function zrusPredoslyZamer(
  orderId: string,
  provider: "gopay" | "gpwebpay" | "tatrapayplus",
  ref: string,
): Promise<void> {
  let zruseny = false;
  try {
    const brana = branaPodlaId(provider);
    zruseny = brana.zrus ? await brana.zrus(ref) : false;
  } catch (e) {
    console.error("Zrušenie predošlého zámeru zlyhalo", orderId, provider, ref, errorMessage(e));
  }

  await supabaseAdmin
    .from("payments")
    .update({ status: "cancelled" })
    .eq("order_id", orderId)
    .eq("provider", provider)
    .eq("provider_payment_id", ref)
    .eq("status", "pending");

  await supabaseAdmin.from("payment_logs").insert({
    order_id: orderId,
    provider,
    endpoint: `zrusenie_zameru:${ref}`,
    status: zruseny ? "ok" : "error",
    error_message: zruseny
      ? null
      : "Brána zrušenie nepodporuje — starý odkaz na zaplatenie môže zostať funkčný.",
  });
}

/**
 * Kam sa má zákazník vrátiť. GP webpay adresy s parametrami blokuje, preto
 * dostane holú cestu a objednávku si nesie v poli MD.
 */
function navratovaAdresa(brana: string, origin: string, orderId: string): string {
  if (brana === "gpwebpay") return `${origin}/api/public/payments/gpwebpay/return`;
  if (brana === "tatrapayplus") {
    return `${origin}/api/public/payments/tatrapayplus/return?orderId=${orderId}`;
  }
  return `${origin}/checkout/return?orderId=${orderId}&t=${signOrderAccess(orderId)}`;
}

/** Brány, ktoré sa dajú zákazníkovi ponúknuť. Bez tajomstiev — ide na klienta. */
export const listPaymentGateways = createServerFn({ method: "POST" }).handler(async () => {
  const { brany, predvolena } = await branyPreZakaznika();
  return {
    gateways: brany.map((b) => ({ id: b.id, label: b.label, hint: b.hint })),
    default: predvolena?.id ?? null,
  };
});

// Vnútorný pomocník — doúčtovanie žije v order-settlement.server.ts, aby ho
// vedeli použiť aj návratové routy jednotlivých brán.
async function settleOrderIfPaid(orderId: string) {
  return settleOrder(orderId);
}

export const settleGoPayOrder = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    return settleOrderIfPaid(data.order_id);
  });

/**
 * Dopýta sa brány na objednávky, ktoré zostali visieť v `awaiting_payment`.
 *
 * Ani GP webpay, ani tatrapay+ nemajú webhook — výsledok chodí len návratom
 * zákazníka. Kto po zaplatení zavrie prehliadač, ostal by bez vstupeniek.
 * Toto je záchranná sieť; patrí do cronu.
 */
export const reconcilePendingPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ max_age_hours: z.number().min(1).max(168).default(48) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    // Sken púšťa dopyty do banky pre desiatky objednávok — nesmie to vedieť
    // spustiť ktokoľvek. Z cronu sa volá cez /api/public/payments/reconcile
    // s tajomstvom v hlavičke.
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Forbidden: vyžaduje sa rola admin");
    return dopytajCakajuce(data.max_age_hours);
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
    // Rovnaká cesta ako pri doúčtovaní: systém podľa nastavenia a sadzba
    // podľa podujatia, nie natvrdo SuperFaktúra a 20 %.
    const system = await fakturacnySystem();
    if (!system) {
      throw new Error(
        "Nie je nastavený fakturačný systém. Doplň prístupy v Systém → Platobné brány, sekcia Fakturácia.",
      );
    }
    const dph = await sadzbaPodujatia(order.event_id);
    const result = await system.vystav({
      orderId: order.id,
      variableSymbol: order.payment_vs
        ? String(order.payment_vs)
        : order.id.slice(0, 8).toUpperCase(),
      customer: {
        name: order.customer_name || "Zákazník",
        email: order.customer_email || "",
        phone: order.customer_phone || undefined,

        company: firemneUdaje(order),
      },
      items: (items || []).map((it) => ({
        name: it.label,
        unit_price: Number(it.unit_price),
        quantity: it.quantity || 1,
        tax: dph,
      })),
      paymentType: "card",
    });
    await supabaseAdmin
      .from("orders")
      .update({
        invoice_provider: system.id,
        superfaktura_invoice_id: result.invoice_id,
        superfaktura_invoice_number: result.invoice_number,
        superfaktura_invoice_pdf_url: result.pdf_url || adresaNasehoPdf(order.id),
      })
      .eq("id", order.id);
    await supabaseAdmin.from("superfaktura_logs").insert({
      order_id: order.id,
      invoice_id: result.invoice_id,
      endpoint: "/invoices/create",
      response_payload: result.raw,
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
