import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { desifruj, nahlad, zabudniKluc, zasifruj } from "./secrets.server";

const POVODNY = process.env.SECRETS_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = "testovacie-tajomstvo-pre-sifrovanie";
  zabudniKluc();
});

afterAll(() => {
  if (POVODNY === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = POVODNY;
  zabudniKluc();
});

describe("zasifruj / desifruj", () => {
  it("vráti pôvodný text", () => {
    const tajne = "sk_live_abcdef123456";
    expect(desifruj(zasifruj(tajne))).toBe(tajne);
  });

  it("zvládne viacriadkový PEM aj diakritiku", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nAAAA\nBBBB\n-----END PRIVATE KEY-----\n";
    expect(desifruj(zasifruj(pem))).toBe(pem);
    expect(desifruj(zasifruj("heslo so žĺtym ľadom"))).toBe("heslo so žĺtym ľadom");
  });

  it("dvakrát zašifrovaná tá istá hodnota nedá rovnaký zápis", () => {
    // Inak by sa z tabuľky dalo vyčítať, že dve brány majú rovnaké heslo.
    expect(zasifruj("rovnake")).not.toBe(zasifruj("rovnake"));
  });

  it("v zašifrovanom zápise nie je pôvodný text", () => {
    expect(zasifruj("sk_live_abcdef123456")).not.toContain("sk_live");
  });

  it("iný kľúč hodnotu nedešifruje", () => {
    const zaznam = zasifruj("tajne");
    process.env.SECRETS_ENCRYPTION_KEY = "uplne-ine-tajomstvo";
    zabudniKluc();
    expect(desifruj(zaznam)).toBeNull();
  });

  it("prepísaný zápis neprejde overením", () => {
    // GCM okrem utajenia stráži aj neporušenosť — podvrhnutá hodnota sa
    // nesmie potichu dešifrovať na niečo iné.
    const zaznam = zasifruj("povodne");
    const [v, iv, tag, sifra] = zaznam.split(":");
    const zmenena = Buffer.from(sifra, "base64");
    zmenena[0] ^= 0xff;
    expect(desifruj([v, iv, tag, zmenena.toString("base64")].join(":"))).toBeNull();
  });

  it("nezmysel na vstupe vráti null, nie výnimku", () => {
    expect(desifruj("")).toBeNull();
    expect(desifruj("toto nie je zaznam")).toBeNull();
    expect(desifruj("v9:aaa:bbb:ccc")).toBeNull();
  });

  it("bez serverového tajomstva sa nešifruje", () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    const qr = process.env.TICKET_QR_SECRET;
    const sr = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.TICKET_QR_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    zabudniKluc();
    try {
      expect(() => zasifruj("x")).toThrow(/SECRETS_ENCRYPTION_KEY/);
    } finally {
      if (qr !== undefined) process.env.TICKET_QR_SECRET = qr;
      if (sr !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = sr;
    }
  });
});

describe("nahlad", () => {
  it("z bežnej hodnoty ukáže len posledné štyri znaky", () => {
    expect(nahlad("sk_live_abcdef123456")).toBe("••••3456");
  });

  it("krátku hodnotu neukáže vôbec", () => {
    expect(nahlad("kratke")).toBe("••••");
  });

  it("pri PEM kľúči popíše typ a dĺžku, nie obsah", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nTAJNYOBSAH\n-----END PRIVATE KEY-----";
    const n = nahlad(pem);
    expect(n).toContain("BEGIN PRIVATE KEY");
    expect(n).not.toContain("TAJNYOBSAH");
  });
});
