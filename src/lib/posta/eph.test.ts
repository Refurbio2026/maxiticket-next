import { describe, expect, it } from "vitest";
import {
  precitajChyby,
  jeUspech,
  skontrolujAdresu,
  skontrolujZasielku,
  teloHarku,
  teloZasielky,
  type Adresa,
} from "./eph";

const adresa = (x: Partial<Adresa> = {}): Adresa => ({
  name: "Jonáš Báťka",
  street: "Fučíkova 1986/99",
  city: "Detva",
  zip: "96212",
  country: "sk",
  ...x,
});

describe("kontrola adresy", () => {
  it("úplná adresa prejde", () => {
    expect(skontrolujAdresu(adresa())).toEqual([]);
  });

  it("firma bez mena je v poriadku", () => {
    expect(skontrolujAdresu(adresa({ name: null, organization: "Mrkva, s.r.o." }))).toEqual([]);
  });

  it("bez mena aj firmy nie", () => {
    const ch = skontrolujAdresu(adresa({ name: "", organization: "" }));
    expect(ch.map((c) => c.pole)).toContain("name");
  });

  it("slovenská adresa bez PSČ neprejde", () => {
    expect(skontrolujAdresu(adresa({ zip: "" })).map((c) => c.pole)).toContain("zip");
  });

  it("zahraničná adresa bez PSČ prejde", () => {
    expect(skontrolujAdresu(adresa({ zip: "", country: "at" }))).toEqual([]);
  });

  it("pri doručení na poštu treba telefón alebo e-mail", () => {
    // Pošta inak nemá komu oznámiť, že zásielka čaká.
    const ch = skontrolujAdresu(adresa(), { naPostu: true });
    expect(ch.map((c) => c.pole)).toContain("phone");
    expect(skontrolujAdresu(adresa({ email: "j@b.sk" }), { naPostu: true })).toEqual([]);
    expect(skontrolujAdresu(adresa({ phone: "+421900000000" }), { naPostu: true })).toEqual([]);
  });

  it("stráži dĺžky, ktoré pošta odmietne", () => {
    const ch = skontrolujAdresu(adresa({ street: "x".repeat(101) }));
    expect(ch.map((c) => c.pole)).toContain("street");
  });
});

describe("kontrola zásielky", () => {
  it("bežná zásielka prejde", () => {
    expect(skontrolujZasielku({ recipient: adresa(), weight: 0.25 }, "r", "fa")).toEqual([]);
  });

  it("pri online úhrade je hmotnosť povinná", () => {
    const ch = skontrolujZasielku({ recipient: adresa() }, "b", "ol");
    expect(ch.map((c) => c.pole)).toContain("weight");
  });

  it("hmotnosť najviac na tri desatinné miesta", () => {
    const ch = skontrolujZasielku({ recipient: adresa(), weight: 0.1234 }, "b", "fa");
    expect(ch.map((c) => c.pole)).toContain("weight");
  });

  it("vlastné označenie smie byť len číselné", () => {
    const zle = skontrolujZasielku(
      { recipient: adresa(), custom_identifier: "OBJ-123" },
      "r",
      "fa",
    );
    expect(zle.map((c) => c.pole)).toContain("custom_identifier");
    expect(
      skontrolujZasielku({ recipient: adresa(), custom_identifier: "1000033" }, "r", "fa"),
    ).toEqual([]);
  });

  it("odberná lehota: list až 17 dní, balík len 9", () => {
    expect(skontrolujZasielku({ recipient: adresa(), handover_period: 15 }, "r", "fa")).toEqual([]);
    expect(
      skontrolujZasielku({ recipient: adresa(), handover_period: 15 }, "b", "fa").map(
        (c) => c.pole,
      ),
    ).toContain("handover_period");
  });
});

describe("telá požiadaviek", () => {
  it("hárok nesie odosielateľa a číselníky", () => {
    const t = teloHarku(adresa({ organization: "MaxiTicket s.r.o." }), {
      druh: "r",
      uhrada: "fa",
    }) as { sheet: Record<string, unknown> };
    expect(t.sheet.parcel_category).toBe("r");
    expect(t.sheet.payment_type).toBe("fa");
    expect(t.sheet.reception_method).toBe("post");
    expect((t.sheet.sender as Adresa).organization).toBe("MaxiTicket s.r.o.");
  });

  it("prázdne polia sa neposielajú", () => {
    const t = teloZasielky({ recipient: adresa({ phone: "  " }) }) as {
      parcel: { recipient: Record<string, unknown> };
    };
    expect("phone" in t.parcel.recipient).toBe(true);
    expect(t.parcel.recipient.phone).toBeUndefined();
    expect("weight" in (t.parcel as Record<string, unknown>)).toBe(false);
  });

  it("krajina sa dopĺňa na sk a malými písmenami", () => {
    const t = teloZasielky({ recipient: adresa({ country: "AT" }) }) as {
      parcel: { recipient: Adresa };
    };
    expect(t.parcel.recipient.country).toBe("at");
  });

  it("poznámka sa oreže na dvesto znakov", () => {
    const t = teloZasielky({ recipient: adresa(), note: "x".repeat(300) }) as {
      parcel: { note: string };
    };
    expect(t.parcel.note).toHaveLength(200);
  });
});

describe("odpoveď pošty", () => {
  it("úspech", () => {
    expect(jeUspech({ status: "ok" })).toBe(true);
    expect(precitajChyby({ status: "ok" })).toEqual([]);
  });

  it("chyby z validácie vypíše aj s poľom", () => {
    const ch = precitajChyby({
      status: "validation_failed",
      validation_errors: [{ attribute: "recipient.zip", code: "invalid" }],
    });
    expect(ch[0]).toContain("recipient.zip");
    expect(ch[0]).toContain("invalid");
  });

  it("neznámy stav nezamlčí", () => {
    expect(precitajChyby({ status: "server_error" })[0]).toContain("server_error");
  });
});
