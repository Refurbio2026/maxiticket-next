// Ocenenie sedadiel podľa cenových zón sály.
//
// Web (`submitOrder`) aj pokladňa (`createPosSale`) musia počítať rovnako —
// preto je logika tu a nie dvakrát skopírovaná. Predtým obe vetvy poznali len
// dve ceny (VIP a základnú) a sedadlo označené v editore ako Premium či ZŤP sa
// predalo za základnú cenu.
//
// Poradie rozhodovania pre jedno sedadlo:
//   1. cena zóny nastavená pre toto podujatie (`event_price_categories`),
//   2. VIP cena podujatia, ak je sedadlo vo VIP zóne,
//   3. základná cena podujatia.
//
// Vďaka bodom 2 a 3 sa podujatie bez nastavených zón správa presne ako predtým.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Tvar z rozloženia sály — potrebujeme z neho len id, druh a cenovú zónu. */
type LayoutShape = { id: string; kind?: string; priceCategory?: string };

export type SeatPricing = {
  /** Cena sedadla podľa jeho zóny. */
  priceFor: (seatId: string) => number;
  /** VIP je príznak pre vstupenku a popis, nie spôsob výpočtu ceny. */
  isVip: (seatId: string) => boolean;
  /** Názov zóny, do ktorej sedadlo patrí (pre popis položky). */
  zoneOf: (seatId: string) => string | undefined;
};

/**
 * Pripraví ocenenie pre jedno podujatie. `seat_id` má tvar
 * `<id tvaru>::r<riadok>c<stĺpec>`, takže zónu určuje tvar, na ktorom sedadlo leží.
 */
export async function loadSeatPricing(opts: {
  eventId: string;
  venueLayoutId: string | null;
  basePrice: number;
  vipPrice: number;
}): Promise<SeatPricing> {
  const { eventId, venueLayoutId, basePrice, vipPrice } = opts;

  // Zóna tvaru → názov kategórie; VIP tvary poznáme aj podľa `kind`.
  const zoneByShape = new Map<string, string>();
  const vipShapes = new Set<string>();
  if (venueLayoutId) {
    const { data: layout } = await supabaseAdmin
      .from("venue_layouts")
      .select("shapes")
      .eq("id", venueLayoutId)
      .maybeSingle();
    for (const shape of (layout?.shapes as LayoutShape[] | null) ?? []) {
      if (shape.priceCategory) zoneByShape.set(shape.id, shape.priceCategory);
      if (shape.kind === "vip" || shape.priceCategory === "VIP") vipShapes.add(shape.id);
    }
  }

  // Ceny zón nastavené pre toto podujatie, kľúčované názvom kategórie —
  // v rozložení sály je uložený názov, nie id.
  const priceByZone = new Map<string, number>();
  const { data: rows } = await supabaseAdmin
    .from("event_price_categories")
    .select("price, price_categories ( name )")
    .eq("event_id", eventId);
  for (const r of rows || []) {
    const name = (r as { price_categories?: { name?: string } }).price_categories?.name;
    if (name) priceByZone.set(name.toLowerCase(), Number(r.price));
  }

  const shapeOf = (seatId: string) => seatId.split("::")[0];

  return {
    zoneOf: (seatId) => zoneByShape.get(shapeOf(seatId)),
    isVip: (seatId) => vipShapes.has(shapeOf(seatId)),
    priceFor: (seatId) => {
      const shape = shapeOf(seatId);
      const zone = zoneByShape.get(shape);
      if (zone) {
        const zonePrice = priceByZone.get(zone.toLowerCase());
        if (zonePrice !== undefined) return zonePrice;
      }
      return vipShapes.has(shape) ? vipPrice : basePrice;
    },
  };
}
