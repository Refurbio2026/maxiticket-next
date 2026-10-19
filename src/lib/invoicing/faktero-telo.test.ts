import { describe, expect, it } from "vitest";
import { teloFaktury, teloOdberatela } from "./faktero-telo";
import type { FakturaVstup } from "./types";

const osoba = { name: "Jana Nováková", email: "jana@example.sk", phone: "+421900111222" };

const vstup: FakturaVstup = {
  orderId: "11111111-1111-1111-1111-111111111111",
  variableSymbol: "0000001234",
  customer: osoba,
  items: [
    { name: "Divadlo — parter", unit_price: 20, quantity: 2, tax: 5 },
    { name: "Koncert — státie", unit_price: 15, quantity: 1, tax: 23 },
  ],
};

describe("teloOdberatela", () => {
  it("fyzickú osobu pošle pod jej menom", () => {
    const t = teloOdberatela(osoba, vstup.orderId);
    expect(t.zaklad.name).toBe("Jana Nováková");
    expect(t.zaklad.email).toBe("jana@example.sk");
    expect(t.navyse.external_id).toBe(vstup.orderId);
    // Bez firmy nemá kontaktná osoba zmysel.
    expect(t.navyse).not.toHaveProperty("contact_person");
  });

  it("keď je firma, odberateľom je firma a človek je kontakt", () => {
    const t = teloOdberatela(
      { ...osoba, company: { name: "ABC s. r. o.", ico: "12345678", dic: "2020123456" } },
      vstup.orderId,
    );
    expect(t.zaklad.name).toBe("ABC s. r. o.");
    expect(t.zaklad.ico).toBe("12345678");
    expect(t.navyse.contact_person).toBe("Jana Nováková");
    expect(t.navyse.dic).toBe("2020123456");
  });

  it("prázdne firemné údaje nepošle ako prázdny text", () => {
    // Faktero by si inak prepísalo uložené údaje firmy prázdnom.
    const t = teloOdberatela(
      { ...osoba, company: { name: "ABC s. r. o.", ico: "", dic: null, street: "   " } },
      vstup.orderId,
    );
    expect(t.zaklad).not.toHaveProperty("ico");
    expect(t.zaklad).not.toHaveProperty("street");
    expect(t.navyse).not.toHaveProperty("dic");
  });

  it("bez mena aj bez firmy dá náhradu, nie prázdno", () => {
    const t = teloOdberatela({ name: "", email: "" }, vstup.orderId);
    expect(t.zaklad.name).toBe("Zákazník");
  });
});

describe("teloFaktury", () => {
  const spolocne = { customerId: "cust_1", dnes: "2026-10-15", splatnostNezaplatene: "2026-10-29" };

  it("zaplatená faktúra je splatná dňom vystavenia", () => {
    const t = teloFaktury({ ...spolocne, input: vstup });
    expect(t.zaklad.issue_date).toBe("2026-10-15");
    expect(t.zaklad.due_date).toBe("2026-10-15");
  });

  it("nezaplatená dostane lehotu", () => {
    const t = teloFaktury({ ...spolocne, input: { ...vstup, alreadyPaid: false } });
    expect(t.zaklad.due_date).toBe("2026-10-29");
  });

  it("každá položka si nesie vlastnú sadzbu DPH", () => {
    // Toto je to, na čom záleží: divadlo má 5 %, koncert 23 %, a na jednej
    // faktúre môžu byť obe. Jedna predvolená sadzba by faktúru pokazila.
    const t = teloFaktury({ ...spolocne, input: vstup });
    const items = t.zaklad.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: "Divadlo — parter",
      quantity: 2,
      unit: "ks",
      unit_price: 20,
      vat_rate: 5,
    });
    expect(items[1]).toMatchObject({ unit_price: 15, vat_rate: 23 });
  });

  it("mena je vždy EUR", () => {
    expect(teloFaktury({ ...spolocne, input: vstup }).zaklad.currency).toBe("EUR");
  });

  it("variabilný symbol ide aj ako číslo objednávky", () => {
    const t = teloFaktury({ ...spolocne, input: vstup });
    expect(t.navyse.variable_symbol).toBe("0000001234");
    expect(t.navyse.order_number).toBe("0000001234");
    expect(t.navyse.external_id).toBe(vstup.orderId);
  });

  it("bez uvedeného spôsobu platby predpokládá kartu", () => {
    expect(teloFaktury({ ...spolocne, input: vstup }).navyse.payment_method).toBe("card");
    expect(
      teloFaktury({ ...spolocne, input: { ...vstup, paymentType: "transfer" } }).navyse
        .payment_method,
    ).toBe("transfer");
  });

  it("bez popisu dá text s variabilným symbolom", () => {
    expect(teloFaktury({ ...spolocne, input: vstup }).navyse.notes).toContain("0000001234");
    expect(
      teloFaktury({ ...spolocne, input: { ...vstup, name: "Permanentka 2027" } }).navyse.notes,
    ).toBe("Permanentka 2027");
  });

  it("faktúra bez položiek je prázdny zoznam, nie chyba", () => {
    const t = teloFaktury({ ...spolocne, input: { ...vstup, items: [] } });
    expect(t.zaklad.items).toEqual([]);
  });
});
