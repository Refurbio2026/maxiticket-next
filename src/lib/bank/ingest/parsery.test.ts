// Parsery výpisov na vzorkách zo špecifikácie (kapitola 4.3).
import { describe, it, expect } from "vitest";
import { parsujCamt053 } from "./camt053";
import { parsujFioCsv, prevedFioJson } from "./fio";

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>MSG-1</MsgId></GrpHdr>
    <Stmt>
      <Id>SK00-003-260331</Id>
      <FrToDt><FrDtTm>2026-03-01T00:00:00</FrDtTm><ToDtTm>2026-03-31T23:59:59</ToDtTm></FrToDt>
      <Acct><Id><IBAN>SK0075000000000012345678</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1002.70</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
      <Ntry>
        <NtryRef>REF1</NtryRef>
        <Amt Ccy="EUR">27.70</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-03-03</Dt></BookgDt>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>/VS15501234/SS/KS0308</EndToEndId></Refs>
          <RltdPties>
            <Dbtr><Nm>Peter Novak</Nm></Dbtr>
            <DbtrAcct><Id><IBAN>SK0009000000000087654321</IBAN></Id></DbtrAcct>
          </RltdPties>
          <RmtInf><Ustrd>Platba za vstupenky</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <NtryRef>REF2</NtryRef>
        <Amt Ccy="EUR">25.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><Dt>2026-03-10</Dt></BookgDt>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>/VS15501234/SS/KS0308</EndToEndId></Refs>
          <RltdPties>
            <Cdtr><Nm>Peter Novak</Nm></Cdtr>
            <CdtrAcct><Id><IBAN>SK0009000000000087654321</IBAN></Id></CdtrAcct>
          </RltdPties>
        </TxDtls></NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

describe("camt.053", () => {
  const v = parsujCamt053(CAMT);

  it("prečíta obidva pohyby bez chyby", () => {
    expect(v.chyby).toEqual([]);
    expect(v.transakcie).toHaveLength(2);
  });

  // Suma v camt.053 je vždy kladná; smer hovorí CdtDbtInd. Kto to prehliadne,
  // zaúčtuje odchádzajúce platby ako tržbu.
  it("zoberie znamienko z CdtDbtInd, nie zo sumy", () => {
    expect(v.transakcie[0].amount).toBe(27.7);
    expect(v.transakcie[1].amount).toBe(-25);
  });

  it("doplní variabilný symbol nulami", () => {
    expect(v.transakcie[0].vs_normalized).toBe("0015501234");
    expect(v.transakcie[0].constant_symbol).toBe("0308");
    expect(v.transakcie[0].specific_symbol).toBeNull();
  });

  // Pri prijatej platbe je protistranou dlžník, pri odoslanej veriteľ.
  it("berie protiúčet podľa smeru platby", () => {
    expect(v.transakcie[0].counterparty_iban).toBe("SK0009000000000087654321");
    expect(v.transakcie[1].counterparty_iban).toBe("SK0009000000000087654321");
  });

  it("má stabilné external_id z referencie banky", () => {
    expect(v.transakcie[0].external_id).toBe("camt:REF1");
  });

  it("prečíta obdobie aj zostatky", () => {
    expect(v.suhrn?.period_from).toBe("2026-03-01");
    expect(v.suhrn?.period_to).toBe("2026-03-31");
    expect(v.suhrn?.opening_balance).toBe(1000);
    expect(v.suhrn?.closing_balance).toBe(1002.7);
    expect(v.suhrn?.credit_sum).toBe(27.7);
    expect(v.suhrn?.debit_sum).toBe(25);
  });

  it("kontrola zostatkov vychádza", () => {
    const s = v.suhrn!;
    expect(s.opening_balance! + s.credit_sum - s.debit_sum - s.charges_sum).toBeCloseTo(
      s.closing_balance!,
      2,
    );
  });

  it("z nezmyselného vstupu nespraví transakcie", () => {
    const zly = parsujCamt053("toto nie je xml");
    expect(zly.transakcie).toHaveLength(0);
    expect(zly.chyby.length).toBeGreaterThan(0);
  });

  // Nahratý súbor je cudzí vstup; externá entita by inak vedela prečítať
  // súbor zo servera alebo vyvolať požiadavku do vnútornej siete.
  it("neexpanduje externé entity (XXE)", () => {
    const utok = `<?xml version="1.0"?>
      <!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
      <Document><BkToCstmrStmt><Stmt><Acct><Ccy>EUR</Ccy></Acct>
      <Ntry><NtryRef>&xxe;</NtryRef><Amt Ccy="EUR">1.00</Amt>
      <CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-03-03</Dt></BookgDt></Ntry>
      </Stmt></BkToCstmrStmt></Document>`;
    const r = parsujCamt053(utok);
    const text = JSON.stringify(r);
    expect(text).not.toContain("root:");
    expect(text).not.toContain("/bin/bash");
  });
});

