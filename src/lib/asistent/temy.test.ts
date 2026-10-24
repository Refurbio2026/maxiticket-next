import { describe, expect, it } from "vitest";
import { PREVADZKOVATEL } from "@/lib/kontakt";
import { TEMY, bezDiakritiky, najdiTemu, odpovedBezAI, znalostiText } from "./temy";

describe("znalosti asistenta", () => {
  // Najcennejší test v tomto súbore. Predchádzajúca znalostná báza tvrdila
  // zákazníkom, že platia cez GoPay, že faktúru vystavuje SuperFaktúra a že
  // si vstupenku pridajú do Apple Wallet. Nič z toho nebola pravda. Keď sa
  // niečo z toho naozaj spustí, zmaže sa riadok tu — vedome, nie omylom.
  const ZAKAZANE = [
    "gopay",
    "superfaktur",
    "apple wallet",
    "google wallet",
    "apple pay",
    "google pay",
    "tatra pay",
    "tatrapay",
  ];

  const vsetokText = TEMY.flatMap((t) => [t.odpoved.sk, t.odpoved.en, t.otazka.sk, t.otazka.en])
    .join("\n")
    .toLowerCase();

  for (const slovo of ZAKAZANE) {
    it(`nespomína „${slovo}" — to dnes neponúkame`, () => {
      expect(vsetokText).not.toContain(slovo);
    });
  }

  it("provízia pre organizátorov je 10 %, nie 4 %", () => {
    const organizator = TEMY.find((t) => t.id === "organizator");
    expect(organizator?.odpoved.sk).toContain("10 %");
    expect(vsetokText).not.toContain("4 %");
  });

  it("každá téma má slovenské aj anglické znenie a vlastné id", () => {
    const id = new Set<string>();
    for (const t of TEMY) {
      expect(t.otazka.sk.trim().length, t.id).toBeGreaterThan(0);
      expect(t.otazka.en.trim().length, t.id).toBeGreaterThan(0);
      expect(t.odpoved.sk.trim().length, t.id).toBeGreaterThan(20);
      expect(t.odpoved.en.trim().length, t.id).toBeGreaterThan(20);
      expect(id.has(t.id), `duplicitné id ${t.id}`).toBe(false);
      id.add(t.id);
    }
  });

  it("kľúčové slová sú malými písmenami a bez diakritiky", () => {
    // Inak by sa nikdy nenašli — otázka sa normalizuje rovnako.
    for (const t of TEMY) {
      for (const k of t.kluce) {
        expect(k, `${t.id}: ${k}`).toBe(bezDiakritiky(k));
      }
    }
  });

  it("znalosti pre model obsahujú každú tému", () => {
    const text = znalostiText();
    for (const t of TEMY) expect(text).toContain(t.otazka.sk);
  });
});

describe("rozpoznanie otázky", () => {
  const PRIKLADY: Array<[string, string]> = [
    ["Kedy mi príde vstupenka?", "dorucenie"],
    ["zaplatil som a nič mi neprišlo na mail", "dorucenie"],
    ["Dá sa platiť kartou?", "platba"],
    ["potrebujem faktúru na firmu, mám IČO", "faktura"],
    ["môžem vstupenku poslať kamarátovi?", "prenos"],
    ["musím si vstupenku vytlačiť?", "vstup"],
    ["koncert zrušili, čo teraz", "zrusene"],
    ["chcem vrátiť peniaze, nemôžem prísť", "vratenie"],
    ["kde nájdem moje vstupenky po prihlásení", "ucet"],
    ["aké podujatia máte v ponuke?", "ponuka"],
    ["chcem u vás predávať vstupenky na svoje podujatie", "organizator"],
    ["aké máte telefónne číslo", "kontakt"],
    ["je to u vás bezpečné, nie je to podvod?", "bezpecnost"],
  ];

  for (const [otazka, ocakavane] of PRIKLADY) {
    it(`„${otazka}" → ${ocakavane}`, () => {
      expect(najdiTemu(otazka)?.id).toBe(ocakavane);
    });
  }

  it("otázke mimo témy radšej nerozumie, než by hádala", () => {
    expect(najdiTemu("aké bude zajtra počasie v Pezinku")).toBeNull();
    expect(najdiTemu("ahoj")).toBeNull();
  });

  it("diakritika nerozhoduje", () => {
    expect(najdiTemu("potrebujem fakturu")?.id).toBe("faktura");
    expect(najdiTemu("potrebujem faktúru")?.id).toBe("faktura");
  });
});

describe("odpoveď bez AI", () => {
  it("na známu otázku odpovie a pridá odkaz", () => {
    const o = odpovedBezAI("kde nájdem svoje vstupenky", "sk");
    expect(o.temaId).toBe("ucet");
    expect(o.text).toContain("/account");
  });

  it("na neznámu otázku pošle na kontakt namiesto výmyslu", () => {
    const o = odpovedBezAI("koľko stojí parkovanie pred halou", "sk");
    expect(o.temaId).toBeNull();
    expect(o.text).toContain(PREVADZKOVATEL.email);
    expect(o.text).toContain(PREVADZKOVATEL.telefon);
  });

  it("nemčina a maďarčina dostanú anglické znenie, nie prázdno", () => {
    for (const jazyk of ["de", "hu"] as const) {
      const o = odpovedBezAI("how can I pay", jazyk);
      expect(o.temaId).toBe("platba");
      expect(o.text).toContain("card");
    }
  });

  it("vždy vráti nejaký text", () => {
    for (const otazka of ["", "???", "a", "platba kartou"]) {
      expect(odpovedBezAI(otazka, "sk").text.trim().length).toBeGreaterThan(10);
    }
  });
});
