import { describe, it, expect } from "vitest";
import {
  bezHtml,
  ical,
  icalText,
  idTerminu,
  json,
  nazovSDatumom,
  odkazPodujatia,
  popisTerminu,
  rss,
  skrat,
  xmlText,
  zalom,
  type TerminFeed,
} from "./feed";

const H = { origin: "https://eticketo.eu" };

const t = (uprava: Partial<TerminFeed> = {}): TerminFeed => ({
  podujatieId: "11111111-2222-3333-4444-555555555555",
  nazov: "Jazz & Blues v Lumière",
  popis: "<p>Večer so <b>štvoricou</b> hudobníkov.</p>",
  obrazok: "https://eticketo.eu/i/jazz.png",
  miesto: "Kino Lumière",
  adresa: "Špitálska 4",
  mesto: "Bratislava",
  kategoria: "koncert",
  cenaOd: 19,
  datum: "2026-11-05",
  cas: "19:30",
  ...uprava,
});

describe("pomocné časti", () => {
  it("xmlText escapuje znaky, ktoré by rozbili dokument", () => {
    expect(xmlText('Jazz & "Blues" <v> Lumière')).toBe(
      "Jazz &amp; &quot;Blues&quot; &lt;v&gt; Lumière",
    );
  });

  it("bezHtml nechá čistý text", () => {
    expect(bezHtml("<p>Večer so <b>štvoricou</b></p>")).toBe("Večer so štvoricou");
  });

  it("skrat reže na hranici slova", () => {
    expect(skrat("jedno dva tri štyri päť", 12)).toBe("jedno dva…");
  });

  it("odkaz nezdvojí lomku", () => {
    expect(odkazPodujatia("https://eticketo.eu/", "abc")).toBe("https://eticketo.eu/events/abc");
  });

  it("id termínu je stabilné a obsahuje dátum", () => {
    expect(idTerminu(t())).toBe("11111111-2222-3333-4444-555555555555-2026-11-05");
  });

  it("názov nesie dátum aj čas", () => {
    expect(nazovSDatumom(t())).toBe("Jazz & Blues v Lumière — 5. 11. 2026, 19:30");
  });

  it("popis spojí text, miesto a cenu", () => {
    const p = popisTerminu(t());
    expect(p).toContain("Večer so štvoricou hudobníkov.");
    expect(p).toContain("Miesto: Kino Lumière, Bratislava.");
    expect(p).toContain("Vstupenky od 19,00 €.");
  });

  it("zrušené podujatie to povie na začiatku", () => {
    expect(popisTerminu(t({ zrusene: true })).startsWith("ZRUŠENÉ.")).toBe(true);
  });

  it("neurčená cena sa nespomína", () => {
    expect(popisTerminu(t({ cenaOd: null }))).not.toContain("Vstupenky od");
  });
});

