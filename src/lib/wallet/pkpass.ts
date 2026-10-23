// Apple Wallet: skladanie `.pkpass`.
//
// `.pkpass` je ZIP, v ktorom je:
//   pass.json        popis vstupenky
//   icon.png         povinná ikona (+ @2x, @3x voliteľne)
//   logo.png         voliteľné
//   manifest.json    SHA-1 každého súboru
//   signature        PKCS#7 odpojený podpis manifestu
//
// Tento modul je čistý — žiadna sieť, žiadne súbory, žiadny openssl. Podpis
// a čítanie certifikátov robí `apple-wallet.server.ts`. Dôvod je prozaický:
// ZIP si tu píšeme sami (balík na to v projekte nie je) a keby bol neplatný,
// Apple pass odmietne bez vysvetlenia. Preto je to pokryté testami.

import crypto from "node:crypto";

/** Jeden súbor v passe. */
export type Subor = { nazov: string; obsah: Buffer };

// --- ZIP (len ukladanie, bez kompresie) -------------------------------------
//
// Store-only ZIP je platný ZIP a pre pár kB textu a dvoch PNG je kompresia
// bezpredmetná. Vyhne sa tým závislosti na deflate aj nedeterminizmu.

const TABULKA_CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ TABULKA_CRC[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/**
 * Zabalí súbory do ZIP-u.
 *
 * Časy sú zámerne pevné (1. 1. 1980, teda nula v DOS formáte): rovnaký vstup
 * má dať rovnaký výstup, nech sa dá pass porovnať a testovať.
 */
export function zip(subory: Subor[]): Buffer {
  const lokalne: Buffer[] = [];
  const centralne: Buffer[] = [];
  let offset = 0;

  for (const s of subory) {
    const nazov = Buffer.from(s.nazov, "utf8");
    const crc = crc32(s.obsah);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // podpis lokálnej hlavičky
    lh.writeUInt16LE(20, 4); // verzia potrebná na rozbalenie (2.0)
    lh.writeUInt16LE(0, 6); // príznaky
    lh.writeUInt16LE(0, 8); // metóda 0 = uložené bez kompresie
    lh.writeUInt16LE(0, 10); // čas
    lh.writeUInt16LE(0, 12); // dátum
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(s.obsah.length, 18); // zabalená veľkosť
    lh.writeUInt32LE(s.obsah.length, 22); // pôvodná veľkosť
    lh.writeUInt16LE(nazov.length, 26);
    lh.writeUInt16LE(0, 28); // extra
    lokalne.push(lh, nazov, s.obsah);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); // podpis záznamu v centrálnom registri
    ch.writeUInt16LE(20, 4); // verzia, ktorou bolo vytvorené
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(s.obsah.length, 20);
    ch.writeUInt32LE(s.obsah.length, 24);
    ch.writeUInt16LE(nazov.length, 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // komentár
    ch.writeUInt16LE(0, 34); // číslo disku
    ch.writeUInt16LE(0, 36); // vnútorné atribúty
    ch.writeUInt32LE(0, 38); // vonkajšie atribúty
    ch.writeUInt32LE(offset, 42);
    centralne.push(ch, nazov);

    offset += lh.length + nazov.length + s.obsah.length;
  }

  const telo = Buffer.concat(lokalne);
  const register = Buffer.concat(centralne);

  const koniec = Buffer.alloc(22);
  koniec.writeUInt32LE(0x06054b50, 0);
  koniec.writeUInt16LE(0, 4); // číslo disku
  koniec.writeUInt16LE(0, 6);
  koniec.writeUInt16LE(subory.length, 8);
  koniec.writeUInt16LE(subory.length, 10);
  koniec.writeUInt32LE(register.length, 12);
  koniec.writeUInt32LE(telo.length, 16);
  koniec.writeUInt16LE(0, 20); // komentár

  return Buffer.concat([telo, register, koniec]);
}

// --- manifest ----------------------------------------------------------------

/**
 * `manifest.json` — SHA-1 každého súboru v passe.
 *
 * SHA-1 je tu zámerne: Apple ho predpisuje. Nie je to voľba bezpečnosti,
 * integritu passu drží podpis manifestu, nie sila hashu.
 */
export function manifest(subory: Subor[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of subory) {
    out[s.nazov] = crypto.createHash("sha1").update(s.obsah).digest("hex");
  }
  return out;
}

// --- pass.json ---------------------------------------------------------------

export type PassVstup = {
  passTypeIdentifier: string;
  teamIdentifier: string;
  organizationName: string;
  /** Id vstupenky — slúži ako sériové číslo passu. */
  serialNumber: string;
  /** Čo je v QR kóde. U nás podpísaný token `MT2.<id>.<podpis>`. */
  qrKod: string;
  podujatie: string;
  datum: string;
  cas: string | null;
  miesto: string | null;
  mesto: string | null;
  sedadlo: string | null;
  /** Meno kupujúceho na rubovej strane. */
  kupujuci: string | null;
  /** Variabilný symbol alebo číslo objednávky. */
  objednavka: string | null;
  /** Adresa, kde si zákazník nájde vstupenku na webe. */
  odkaz: string | null;
  organizator: string | null;
};

const pole = (key: string, label: string, value: string | null) =>
  value ? { key, label, value } : null;

/**
 * Zloží `pass.json` pre typ „eventTicket".
 *
 * `messageEncoding` je `iso-8859-1`, ako Apple predpisuje; náš token je čisté
 * ASCII, takže sa nič neprekóduje. Barcode posielame aj v starom poli
 * `barcode` — staršie iOS `barcodes` nečíta.
 */
export function postavPassJson(v: PassVstup): Record<string, unknown> {
  const barcode = {
    format: "PKBarcodeFormatQR",
    message: v.qrKod,
    messageEncoding: "iso-8859-1",
    altText: v.sedadlo ?? undefined,
  };

  const kedy = [v.datum, v.cas ? v.cas.slice(0, 5) : null].filter(Boolean).join(" · ");
  const kde = [v.miesto, v.mesto].filter(Boolean).join(", ");

  return {
    formatVersion: 1,
    passTypeIdentifier: v.passTypeIdentifier,
    teamIdentifier: v.teamIdentifier,
    organizationName: v.organizationName,
    serialNumber: v.serialNumber,
    description: `Vstupenka: ${v.podujatie}`.slice(0, 200),
    // Brandová oranžová z `--gradient-flame`, podklad ako tmavá téma webu.
    backgroundColor: "rgb(11,11,15)",
    foregroundColor: "rgb(255,255,255)",
    labelColor: "rgb(254,106,0)",
    barcode,
    barcodes: [barcode],
    // Pass sa ukáže na uzamknutej obrazovke okolo začiatku podujatia.
    relevantDate: relevantnyDatum(v.datum, v.cas),
    eventTicket: {
      headerFields: [pole("datum", "Kedy", kedy || v.datum)].filter(Boolean),
      primaryFields: [pole("podujatie", "Podujatie", v.podujatie)].filter(Boolean),
      secondaryFields: [
        pole("miesto", "Miesto", kde || null),
        pole("sedadlo", "Sedadlo", v.sedadlo),
      ].filter(Boolean),
      auxiliaryFields: [
        pole("organizator", "Organizátor", v.organizator),
        pole("objednavka", "Objednávka", v.objednavka),
      ].filter(Boolean),
      backFields: [
        pole("kupujuci", "Kupujúci", v.kupujuci),
        pole("odkaz", "Vstupenka na webe", v.odkaz),
        pole(
          "podmienky",
          "Upozornenie",
          "Vstupenka je platná len na uvedené podujatie. Pri vstupe sa skenuje QR kód.",
        ),
      ].filter(Boolean),
    },
  };
}

/** `relevantDate` v ISO tvare; bez času sa berie poludnie, nech sa pass ukáže v ten deň. */
export function relevantnyDatum(datum: string, cas: string | null): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return undefined;
  const t = cas && /^\d{2}:\d{2}/.test(cas) ? cas.slice(0, 5) : "12:00";
  // Pevný posun +01:00 by v lete klamal o hodinu, preto sa necháva bez zóny —
  // Wallet to vezme ako miestny čas zariadenia, čo je pri vstupenke správne.
  return `${datum}T${t}:00`;
}

/** Súbory passu bez podpisu — manifest aj podpis sa dopĺňajú až nad týmto. */
export function suboryPassu(passJson: Record<string, unknown>, ikony: Subor[]): Subor[] {
  return [
    { nazov: "pass.json", obsah: Buffer.from(JSON.stringify(passJson, null, 1), "utf8") },
    ...ikony,
  ];
}
