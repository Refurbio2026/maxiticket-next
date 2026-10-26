import { describe, expect, it } from "vitest";
import { chybyHarku, ephXml, fault, hodnotaPrvku, obalka, xmlText } from "./eph-soap";

const odosielatel = {
  odosielatelId: "1234567",
  organizacia: "MaxiTicket s.r.o.",
  meno: null,
  ulica: "Drevárska 23",
  mesto: "Pezinok",
  psc: "90201",
  krajina: "SK",
  email: "podpora@eticketo.eu",
};
const adresat = { meno: "Eva Nová", ulica: "Hlavná 1", mesto: "Nitra", psc: "94901" };

describe("escapovanie", () => {
  it("ošetrí znaky, ktoré by rozbili dokument", () => {
    expect(xmlText(`Mrkva & spol <s.r.o.> "A" 'B'`)).toBe(
      "Mrkva &amp; spol &lt;s.r.o.&gt; &quot;A&quot; &apos;B&apos;",
    );
  });

  it("prázdnu hodnotu nevyhodí ako undefined", () => {
    expect(xmlText(null)).toBe("");
  });
});

describe("zostavenie hárku", () => {
  const xml = ephXml({
    verzia: "3.0",
    druhZasielky: 15,
    sposobUhrady: 7,
    datum: "2026-10-26",
    odosielatel,
    zasielky: [
      { adresat, hmotnost: "0.25", zasielkaId: "1000033", poznamka: "Vstupenky" },
      { adresat: { ...adresat, meno: "Firma & syn" }, sluzby: ["vr"] },
    ],
  });

  it("nesie verziu, druh a počet zásielok", () => {
    expect(xml).toContain('<EPH verzia="3.0">');
    expect(xml).toContain("<DruhZasielky>15</DruhZasielky>");
    expect(xml).toContain("<PocetZasielok>2</PocetZasielok>");
  });

  it("odosielateľ má ID pred menom, ako chce schéma", () => {
    expect(xml).toMatch(/<Odosielatel><OdosielatelID>1234567<\/OdosielatelID><Meno>/);
  });

  it("povinné prvky posiela aj prázdne", () => {
    // Schéma Meno aj Organizáciu vyžaduje; keby chýbali, pošta hárok odmietne.
    expect(xml).toContain("<Meno></Meno>");
    expect(xml).toContain("<Organizacia></Organizacia>");
  });

  it("nepovinné prvky bez hodnoty vynechá", () => {
    expect(xml).not.toContain("<CenaDobierky>");
    expect(xml).not.toContain("<CiarovyKod>");
  });

  it("escapuje aj v adrese zásielky", () => {
    expect(xml).toContain("Firma &amp; syn");
  });

  it("služby zabalí do PouziteSluzby", () => {
    expect(xml).toContain("<PouziteSluzby><Sluzba>vr</Sluzba></PouziteSluzby>");
  });

  it("úhradu pridá len keď je zadaná", () => {
    expect(xml).toContain("<Uhrada><SposobUhrady>7</SposobUhrady>");
    const bez = ephXml({ verzia: "3.0", druhZasielky: 15, odosielatel, zasielky: [{ adresat }] });
    expect(bez).not.toContain("<Uhrada>");
  });
});

describe("obálka SOAP", () => {
  const o = obalka("getSheetStatus", "<api:sheetId>42</api:sheetId>", {
    userId: "U1",
    apiKey: "K1",
  });

  it("prvok v tele je <operácia>Request", () => {
    // Na samotné `getSheetStatus` služba odpovie faultom `invalid_action`.
    expect(o).toContain("<api:getSheetStatusRequest>");
    expect(o).toContain("</api:getSheetStatusRequest>");
  });

  it("má menný priestor pošty a prihlásenie v tele", () => {
    expect(o).toContain('xmlns:api="http://mojezasielky.posta.sk/api"');
    expect(o).toContain("<api:userId>U1</api:userId>");
    expect(o).toContain("<api:apiKey>K1</api:apiKey>");
    expect(o).toContain("<api:sheetId>42</api:sheetId>");
  });
});

describe("čítanie odpovede", () => {
  it("nájde hodnotu bez ohľadu na menný priestor", () => {
    expect(hodnotaPrvku("<ns2:sheetId>ABC123</ns2:sheetId>", "sheetId")).toBe("ABC123");
    expect(hodnotaPrvku("<sheetStatus>OK</sheetStatus>", "sheetStatus")).toBe("OK");
    expect(hodnotaPrvku("<iné>x</iné>", "sheetId")).toBeNull();
  });

  it("prečíta zoznam chýb aj s poľom", () => {
    const ch = chybyHarku(
      "<sheetErrorReport><error><attr>Adresat.PSC</attr><reason>Neplatné PSČ</reason></error></sheetErrorReport>",
    );
    expect(ch).toEqual([{ pole: "Adresat.PSC", dovod: "Neplatné PSČ" }]);
  });

  it("rozpozná fault aj s predponou SOAP-ENV", () => {
    // Pošta používa predponu s pomlčkou; výraz, ktorý ju nepokrýval, fault
    // prehliadol a chyba sa tvárila ako obyčajná päťstovka.
    const odpoved =
      "<SOAP-ENV:Envelope><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode>" +
      "<faultstring>invalid_action</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>";
    expect(fault(odpoved)).toBe("invalid_action");
    expect(hodnotaPrvku(odpoved, "faultstring")).toBe("invalid_action");
  });

  it("rozpozná SOAP fault", () => {
    expect(fault("<soap:Fault><faultstring>Bad credentials</faultstring></soap:Fault>")).toBe(
      "Bad credentials",
    );
    expect(fault("<sheetId>1</sheetId>")).toBeNull();
  });
});
