// Košík kupujúceho — čo má práve podržané.
//
// Zdrojom pravdy je `seat_inventory`, nie prehliadač: sedadlá drží databáza
// pod id relácie z `getCartSessionId()`. Prehliadač teda nemusí nič pamätať
// a košík prežije obnovenie stránky aj prechod na inú.
//
// Id relácie je `crypto.randomUUID()`, čiže neuhádnuteľné — preto stačí ako
// kľúč a nepotrebuje prihlásenie. Kupujúci sa pri nákupe neprihlasuje.
//
// Státie v tom nie je: pri podujatí bez sedadiel sa nič nerezervuje, kým
// nevznikne objednávka, takže o takom výbere databáza nevie. Drží ho
// prehliadač (`sessionStorage`) a košík v hlavičke ho pripočíta.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CartSeat = {
  seat_id: string;
  label: string | null;
  price: number;
  /** Potrebné na obnovenie výberu na stránke podujatia. */
  is_vip: boolean;
};

export type CartGroup = {
  event_id: string;
  event_date_id: string;
  title: string;
  image_url: string | null;
  event_date: string;
  event_time: string;
  venue: string;
  city: string;
  seats: CartSeat[];
  total: number;
  /** Dokedy je držanie platné. Podľa toho sa v košíku odpočítava čas. */
  reserved_until: string | null;
};

export type Cart = {
  groups: CartGroup[];
  /** Počet sedadiel dohromady — to, čo sa ukazuje pri ikonke. */
  count: number;
  total: number;
};

const PRAZDNY: Cart = { groups: [], count: 0, total: 0 };

/** Čo má táto relácia podržané. Prošlé držania sa nepočítajú. */
export const getCart = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ session: z.string().min(6).max(80) }).parse(input))
  .handler(async ({ data }): Promise<Cart> => {
    const { data: rows } = await supabaseAdmin
      .from("seat_inventory")
      .select("event_id, event_date_id, seat_id, label, price, is_vip, reserved_until")
      .eq("hold_session", data.session)
      .is("order_id", null)
      .gt("reserved_until", new Date().toISOString())
      .order("label", { ascending: true });

    if (!rows || rows.length === 0) return PRAZDNY;

    const dateIds = [...new Set(rows.map((r) => r.event_date_id))];
    const eventIds = [...new Set(rows.map((r) => r.event_id))];

    const [{ data: events }, { data: dates }] = await Promise.all([
      supabaseAdmin
        .from("events")
        .select("id, title, image_url, venue, city, status")
        .in("id", eventIds),
      supabaseAdmin
        .from("event_dates")
        .select("id, event_date, event_time, status")
        .in("id", dateIds),
    ]);

    const eventById = new Map((events || []).map((e) => [e.id, e]));
    const dateById = new Map((dates || []).map((d) => [d.id, d]));

    const groups: CartGroup[] = [];
    for (const dateId of dateIds) {
      const dateRows = rows.filter((r) => r.event_date_id === dateId);
      const prvy = dateRows[0];
      const event = eventById.get(prvy.event_id);
      const date = dateById.get(dateId);
      // Podujatie, ktoré medzitým stiahli z predaja alebo zrušili, do košíka
      // nepatrí — kupujúci by sa z neho nedostal k zaplateniu.
      if (!event || !date || event.status !== "published" || date.status === "cancelled") continue;

      const seats: CartSeat[] = dateRows.map((r) => ({
        seat_id: r.seat_id,
        label: r.label,
        price: Number(r.price || 0),
        is_vip: !!r.is_vip,
      }));
      // Najskorší koniec držania — po ňom sa košík začne rozpadávať.
      const until = dateRows
        .map((r) => r.reserved_until)
        .filter((v): v is string => !!v)
        .sort()[0];

      groups.push({
        event_id: prvy.event_id,
        event_date_id: dateId,
        title: event.title,
        image_url: event.image_url,
        event_date: date.event_date,
        event_time: date.event_time,
        venue: event.venue,
        city: event.city,
        seats,
        total: seats.reduce((s, x) => s + x.price, 0),
        reserved_until: until ?? null,
      });
    }

    return {
      groups,
      count: groups.reduce((s, g) => s + g.seats.length, 0),
      total: groups.reduce((s, g) => s + g.total, 0),
    };
  });
