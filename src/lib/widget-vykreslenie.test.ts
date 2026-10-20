// Skript widgetu preženieme atrapou DOM a pozrieme, čo z neho vypadne.
//
// Prečo atrapa a nie jsdom: `jsdom` v projekte nie je a pridávať závislosť pre
// jeden test sa neoplatí. Atrapa stačí — widget používa z DOM len createElement,
// appendChild, textContent, dataset, attachShadow a matchMedia. Zato je takto
// dokázané, že sa naozaj **vykreslí**, nie len že sa parsuje: že vznikne karta
// na každé podujatie, že v odkaze je naše id a `utm_source`, a že tlačidlo má
// `target="_blank"` aj `rel="noopener"`.
import { describe, it, expect, vi } from "vitest";
import { widgetJs } from "./widget-script";

type Prvok = {
  tag: string;
  className: string;
  textContent: string;
  href?: string;
  target?: string;
  rel?: string;
  src?: string;
  alt?: string;
  loading?: string;
  deti: Prvok[];
  dataset: Record<string, string>;
  attachShadow: () => Prvok;
  appendChild: (d: Prvok) => Prvok;
  insertBefore: (d: Prvok) => Prvok;
};

function prvok(tag: string): Prvok {
  const el: Prvok = {
    tag,
    className: "",
    deti: [],
    dataset: {},
    get textContent() {
      return this._text ?? "";
    },
    set textContent(v: string) {
      // Priradenie prázdneho reťazca je v skripte „vyprázdni ma".
      this._text = v;
      if (v === "") this.deti = [];
    },
    attachShadow: () => {
      const koren = prvok("#shadow");
      el.deti.push(koren);
      return koren;
    },
    appendChild(d: Prvok) {
      this.deti.push(d);
      return d;
    },
    insertBefore(d: Prvok) {
      this.deti.push(d);
      return d;
    },
  } as unknown as Prvok;
  return el;
}

/** Všetky prvky v podstrome, aby sa v nich dalo hľadať. */
function vsetky(p: Prvok): Prvok[] {
  return [p, ...p.deti.flatMap((d) => vsetky(d))];
}

const PODUJATIE = {
  id: "7374175b-f3ef-4a68-95ee-d04eec96c149",
  nazov: "Vianočný koncert",
  datum: "2026-12-20",
  cas: "19:00:00",
  miesto: "Kultúrny dom",
  mesto: "Pezinok",
  obrazok: "https://example.test/plakat.jpg",
  kategoria: "koncert",
  cena_od: 12,
  odkaz: "https://eticketo.eu/events/7374175b-f3ef-4a68-95ee-d04eec96c149?utm_source=widget",
};

/** Spustí skript nad atrapou a vráti koreň, do ktorého kreslil. */
async function spusti(
  atributy: Record<string, string>,
  odpoved: unknown = { organizator: { nazov: "MsKS", subdomena: "msks" }, podujatia: [PODUJATIE] },
) {
  const skript = prvok("script");
  Object.assign(skript.dataset, atributy);
  const ciel = prvok("div");

  const doc = {
    currentScript: skript,
    getElementById: (id: string) => (id === "eticketo" ? ciel : null),
    createElement: (tag: string) => prvok(tag),
  };
  const win = { matchMedia: () => ({ matches: false }) };
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(odpoved),
  });

  const spustit = new Function("document", "window", "fetch", widgetJs("https://eticketo.eu"));
  spustit(doc, win, fetchMock);
  // Nech sa dokončí `fetch().then()`.
  await new Promise((r) => setTimeout(r, 0));
  return { ciel, fetchMock };
}