const FIO_CSV = `accountId;2900123456
Počáteční stav účtu k 01.03.2026;1000.00
Koncový stav účtu k 31.03.2026;1027.70

ID operace;Datum;Objem;Měna;Protiúčet;Kód banky;KS;VS;SS;Zpráva pro příjemce;Název protiúčtu
1234567890;03.03.2026;27,70;EUR;SK0009000000000087654321;0900;0308;15501234;;Platba za vstupenky;Peter Novak
1234567891;05.03.2026;-9,90;EUR;;;;;;Poplatok za vedenie uctu;`;

describe("Fio CSV", () => {
  const v = parsujFioCsv(FIO_CSV);

  it("prečíta pohyby aj so zápornými", () => {
    expect(v.chyby).toEqual([]);
    expect(v.transakcie).toHaveLength(2);
    expect(v.transakcie[0].amount).toBe(27.7);
    expect(v.transakcie[1].amount).toBe(-9.9);
  });

  it("normalizuje symboly a IBAN", () => {
    expect(v.transakcie[0].vs_normalized).toBe("0015501234");
    expect(v.transakcie[0].constant_symbol).toBe("0308");
    expect(v.transakcie[0].counterparty_iban).toBe("SK0009000000000087654321");
  });

  // Ten istý pohyb môže prísť aj zo súboru, aj z API — kľúč musí byť rovnaký.
  it("používa ID operácie ako external_id", () => {
    expect(v.transakcie[0].external_id).toBe("fio:1234567890");
  });

  it("prečíta zostatky z hlavičky súboru", () => {
    expect(v.suhrn?.opening_balance).toBe(1000);
    expect(v.suhrn?.closing_balance).toBe(1027.7);
  });

  it("bez hlavičky tabuľky sa neuhádne nič", () => {
    const r = parsujFioCsv("nejaky;nezmysel\n1;2");
    expect(r.transakcie).toHaveLength(0);
    expect(r.chyby.length).toBeGreaterThan(0);
  });
});

describe("Fio API", () => {
  const json = {
    accountStatement: {
      transactionList: {
        transaction: [
          {
            column22: { value: 1234567890 },
            column0: { value: "2026-03-03+0100" },
            column1: { value: 27.7 },
            column2: { value: "SK0009000000000087654321" },
            column5: { value: "15501234" },
            column16: { value: "Platba za vstupenky" },
            column14: { value: "EUR" },
          },
        ],
      },
    },
  };

  it("dá rovnaký external_id ako CSV, takže sa pohyb nezdvojí", () => {
    const v = prevedFioJson(json);
    expect(v.transakcie).toHaveLength(1);
    expect(v.transakcie[0].external_id).toBe("fio:1234567890");
    expect(v.transakcie[0].amount).toBe(27.7);
    expect(v.transakcie[0].vs_normalized).toBe("0015501234");
    // Dátum z Fio nesie časové pásmo, ktoré do dňa zaúčtovania nepatrí.
    expect(v.transakcie[0].booked_at.slice(0, 10)).toBe("2026-03-03");
  });

  it("nezrozumiteľnú odpoveď nahlási, nie stichne", () => {
    const v = prevedFioJson({ nieco: "ine" });
    expect(v.transakcie).toHaveLength(0);
    expect(v.chyby.length).toBeGreaterThan(0);
  });
});
