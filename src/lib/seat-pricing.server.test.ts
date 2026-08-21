// Ocenenie sedadla podľa cenovej zóny sály.
//
// Toto je miesto, kde sa rozhoduje, koľko zákazník zaplatí — web aj pokladňa
// z neho počítajú rovnako. Databázu podstrkávame, testuje sa poradie
// rozhodovania: cena zóny → VIP cena → základná cena.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Shape = { id: string; kind?: string; priceCategory?: string };
type ZoneRow = { price: number; price_categories: { name: string } | null };

const stav = vi.hoisted(() => ({
  shapes: [] as { id: string; kind?: string; priceCategory?: string }[],
  zones: [] as { price: number; price_categories: { name: string } | null }[],
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const vysledok = (tabulka: string) =>
    tabulka === "venue_layouts" ? { data: { shapes: stav.shapes } } : { data: stav.zones };
  return {
    supabaseAdmin: {
      from(tabulka: string) {
        const r = vysledok(tabulka);
        const dotaz = {
          select: () => dotaz,
          eq: () => dotaz,
          maybeSingle: async () => r,
          then: (ok: (v: unknown) => unknown, chyba?: (e: unknown) => unknown) =>
            Promise.resolve(r).then(ok, chyba),
        };
        return dotaz;
      },
    },
  };
});

const { loadSeatPricing } = await import("./seat-pricing.server");

const nastav = (shapes: Shape[], zones: ZoneRow[]) => {
  stav.shapes = shapes;
  stav.zones = zones;
};

const oceni = () =>
  loadSeatPricing({
    eventId: "podujatie-1",
    venueLayoutId: "sala-1",
    basePrice: 12,
    vipPrice: 30,
  });

beforeEach(() => nastav([], []));

describe("poradie rozhodovania o cene", () => {
  it("cena zóny prebije VIP aj základnú cenu", async () => {
    nastav(
      [{ id: "prizemie", priceCategory: "Prízemie" }],
      [{ price: 22, price_categories: { name: "Prízemie" } }],
    );
    expect((await oceni()).priceFor("prizemie::r1c1")).toBe(22);
  });

  it("bez ceny zóny padne VIP tvar na VIP cenu", async () => {
    nastav([{ id: "loza", kind: "vip" }], []);
    expect((await oceni()).priceFor("loza::r1c1")).toBe(30);
  });

  it("bez ceny zóny aj bez VIP padne na základnú cenu", async () => {
    nastav([{ id: "balkon", priceCategory: "Balkón" }], []);
    expect((await oceni()).priceFor("balkon::r1c1")).toBe(12);
  });

  it("cena zóny platí aj pre VIP tvar", async () => {
    nastav(
      [{ id: "loza", kind: "vip", priceCategory: "VIP" }],
      [{ price: 45, price_categories: { name: "VIP" } }],
    );
    const p = await oceni();
    expect(p.priceFor("loza::r1c1")).toBe(45);
    expect(p.isVip("loza::r1c1")).toBe(true); // VIP ostáva príznakom vstupenky
  });

  it("neznáme sedadlo dostane základnú cenu, nespadne", async () => {
    nastav([{ id: "prizemie", priceCategory: "Prízemie" }], []);
    expect((await oceni()).priceFor("neexistuje::r9c9")).toBe(12);
  });
});

describe("párovanie názvu zóny", () => {
  it("nezáleží na veľkosti písmen", async () => {
    // V rozložení sály je uložený názov, nie id — a prenesené sály majú
    // názvy zapísané rôzne.
    nastav(
      [{ id: "s1", priceCategory: "BALKÓN" }],
      [{ price: 18, price_categories: { name: "balkón" } }],
    );
    expect((await oceni()).priceFor("s1::r1c1")).toBe(18);
  });

  it("diakritika sa nezanedbáva", async () => {
    nastav(
      [{ id: "s1", priceCategory: "Balkon" }],
      [{ price: 18, price_categories: { name: "Balkón" } }],
    );
    expect((await oceni()).priceFor("s1::r1c1")).toBe(12); // nezhoda → základná cena
  });

  it("zóna bez naviazaného číselníka sa preskočí", async () => {
    nastav([{ id: "s1", priceCategory: "Prízemie" }], [{ price: 99, price_categories: null }]);
    expect((await oceni()).priceFor("s1::r1c1")).toBe(12);
  });
});

describe("zoneOf a isVip", () => {
  it("vráti názov zóny sedadla", async () => {
    nastav([{ id: "s1", priceCategory: "Prízemie lóža" }], []);
    expect((await oceni()).zoneOf("s1::r3c7")).toBe("Prízemie lóža");
  });

  it("za VIP považuje aj tvar označený len názvom zóny", async () => {
    nastav([{ id: "s1", priceCategory: "VIP" }], []);
    expect((await oceni()).isVip("s1::r1c1")).toBe(true);
  });

  it("bežná zóna nie je VIP", async () => {
    nastav([{ id: "s1", priceCategory: "Prízemie" }], []);
    const p = await oceni();
    expect(p.isVip("s1::r1c1")).toBe(false);
    expect(p.zoneOf("neznamy::r1c1")).toBeUndefined();
  });
});

describe("podujatie bez sály", () => {
  it("ocení všetko základnou cenou", async () => {
    nastav([], []);
    const p = await loadSeatPricing({
      eventId: "podujatie-1",
      venueLayoutId: null,
      basePrice: 15,
      vipPrice: 40,
    });
    expect(p.priceFor("cokolvek::r1c1")).toBe(15);
    expect(p.isVip("cokolvek::r1c1")).toBe(false);
  });
});