describe("widget sa vykreslí", () => {
  it("zoznam: karta na každé podujatie s názvom, miestom a cenou", async () => {
    const { ciel, fetchMock } = await spusti({ organizator: "msks", pocet: "3" });

    const adresa = String(fetchMock.mock.calls[0][0]);
    expect(adresa).toContain("/api/widget/events?organizator=msks&pocet=3");
    expect(fetchMock.mock.calls[0][1]).toEqual({ credentials: "omit" });

    const prvky = vsetky(ciel);
    const karty = prvky.filter((p) => p.className === "k");
    expect(karty).toHaveLength(1);

    const texty = prvky.map((p) => p.textContent);
    expect(texty).toContain("Vianočný koncert");
    expect(texty).toContain("Kultúrny dom, Pezinok");
    expect(texty.some((t) => t.includes("12,00 €"))).toBe(true);
    // Dátum sa vysádza po slovensky („20. decembra 2026"), nie ako ISO,
    // a čas je skrátený na hodiny a minúty.
    expect(texty.some((t) => t.includes("decembra 2026") && t.endsWith("19:00"))).toBe(true);
    expect(texty.some((t) => t.includes("2026-12-20"))).toBe(false);
  });

  it("tlačidlo vedie na eticketo a otvára sa bezpečne", async () => {
    const { ciel } = await spusti({ organizator: "msks" });
    const odkazy = vsetky(ciel).filter((p) => p.tag === "a" && p.className === "b");
    expect(odkazy).toHaveLength(1);
    expect(odkazy[0].href).toBe(PODUJATIE.odkaz);
    expect(odkazy[0].href).toContain("utm_source=widget");
    expect(odkazy[0].target).toBe("_blank");
    expect(odkazy[0].rel).toBe("noopener");
  });

  it("režim tlačidlo nevykreslí nič navyše", async () => {
    const { ciel } = await spusti({ rezim: "tlacidlo", podujatie: PODUJATIE.id });
    const prvky = vsetky(ciel);
    expect(prvky.filter((p) => p.className === "b")).toHaveLength(1);
    expect(prvky.filter((p) => p.className === "k")).toHaveLength(0);
    expect(prvky.filter((p) => p.className === "jedno")).toHaveLength(0);
  });

  it("jedno podujatie dá kartu s podrobnosťami", async () => {
    const { ciel } = await spusti({ rezim: "podujatie", podujatie: PODUJATIE.id });
    const prvky = vsetky(ciel);
    expect(prvky.filter((p) => p.className === "jedno")).toHaveLength(1);
    expect(prvky.map((p) => p.textContent)).toContain("Vianočný koncert");
  });

  it("prázdny zoznam povie po ľudsky, že nič nie je v predaji", async () => {
    const { ciel } = await spusti({ organizator: "msks" }, { organizator: null, podujatia: [] });
    expect(vsetky(ciel).some((p) => p.textContent.includes("nie sú v predaji"))).toBe(true);
  });

  it("bez povinného atribútu nevolá API a napíše dôvod", async () => {
    const { ciel, fetchMock } = await spusti({});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vsetky(ciel).some((p) => p.textContent.includes("chýba data-organizator"))).toBe(true);
  });

  it("dvakrát vložený ten istý skript sa nevykreslí dvakrát", async () => {
    const skript = prvok("script");
    skript.dataset.organizator = "msks";
    const ciel = prvok("div");
    const doc = {
      currentScript: skript,
      getElementById: (id: string) => (id === "eticketo" ? ciel : null),
      createElement: (tag: string) => prvok(tag),
    };
    const win = { matchMedia: () => ({ matches: false }) };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ organizator: null, podujatia: [PODUJATIE] }),
    });
    const spustit = new Function("document", "window", "fetch", widgetJs("https://eticketo.eu"));
    spustit(doc, win, fetchMock);
    spustit(doc, win, fetchMock);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keď API zlyhá, stránku organizátora nezhodí", async () => {
    const skript = prvok("script");
    skript.dataset.organizator = "msks";
    const ciel = prvok("div");
    const doc = {
      currentScript: skript,
      getElementById: (id: string) => (id === "eticketo" ? ciel : null),
      createElement: (tag: string) => prvok(tag),
    };
    const win = { matchMedia: () => ({ matches: false }) };
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const spustit = new Function("document", "window", "fetch", widgetJs("https://eticketo.eu"));
    expect(() => spustit(doc, win, fetchMock)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(vsetky(ciel).some((p) => p.textContent.includes("nedajú načítať"))).toBe(true);
  });
});
