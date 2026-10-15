import { describe, expect, it } from "vitest";
import {
  idZTokenu,
  jeZasobaStara,
  klucKodu,
  rozhodniOffline,
  type OfflineZasoba,
} from "./offline-scan";

const ID = "0123456789abcdef0123456789abcdef";
const TOKEN = `MT2.${ID}.AbCdEfGh12`;

const zasoba: OfflineZasoba = {
  event_id: "e1",
  ids: [ID],
  kody: ["123456789"],
  pouzite: [],
  stiahnute: new Date().toISOString(),
};

describe("idZTokenu", () => {
  it("vytiahne id z podpísaného tokenu", () => {
    expect(idZTokenu(TOKEN)).toBe(ID);
    expect(idZTokenu(`  MT2.${ID.toUpperCase()}.xx  `)).toBe(ID);
  });

  it("odmietne čokoľvek, čo nie je MT2 token", () => {
    expect(idZTokenu("123456789")).toBeNull();
    expect(idZTokenu("MT2.kratke.xx")).toBeNull();
    expect(idZTokenu(`MT1.${ID}.xx`)).toBeNull();
    expect(idZTokenu(`MT2.${ID}`)).toBeNull();
    expect(idZTokenu("")).toBeNull();
  });

  it("kľúčom je id pri tokene a samotný kód pri starej vstupenke", () => {
    expect(klucKodu(TOKEN)).toBe(ID);
    expect(klucKodu(" 123456789 ")).toBe("123456789");
  });
});

describe("rozhodniOffline", () => {
  it("platnú vstupenku pustí", () => {
    const r = rozhodniOffline({ kod: TOKEN, zasoba, pouzite: [] });
    expect(r.result).toBe("valid");
    expect(r.kluc).toBe(ID);
  });

  it("pustí aj starú vstupenku s číselným kódom", () => {
    expect(rozhodniOffline({ kod: "123456789", zasoba, pouzite: [] }).result).toBe("valid");
  });

  it("vymyslený kód odmietne", () => {
    // Toto je jadro opravy: predtým offline režim vrátil „valid" na čokoľvek.
    expect(rozhodniOffline({ kod: "999999999", zasoba, pouzite: [] }).result).toBe("invalid");
    const cudzi = `MT2.${"f".repeat(32)}.xx`;
    expect(rozhodniOffline({ kod: cudzi, zasoba, pouzite: [] }).result).toBe("invalid");
  });

  it("druhý sken tej istej vstupenky je duplikát", () => {
    const r = rozhodniOffline({ kod: TOKEN, zasoba, pouzite: [ID] });
    expect(r.result).toBe("duplicate");
  });

  it("pri povolenom opakovanom vstupe je to reentry, nie duplikát", () => {
    const r = rozhodniOffline({ kod: TOKEN, zasoba, pouzite: [ID], povolitOpakovanyVstup: true });
    expect(r.result).toBe("reentry");
  });

  it("bez stiahnutého zoznamu nerozhoduje — nepredstiera platnosť", () => {
    const r = rozhodniOffline({ kod: TOKEN, zasoba: null, pouzite: [] });
    expect(r.result).toBe("invalid");
    expect(r.message).toMatch(/pripoj/i);
    expect(r.kluc).toBeNull();
  });

  it("prázdny kód odmietne", () => {
    expect(rozhodniOffline({ kod: "   ", zasoba, pouzite: [] }).result).toBe("invalid");
  });

  it("veľkosť písmen v tokene nerozhoduje", () => {
    const r = rozhodniOffline({ kod: `MT2.${ID.toUpperCase()}.xx`, zasoba, pouzite: [] });
    expect(r.result).toBe("valid");
  });
});

describe("vstupenka naskenovaná ešte online", () => {
  it("offline vyjde ako duplikát, nie ako platná", () => {
    // Bez serverového stavu by prešla: lokálny zoznam použitých je prázdny.
    const so = { ...zasoba, ids: [], pouzite: [ID] };
    expect(rozhodniOffline({ kod: TOKEN, zasoba: so, pouzite: [] }).result).toBe("duplicate");
  });

  it("a pri povolenom opakovanom vstupe ako reentry", () => {
    const so = { ...zasoba, ids: [], pouzite: [ID] };
    const r = rozhodniOffline({ kod: TOKEN, zasoba: so, pouzite: [], povolitOpakovanyVstup: true });
    expect(r.result).toBe("reentry");
  });
});

describe("jeZasobaStara", () => {
  const teraz = new Date("2026-10-13T20:00:00Z").getTime();
  it("čerstvú neoznačí", () => {
    expect(jeZasobaStara({ ...zasoba, stiahnute: "2026-10-13T18:00:00Z" }, 12, teraz)).toBe(false);
  });
  it("starú označí", () => {
    expect(jeZasobaStara({ ...zasoba, stiahnute: "2026-10-12T00:00:00Z" }, 12, teraz)).toBe(true);
  });
  it("chýbajúcu alebo nezmyselnú označí", () => {
    expect(jeZasobaStara(null)).toBe(true);
    expect(jeZasobaStara({ ...zasoba, stiahnute: "" }, 12, teraz)).toBe(true);
    expect(jeZasobaStara({ ...zasoba, stiahnute: "nezmysel" }, 12, teraz)).toBe(true);
  });
});