describe("RSS", () => {
  it("má hlavičku kanála a položku pre každý termín", () => {
    const x = rss([t(), t({ datum: "2026-11-06" })], H);
    expect(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(x).toContain('<rss version="2.0">');
    expect((x.match(/<item>/g) || []).length).toBe(2);
    expect(x).toContain("<language>sk</language>");
  });

  it("názov s ampersandom je escapovaný, nie surový", () => {
    const x = rss([t()], H);
    expect(x).toContain("Jazz &amp; Blues");
    expect(x).not.toMatch(/<title>[^<]*Jazz & Blues/);
  });

  it("guid nie je odkaz a je stabilný", () => {
    expect(rss([t()], H)).toContain(
      '<guid isPermaLink="false">11111111-2222-3333-4444-555555555555-2026-11-05</guid>',
    );
  });

  it("obrázok ide ako enclosure so správnym typom", () => {
    expect(rss([t()], H)).toContain('type="image/png"');
    expect(rss([t({ obrazok: "https://x.sk/a.jpg" })], H)).toContain('type="image/jpeg"');
  });

  it("bez obrázka a bez kategórie sa prvky vynechajú", () => {
    const x = rss([t({ obrazok: null, kategoria: null })], H);
    expect(x).not.toContain("<enclosure");
    expect(x).not.toContain("<category>");
  });

  it("pubDate je dátum podujatia, nie dnešok", () => {
    expect(rss([t()], H)).toContain("<pubDate>Thu, 05 Nov 2026 18:30:00 GMT</pubDate>");
  });

  it("prázdny zoznam je stále platné XML", () => {
    const x = rss([], H);
    expect(x).toContain("</channel>");
    expect(x).not.toContain("<item>");
  });
});

describe("iCalendar", () => {
  it("escapuje oddeľovače formátu", () => {
    expect(icalText("Koncert; naživo, v Lumière\nod 19:30")).toBe(
      "Koncert\\; naživo\\, v Lumière\\nod 19:30",
    );
  });

  it("spätnú lomku zdvojí ako prvú", () => {
    expect(icalText("a\\b;c")).toBe("a\\\\b\\;c");
  });

  it("krátky riadok nezalamuje", () => {
    expect(zalom("SUMMARY:Koncert")).toBe("SUMMARY:Koncert");
  });

  it("dlhý riadok zalomí cez CRLF a medzeru", () => {
    const z = zalom("DESCRIPTION:" + "a".repeat(200));
    expect(z).toContain("\r\n ");
    for (const r of z.split("\r\n")) expect(Buffer.from(r, "utf8").length).toBeLessThanOrEqual(75);
  });

  it("zalomenie nepreseká znak s diakritikou na polovicu", () => {
    const z = zalom("DESCRIPTION:" + "ž".repeat(120));
    // Keby sa znak rozťal, pri spojení by vznikol náhradný znak.
    expect(z.replace(/\r\n /g, "")).toBe("DESCRIPTION:" + "ž".repeat(120));
    expect(z).not.toContain("�");
  });

  it("má obálku kalendára a jednu udalosť na termín", () => {
    const c = ical([t(), t({ datum: "2026-11-06" })], H);
    expect(c.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(c.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect((c.match(/BEGIN:VEVENT/g) || []).length).toBe(2);
  });

  it("riadky oddeľuje CRLF, nie samotným LF", () => {
    const c = ical([t()], H);
    expect(c.includes("\r\n")).toBe(true);
    expect(/[^\r]\n/.test(c)).toBe(false);
  });

  it("čas je v UTC a koniec o dve hodiny neskôr", () => {
    const c = ical([t()], H);
    expect(c).toContain("DTSTART:20261105T183000Z");
    expect(c).toContain("DTEND:20261105T203000Z");
  });

  it("vlastné trvanie sa použije", () => {
    expect(ical([t({ trvanieHodin: 5 })], H)).toContain("DTEND:20261105T233000Z");
  });

  it("zrušené podujatie má STATUS:CANCELLED a povie to v názve", () => {
    const c = ical([t({ zrusene: true })], H);
    expect(c).toContain("STATUS:CANCELLED");
    expect(c).toContain("SUMMARY:ZRUŠENÉ: Jazz & Blues v Lumière");
  });

  it("termín s nečitateľným dátumom sa preskočí, súbor zostane platný", () => {
    const c = ical([t({ datum: "nedatum" }), t()], H);
    expect((c.match(/BEGIN:VEVENT/g) || []).length).toBe(1);
    expect(c.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("UID obsahuje našu domému, aby sa nepomiešal s cudzími", () => {
    expect(ical([t()], H)).toContain(
      "UID:11111111-2222-3333-4444-555555555555-2026-11-05@eticketo.eu",
    );
  });
});

describe("JSON", () => {
  it("je ItemList so schema.org udalosťami", () => {
    const j = json([t()], H) as Record<string, unknown>;
    expect(j["@type"]).toBe("ItemList");
    expect(j.numberOfItems).toBe(1);
    const prvy = (j.itemListElement as Array<{ item: Record<string, unknown> }>)[0].item;
    expect(prvy["@type"]).toBe("Event");
    expect(prvy.startDate).toBe("2026-11-05T19:30:00+01:00");
    expect(prvy.url).toBe("https://eticketo.eu/events/11111111-2222-3333-4444-555555555555");
  });

  it("cena ide ako Offer v eurách", () => {
    const j = json([t()], H) as Record<string, unknown>;
    const prvy = (j.itemListElement as Array<{ item: Record<string, unknown> }>)[0].item;
    const offer = prvy.offers as Record<string, unknown>;
    expect(offer.price).toBe(19);
    expect(offer.priceCurrency).toBe("EUR");
    expect(offer.availability).toBe("https://schema.org/InStock");
  });

  it("bez ceny sa Offer vôbec neuvedie", () => {
    const j = json([t({ cenaOd: null })], H) as Record<string, unknown>;
    const prvy = (j.itemListElement as Array<{ item: Record<string, unknown> }>)[0].item;
    expect(prvy.offers).toBeUndefined();
  });

  it("zrušené podujatie je vypredané a zrušené", () => {
    const j = json([t({ zrusene: true })], H) as Record<string, unknown>;
    const prvy = (j.itemListElement as Array<{ item: Record<string, unknown> }>)[0].item;
    expect(prvy.eventStatus).toBe("https://schema.org/EventCancelled");
    expect((prvy.offers as Record<string, unknown>).availability).toBe(
      "https://schema.org/SoldOut",
    );
  });
});
