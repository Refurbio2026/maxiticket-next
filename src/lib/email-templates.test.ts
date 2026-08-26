import { describe, it, expect } from "vitest";
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, renderTemplate } from "./email-templates";

describe("emailové šablóny", () => {
  it("každý kľúč má vstavané znenie a jeho `key` sedí", () => {
    for (const key of TEMPLATE_KEYS) {
      const t = DEFAULT_TEMPLATES[key];
      expect(t, `chýba šablóna ${key}`).toBeTruthy();
      expect(t.key).toBe(key);
      expect(t.subject.length).toBeGreaterThan(0);
      expect(t.html.length).toBeGreaterThan(0);
      expect(t.text.length).toBeGreaterThan(0);
    }
  });

  // Opačne to neplatí: `variables` je nápoveda pre admina, ktorý si šablónu
  // prepíše, takže smie ponúkať aj premenné, ktoré vstavané znenie nepoužíva.
  it("každý zástupný symbol v šablóne je zdokumentovaný v nápovede", () => {
    for (const key of TEMPLATE_KEYS) {
      const t = DEFAULT_TEMPLATES[key];
      const telo = `${t.subject}${t.html}${t.text}`;
      const zdokumentovane = new Set(t.variables.map((v) => v.key));
      const pouzite = [...telo.matchAll(/\{\{\s*(?:#if\s+)?([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
      for (const nazov of pouzite) {
        expect(zdokumentovane, `${key}: {{${nazov}}} chýba v nápovede`).toContain(nazov);
      }
    }
  });

  it("oznam o zrušení doplní dôvod aj vetu o peniazoch", () => {
    const t = DEFAULT_TEMPLATES.cancel;
    const html = renderTemplate(t.html, {
      customer_name: "Peter",
      event_title: "Symfonický koncert",
      event_date: "14. 9. 2026",
      reason: "Choroba účinkujúceho",
      order_short: "A1B2C3D4",
      refund_note: "Sumu 29.00 EUR posielame späť.",
    });
    expect(html).toContain("Choroba účinkujúceho");
    expect(html).toContain("Sumu 29.00 EUR posielame späť.");
    expect(html).toContain("A1B2C3D4");
    expect(html).not.toContain("{{");
  });

  it("escapuje HTML z premenných, aby sa cez meno nedal podstrčiť kód", () => {
    const html = renderTemplate(DEFAULT_TEMPLATES.cancel.html, {
      customer_name: "<script>alert(1)</script>",
      event_title: "Koncert",
      event_date: "14. 9. 2026",
      reason: "dôvod",
      order_short: "A1B2C3D4",
      refund_note: "poznámka",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("predmet sa neescapuje — nie je to HTML", () => {
    const subject = renderTemplate(
      DEFAULT_TEMPLATES.cancel.subject,
      { event_title: "Ružinov & spol." },
      { escape: false },
    );
    expect(subject).toContain("Ružinov & spol.");
  });
});
