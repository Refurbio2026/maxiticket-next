import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  crc32,
  manifest,
  postavPassJson,
  relevantnyDatum,
  suboryPassu,
  zip,
  type PassVstup,
} from "./pkpass";

const VSTUP: PassVstup = {
  passTypeIdentifier: "pass.eu.eticketo.vstupenka",
  teamIdentifier: "AB12CD34EF",
  organizationName: "MaxiTicket s.r.o.",
  serialNumber: "bc480bac-c789-40ab-9d37-5332671d714e",
  qrKod: "MT2.bc480bacc78940ab9d375332671d714e.abc12345",
  podujatie: "Vianočný koncert",
  datum: "2026-12-20",
  cas: "19:00:00",
  miesto: "Kultúrny dom",
  mesto: "Pezinok",
  sedadlo: "Rad 3, miesto 12",
  kupujuci: "Jan Novák",
  objednavka: "1000028",
  odkaz: "https://eticketo.eu/account",
  organizator: "MsKS Pezinok",
};

describe("crc32", () => {
  it("sedí so známymi hodnotami", () => {
    // Kontrolné hodnoty zo špecifikácie CRC-32 (IEEE 802.3).
    expect(crc32(Buffer.from(""))).toBe(0);
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(crc32(Buffer.from("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});

describe("zip", () => {
  const subory = [
    { nazov: "pass.json", obsah: Buffer.from('{"a":1}') },
    { nazov: "icon.png", obsah: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  ];

  it("začína podpisom ZIP-u a končí koncovým záznamom", () => {
    const b = zip(subory);
    expect(b.readUInt32LE(0)).toBe(0x04034b50);
    expect(b.readUInt32LE(b.length - 22)).toBe(0x06054b50);
  });

  it("v koncovom zázname je správny počet súborov", () => {
    const b = zip(subory);
    expect(b.readUInt16LE(b.length - 22 + 8)).toBe(2);
    expect(b.readUInt16LE(b.length - 22 + 10)).toBe(2);
  });

  it("veľkosť a posun centrálneho registra ukazujú do archívu", () => {
    const b = zip(subory);
    const velkostRegistra = b.readUInt32LE(b.length - 22 + 12);
    const posunRegistra = b.readUInt32LE(b.length - 22 + 16);
    expect(posunRegistra + velkostRegistra + 22).toBe(b.length);
    // Na posune musí byť podpis záznamu centrálneho registra.
    expect(b.readUInt32LE(posunRegistra)).toBe(0x02014b50);
  });

  it("ukladá bez kompresie a s nedotknutým obsahom", () => {
    const b = zip(subory);
    expect(b.readUInt16LE(8)).toBe(0); // metóda 0 = store
    const dlzkaNazvu = b.readUInt16LE(26);
    const data = b.subarray(30 + dlzkaNazvu, 30 + dlzkaNazvu + b.readUInt32LE(18));
    expect(data.toString()).toBe('{"a":1}');
  });

  it("zapisuje CRC každého súboru", () => {
    const b = zip(subory);
    expect(b.readUInt32LE(14)).toBe(crc32(subory[0].obsah));
  });

  it("rovnaký vstup dá rovnaký výstup — pass sa dá porovnať", () => {
    expect(zip(subory).equals(zip(subory))).toBe(true);
  });

  it("zvládne prázdny zoznam aj názvy s diakritikou", () => {
    expect(zip([]).length).toBe(22);
    const b = zip([{ nazov: "ikonaš.png", obsah: Buffer.from("x") }]);
    const dlzka = b.readUInt16LE(26);
    expect(b.subarray(30, 30 + dlzka).toString("utf8")).toBe("ikonaš.png");
  });
});

describe("manifest", () => {
  it("je SHA-1 každého súboru, ako Apple predpisuje", () => {
    const subory = [{ nazov: "pass.json", obsah: Buffer.from("ahoj") }];
    const m = manifest(subory);
    expect(m["pass.json"]).toBe(crypto.createHash("sha1").update("ahoj").digest("hex"));
    expect(m["pass.json"]).toHaveLength(40);
  });

  it("pokrýva všetky súbory a nič navyše", () => {
    const m = manifest([
      { nazov: "pass.json", obsah: Buffer.from("a") },
      { nazov: "icon.png", obsah: Buffer.from("b") },
      { nazov: "logo.png", obsah: Buffer.from("c") },
    ]);
    expect(Object.keys(m).sort()).toEqual(["icon.png", "logo.png", "pass.json"]);
  });
});

describe("postavPassJson", () => {
  const p = postavPassJson(VSTUP);

  it("je to eventTicket s povinnými identifikátormi", () => {
    expect(p.formatVersion).toBe(1);
    expect(p.passTypeIdentifier).toBe(VSTUP.passTypeIdentifier);
    expect(p.teamIdentifier).toBe(VSTUP.teamIdentifier);
    expect(p.serialNumber).toBe(VSTUP.serialNumber);
    expect(p.eventTicket).toBeTruthy();
  });

  it("QR kód je náš podpísaný token a v predpísanom kódovaní", () => {
    const b = p.barcode as Record<string, string>;
    expect(b.format).toBe("PKBarcodeFormatQR");
    expect(b.message).toBe(VSTUP.qrKod);
    expect(b.messageEncoding).toBe("iso-8859-1");
    // Staršie iOS čítajú `barcode`, novšie `barcodes` — posielame oboje.
    expect(Array.isArray(p.barcodes)).toBe(true);
    expect((p.barcodes as unknown[]).length).toBe(1);
  });

  it("v poliach je podujatie, kedy, miesto aj sedadlo", () => {
    const e = p.eventTicket as Record<string, Array<{ key: string; value: string }>>;
    expect(e.primaryFields[0].value).toBe("Vianočný koncert");
    expect(e.headerFields[0].value).toContain("19:00");
    expect(e.secondaryFields.find((f) => f.key === "miesto")?.value).toBe("Kultúrny dom, Pezinok");
    expect(e.secondaryFields.find((f) => f.key === "sedadlo")?.value).toBe("Rad 3, miesto 12");
  });

  it("prázdne polia vynechá, nenechá v passe prázdne riadky", () => {
    const bez = postavPassJson({
      ...VSTUP,
      sedadlo: null,
      miesto: null,
      mesto: null,
      organizator: null,
      objednavka: null,
      kupujuci: null,
      odkaz: null,
    });
    const e = bez.eventTicket as Record<string, unknown[]>;
    expect(e.secondaryFields).toHaveLength(0);
    expect(e.auxiliaryFields).toHaveLength(0);
    // Na rube zostane aspoň upozornenie.
    expect(e.backFields).toHaveLength(1);
  });

  it("popis neprekročí rozumnú dĺžku ani pri dlhom názve", () => {
    const dlhy = postavPassJson({ ...VSTUP, podujatie: "x".repeat(400) });
    expect(String(dlhy.description).length).toBeLessThanOrEqual(200);
  });
});

describe("relevantnyDatum", () => {
  it("spojí dátum a čas", () => {
    expect(relevantnyDatum("2026-12-20", "19:00:00")).toBe("2026-12-20T19:00:00");
  });

  it("bez času dá poludnie, nech sa pass ukáže v ten deň", () => {
    expect(relevantnyDatum("2026-12-20", null)).toBe("2026-12-20T12:00:00");
  });

  it("nezmyselný dátum vynechá, nech pass nespadne", () => {
    expect(relevantnyDatum("zajtra", "19:00")).toBeUndefined();
    expect(relevantnyDatum("", null)).toBeUndefined();
  });
});

describe("suboryPassu", () => {
  it("pass.json je prvý a je platný JSON", () => {
    const subory = suboryPassu(postavPassJson(VSTUP), [
      { nazov: "icon.png", obsah: Buffer.from([0x89, 0x50]) },
    ]);
    expect(subory[0].nazov).toBe("pass.json");
    expect(() => JSON.parse(subory[0].obsah.toString("utf8"))).not.toThrow();
    expect(subory.map((s) => s.nazov)).toContain("icon.png");
  });
});
