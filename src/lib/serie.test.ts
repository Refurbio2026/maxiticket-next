import { describe, it, expect } from "vitest";
import {
  najblizsiDatum,
  pocetMiest,
  popisMiest,
  poslednyDatum,
  zoskupPodujatia,
  type PodujatieVKatalogu,
} from "./serie";

const DNES = "2026-11-01";
const cena = (e: PodujatieVKatalogu & { cena?: number }) => e.cena ?? 25;

type E = PodujatieVKatalogu & { cena?: number };

const p = (u: Partial<E> & { id: string }): E => ({
  title: "Richard Müller Komorný Recitál",
  city: "Prešov",
  venue: "Dom kultúry",
  event_date: "2026-11-17",
  event_time: "18:00:00",
  category: "koncert",
  ...u,
});

const turne: E[] = [
  p({
    id: "a",
    city: "Prešov",
    event_date: "2026-11-17",
    group_id: "g1",
    group_name: "Müller 2026",
  }),
  p({
    id: "b",
    city: "Michalovce",
    event_date: "2026-11-18",
    group_id: "g1",
    group_name: "Müller 2026",
  }),
  p({
    id: "c",
    city: "Rimavská Sobota",
    event_date: "2026-11-19",
    group_id: "g1",
    group_name: "Müller 2026",
  }),
];

describe("dátumy podujatia", () => {
  it("termín v predaji má prednosť pred stĺpcom podujatia", () => {
    const e = p({
      id: "x",
      event_date: "2026-11-17",
      dates: [
        { event_date: "2026-12-20", event_time: "18:00:00", status: "on_sale" },
        { event_date: "2026-12-05", event_time: "18:00:00", status: "on_sale" },
      ],
    });
    expect(najblizsiDatum(e, DNES)).toBe("2026-12-05");
    expect(poslednyDatum(e, DNES)).toBe("2026-12-20");
  });

  it("bez termínov sa použije stĺpec podujatia", () => {
    expect(najblizsiDatum(p({ id: "x" }), DNES)).toBe("2026-11-17");
  });
});

describe("mestá", () => {
  it("jedno, dve a viac", () => {
    expect(popisMiest(["Prešov"])).toBe("Prešov");
    expect(popisMiest(["Prešov", "Michalovce"])).toBe("Prešov a Michalovce");
    expect(popisMiest(["Prešov", "Michalovce", "Rimavská Sobota"])).toBe("Prešov a ďalšie 2");
  });

  it("prázdny zoznam nevracia text", () => {
    expect(popisMiest([])).toBe("");
  });

  it("skloňovanie počtu", () => {
    expect(pocetMiest(1)).toBe("1 mesto");
    expect(pocetMiest(3)).toBe("3 mestá");
    expect(pocetMiest(7)).toBe("7 miest");
  });
});

describe("zoskupenie katalógu", () => {
  it("turné je jedna položka s rozsahom a mestami", () => {
    const v = zoskupPodujatia(turne, cena, DNES);
    expect(v.length).toBe(1);
    const s = v[0];
    if (s.druh !== "seria") throw new Error("očakávala sa séria");
    expect(s.nazov).toBe("Müller 2026");
    expect(s.od).toBe("2026-11-17");
    expect(s.po).toBe("2026-11-19");
    expect(s.mesta).toEqual(["Prešov", "Michalovce", "Rimavská Sobota"]);
    expect(s.podujatia.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("podujatie bez série zostáva samostatnou kartou", () => {
    const v = zoskupPodujatia([p({ id: "x" })], cena, DNES);
    expect(v).toEqual([{ druh: "podujatie", kluc: "x", podujatie: p({ id: "x" }) }]);
  });

  it("séria s jediným podujatím sa nezoskupuje", () => {
    const v = zoskupPodujatia([p({ id: "a", group_id: "g1", group_name: "Turné" })], cena, DNES);
    expect(v[0].druh).toBe("podujatie");
  });

  it("série a samostatné podujatia zostanú v poradí podľa prvého výskytu", () => {
    const mix = [p({ id: "z", title: "Iné", city: "Košice" }), ...turne];
    const v = zoskupPodujatia(mix, cena, DNES);
    expect(v.map((x) => x.druh)).toEqual(["podujatie", "seria"]);
  });

  it("predstavenia v série sú chronologicky, aj keď vstup nebol", () => {
    const v = zoskupPodujatia([turne[2], turne[0], turne[1]], cena, DNES);
    const s = v[0];
    if (s.druh !== "seria") throw new Error("očakávala sa séria");
    expect(s.podujatia.map((x) => x.city)).toEqual(["Prešov", "Michalovce", "Rimavská Sobota"]);
  });

  it("cena série je najnižšia z predstavení", () => {
    const v = zoskupPodujatia(
      [
        { ...turne[0], cena: 30 },
        { ...turne[1], cena: 22 },
        { ...turne[2], cena: 45 },
      ],
      cena,
      DNES,
    );
    const s = v[0];
    if (s.druh !== "seria") throw new Error("očakávala sa séria");
    expect(s.cenaOd).toBe(22);
  });

  it("nulové ceny sa do „od“ nepočítajú", () => {
    const v = zoskupPodujatia(
      [
        { ...turne[0], cena: 0 },
        { ...turne[1], cena: 19 },
      ],
      cena,
      DNES,
    );
    const s = v[0];
    if (s.druh !== "seria") throw new Error("očakávala sa séria");
    expect(s.cenaOd).toBe(19);
  });

  it("to isté mesto dvakrát sa v zozname neopakuje", () => {
    const v = zoskupPodujatia([turne[0], { ...turne[1], city: "Prešov", id: "b2" }], cena, DNES);
    const s = v[0];
    if (s.druh !== "seria") throw new Error("očakávala sa séria");
    expect(s.mesta).toEqual(["Prešov"]);
  });

  it("dve rôzne série sa nepomiešajú", () => {
    const v = zoskupPodujatia(
      [
        ...turne,
        p({ id: "d", group_id: "g2", group_name: "Iné turné", city: "Nitra" }),
        p({ id: "e", group_id: "g2", group_name: "Iné turné", city: "Trnava" }),
      ],
      cena,
      DNES,
    );
    expect(v.length).toBe(2);
    expect(v.every((x) => x.druh === "seria")).toBe(true);
  });

  it("prázdny katalóg nevracia nič", () => {
    expect(zoskupPodujatia([], cena, DNES)).toEqual([]);
  });

  it("nemení vstupné pole", () => {
    const vstup = [turne[2], turne[0]];
    zoskupPodujatia(vstup, cena, DNES);
    expect(vstup[0].id).toBe("c");
  });
});
