import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// Tabuľka sa nahradí obsahom, ktorý si test nastaví. `select` vracia rovno
// prísľub — tak sa naň v module aj čaká.
const riadky = vi.hoisted(() => ({ data: [] as Array<Record<string, unknown>> }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({ select: () => Promise.resolve({ data: riadky.data, error: null }) }),
  },
}));

import { zabudniKluc, zasifruj } from "./secrets.server";
import { hodnota, polozka, pripravPristupy, zabudniPristupy, zdroj } from "./pristupy.server";

const PREMENNE = ["GOPAY_CLIENT_ID", "GOPAY_CLIENT_SECRET", "GOPAY_API_URL"];
const povodne: Record<string, string | undefined> = {};

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = "testovacie-tajomstvo-pre-sifrovanie";
  zabudniKluc();
  zabudniPristupy();
  riadky.data = [];
  for (const p of PREMENNE) {
    if (!(p in povodne)) povodne[p] = process.env[p];
    delete process.env[p];
  }
});

afterAll(() => {
  for (const [k, v] of Object.entries(povodne)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete process.env.SECRETS_ENCRYPTION_KEY;
  zabudniKluc();
  zabudniPristupy();
});

describe("poradie zdrojov", () => {
  it("bez čohokoľvek nevráti hodnotu", async () => {
    await pripravPristupy();
    expect(hodnota("gopay", "GOPAY_CLIENT_ID")).toBeUndefined();
    expect(zdroj("gopay", "GOPAY_CLIENT_ID")).toBeNull();
  });

  it("keď je len v prostredí, použije sa prostredie", async () => {
    process.env.GOPAY_CLIENT_ID = "zo-servera";
    await pripravPristupy();
    expect(hodnota("gopay", "GOPAY_CLIENT_ID")).toBe("zo-servera");
    expect(zdroj("gopay", "GOPAY_CLIENT_ID")).toBe("server");
  });

  it("hodnota z administrácie prebije prostredie", async () => {
    process.env.GOPAY_CLIENT_ID = "zo-servera";
    riadky.data = [
      { provider: "gopay", kluc: "GOPAY_CLIENT_ID", hodnota_sifrovana: zasifruj("z-admina") },
    ];
    await pripravPristupy();
    expect(hodnota("gopay", "GOPAY_CLIENT_ID")).toBe("z-admina");
    expect(zdroj("gopay", "GOPAY_CLIENT_ID")).toBe("admin");
  });

  it("hodnoty sa nemiešajú medzi bránami", async () => {
    riadky.data = [
      { provider: "gopay", kluc: "GOPAY_CLIENT_ID", hodnota_sifrovana: zasifruj("gopay-id") },
    ];
    await pripravPristupy();
    expect(hodnota("gopay", "GOPAY_CLIENT_ID")).toBe("gopay-id");
    expect(hodnota("tatrapayplus", "GOPAY_CLIENT_ID")).toBeUndefined();
  });

  it("prázdna hodnota v tabuľke prepadne na prostredie", async () => {
    process.env.GOPAY_CLIENT_ID = "zo-servera";
    riadky.data = [
      { provider: "gopay", kluc: "GOPAY_CLIENT_ID", hodnota_sifrovana: zasifruj("   ") },
    ];
    await pripravPristupy();
    expect(hodnota("gopay", "GOPAY_CLIENT_ID")).toBe("zo-servera");
  });

  it("nedešifrovateľný zápis sa tvári ako chýbajúci, nie ako prázdny", async () => {
    // Napríklad po zmene šifrovacieho kľúča. Brána sa vtedy nesmie pokúsiť
    // platiť s nezmyslom.
    riadky.data = [
      { provider: "gopay", kluc: "GOPAY_CLIENT_ID", hodnota_sifrovana: "v1:zle:zle:zle" },
    ];
    await pripravPristupy();
    expect(hodnota("gopay", "GOPAY_CLIENT_ID")).toBeUndefined();
  });
});

describe("polozka pre administráciu", () => {
  it("tajnú hodnotu nevráti, len náhľad", async () => {
    riadky.data = [
      {
        provider: "gopay",
        kluc: "GOPAY_CLIENT_SECRET",
        hodnota_sifrovana: zasifruj("velmi-tajne-heslo-9876"),
      },
    ];
    await pripravPristupy();
    const p = polozka("gopay", {
      premenna: "GOPAY_CLIENT_SECRET",
      nazov: "Client Secret",
      popis: "x",
      povinna: true,
      tajna: true,
    });
    expect(p.hodnota).toBeUndefined();
    expect(p.nahlad).toBe("••••9876");
    expect(JSON.stringify(p)).not.toContain("velmi-tajne-heslo");
    expect(p.vyplnena).toBe(true);
    expect(p.zdroj).toBe("admin");
  });

  it("netajnú hodnotu vráti celú", async () => {
    riadky.data = [
      { provider: "gopay", kluc: "GOPAY_CLIENT_ID", hodnota_sifrovana: zasifruj("8765432") },
    ];
    await pripravPristupy();
    const p = polozka("gopay", {
      premenna: "GOPAY_CLIENT_ID",
      nazov: "Client ID",
      popis: "x",
      povinna: true,
    });
    expect(p.hodnota).toBe("8765432");
    expect(p.nahlad).toBeUndefined();
  });

  it("prijme aj náhradný zdroj, napríklad kľúč v súbore", async () => {
    await pripravPristupy();
    const p = polozka("gpwebpay", {
      premenna: "GPWEBPAY_PRIVATE_KEY",
      nazov: "Súkromný kľúč",
      popis: "x",
      povinna: true,
      tajna: true,
      inyZdroj: () => true,
    });
    expect(p.vyplnena).toBe(true);
    expect(p.zdroj).toBe("server");
  });
});
