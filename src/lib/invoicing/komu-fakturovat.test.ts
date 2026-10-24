// Komu sa vystavuje faktúra.
//
// Pravidlo: **len firmám**. Fyzická osoba dostane vstupenku a e-mail, daňový
// doklad k nej nepotrebuje. Je to rozhodnutie, ktoré sa dotýka účtovníctva,
// takže je pokryté testami a nie zahrabané v jednom `if`.
import { describe, it, expect } from "vitest";
import { dovodNefakturovania, firemneUdaje, maSaFakturovat } from "./types";

const fyzicka = {
  customer_name: "Jan Novák",
  customer_email: "jan@example.test",
  customer_company: null,
  customer_ico: null,
};

const firma = {
  ...fyzicka,
  customer_company: "MsKS Pezinok",
  customer_ico: "00305022",
  customer_dic: "2020662889",
  customer_ic_dph: "SK2020662889",
  customer_street: "Holubyho 42",
  customer_city: "Pezinok",
  customer_zip: "902 01",
  customer_country: "SK",
};

describe("maSaFakturovat", () => {
  it("firme áno", () => {
    expect(maSaFakturovat(firma)).toBe(true);
  });

  it("fyzickej osobe nie", () => {
    expect(maSaFakturovat(fyzicka)).toBe(false);
    expect(maSaFakturovat({ ...fyzicka, customer_company: "" })).toBe(false);
  });

  it("stačí názov firmy, zvyšok je nepovinný", () => {
    // Drobný podnikateľ nemusí byť platca DPH a nemusí vyplniť adresu.
    expect(maSaFakturovat({ ...fyzicka, customer_company: "Jan Novák – živnosť" })).toBe(true);
  });

  it("samotné IČO bez názvu nestačí", () => {
    // Bez názvu nie je komu faktúru vystaviť a Faktero by odberateľa
    // ani nezaložilo.
    expect(maSaFakturovat({ ...fyzicka, customer_ico: "12345678" })).toBe(false);
  });

  it("prázdna objednávka nespadne a nefakturuje sa", () => {
    expect(maSaFakturovat({})).toBe(false);
  });
});

describe("firemneUdaje", () => {
  it("prenesie všetko, čo zákazník zadal", () => {
    const u = firemneUdaje(firma);
    expect(u).toMatchObject({
      name: "MsKS Pezinok",
      ico: "00305022",
      ic_dph: "SK2020662889",
      city: "Pezinok",
    });
  });

  it("pri fyzickej osobe nevráti nič", () => {
    expect(firemneUdaje(fyzicka)).toBeNull();
  });
});

describe("dovodNefakturovania", () => {
  it("pri fyzickej osobe povie, že je to podľa nastavenia", () => {
    expect(dovodNefakturovania(fyzicka)).toMatch(/fyzickej osoby/);
  });

  it("pri IČO bez názvu to rozlíši — to je skôr preklep než zámer", () => {
    const d = dovodNefakturovania({ ...fyzicka, customer_ico: "12345678" });
    expect(d).toContain("12345678");
    expect(d).toMatch(/nie názov firmy/);
  });
});
