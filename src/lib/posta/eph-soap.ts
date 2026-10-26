// ePodací hárok Slovenskej pošty — SOAP rozhranie.
//
// WSDL: https://mojezasielky.posta.sk/integration/webServices/api?wsdl
// Menný priestor: http://mojezasielky.posta.sk/api
//
// Tri operácie, všetky s `auth` (userId + apiKey) v tele požiadavky:
//   importSheet      — pošle celý hárok naraz, vráti sheetId
//   getSheetStatus   — stav hárku, prípadne zoznam chýb
//   getSheet         — hárok aj s obsahom
//
// Na rozdiel od ich REST rozhrania sa hárok neskladá po kúskoch; posiela sa
// jeden XML dokument. Preto je tu stavač XML, nie séria volaní.
//
// POZOR: `DruhZasielky`, `SposobUhrady`, `TypEPH` a `verzia` sú **čísla
// z číselníkov v prílohách pošty**, nie písmenové kódy ako v REST. Ich
// zoznam nie je v strojovo čitateľnej podobe (PDF s vlastným kódovaním
// fontov), preto sa nastavujú v admine a nie sú zadrôtované v kóde.

export const NS = "http://mojezasielky.posta.sk/api";

export type AdresaEph = {
  meno?: string | null;
  organizacia?: string | null;
  ulica: string;
  mesto: string;
  psc: string;
  krajina?: string | null;
  telefon?: string | null;
  email?: string | null;
};

export type ZasielkaEph = {
  adresat: AdresaEph;
  spat?: AdresaEph | null;
  /** Hmotnosť v kg ako text — pošta očakáva reťazec. */
  hmotnost?: string | null;
  /** Naše označenie zásielky; dávame tam číslo objednávky. */
  zasielkaId?: string | null;
  ciarovyKod?: string | null;
  cenaDobierky?: string | null;
  cenaPoistneho?: string | null;
  poznamka?: string | null;
  obsahZasielky?: string | null;
  pocetKusov?: number | null;
  sluzby?: string[];
};

export type HarokEph = {
  verzia: string;
  mena?: string | null;
  typEph?: number | null;
  ephId?: string | null;
  datum?: string | null;
  druhZasielky: number;
  sposobUhrady?: number | null;
  sumaUhrady?: string | null;
  odosielatel: AdresaEph & { odosielatelId: string; cisloUctu?: string | null };
  zasielky: ZasielkaEph[];
};

/** Escapovanie textu do XML. Bez neho by apostrof v mene rozbil dokument. */
export function xmlText(x: string | number | null | undefined): string {
  if (x === null || x === undefined) return "";
  return String(x)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Prvok, ktorý sa vynechá, keď je hodnota prázdna. */
function prvok(nazov: string, hodnota: string | number | null | undefined): string {
  const t = hodnota === null || hodnota === undefined ? "" : String(hodnota).trim();
  return t ? `<${nazov}>${xmlText(t)}</${nazov}>` : "";
}

/** Prvok, ktorý schéma vyžaduje vždy — aj keď je prázdny. */
function povinnyPrvok(nazov: string, hodnota: string | null | undefined): string {
  return `<${nazov}>${xmlText((hodnota ?? "").trim())}</${nazov}>`;
}

function adresa(nazov: string, a: AdresaEph, so: { kontakt: boolean }): string {
  return [
    `<${nazov}>`,
    // Meno aj Organizácia sú v schéme povinné, takže sa posielajú vždy —
    // prázdne, keď ich nemáme.
    povinnyPrvok("Meno", a.meno),
    povinnyPrvok("Organizacia", a.organizacia),
    povinnyPrvok("Ulica", a.ulica),
    povinnyPrvok("Mesto", a.mesto),
    povinnyPrvok("PSC", a.psc),
    prvok("Krajina", (a.krajina ?? "SK").toUpperCase()),
    ...(so.kontakt ? [prvok("Telefon", a.telefon), prvok("Email", a.email)] : []),
    `</${nazov}>`,
  ].join("");
}

function zasielka(z: ZasielkaEph): string {
  return [
    "<Zasielka>",
    adresa("Adresat", z.adresat, { kontakt: true }),
    z.spat ? adresa("Spat", z.spat, { kontakt: false }) : "",
    "<Info>",
    prvok("CiarovyKod", z.ciarovyKod),
    prvok("ZasielkaID", z.zasielkaId),
    prvok("Hmotnost", z.hmotnost),
    prvok("CenaDobierky", z.cenaDobierky),
    prvok("CenaPoistneho", z.cenaPoistneho),
    prvok("Poznamka", z.poznamka),
    prvok("PocetKusov", z.pocetKusov),
    prvok("ObsahZasielky", z.obsahZasielky),
    "</Info>",
    z.sluzby?.length
      ? `<PouziteSluzby>${z.sluzby.map((s) => prvok("Sluzba", s)).join("")}</PouziteSluzby>`
      : "",
    "</Zasielka>",
  ].join("");
}

/** Telo hárku — to isté XML, aké sa dá do ich webu nahrať ručne. */
export function ephXml(h: HarokEph): string {
  return [
    `<EPH verzia="${xmlText(h.verzia)}">`,
    "<InfoEPH>",
    prvok("Mena", h.mena ?? "EUR"),
    prvok("TypEPH", h.typEph),
    prvok("EPHID", h.ephId),
    prvok("Datum", h.datum),
    prvok("PocetZasielok", h.zasielky.length),
    h.sposobUhrady
      ? `<Uhrada>${prvok("SposobUhrady", h.sposobUhrady)}${prvok("SumaUhrady", h.sumaUhrady ?? "0")}</Uhrada>`
      : "",
    prvok("DruhZasielky", h.druhZasielky),
    adresa("Odosielatel", h.odosielatel, { kontakt: true }).replace(
      "<Meno>",
      `${prvok("OdosielatelID", h.odosielatel.odosielatelId)}<Meno>`,
    ),
    "</InfoEPH>",
    `<Zasielky>${h.zasielky.map(zasielka).join("")}</Zasielky>`,
    "</EPH>",
  ].join("");
}

export function obalka(
  operacia: string,
  telo: string,
  auth: { userId: string; apiKey: string },
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:api="${NS}">`,
    "<soapenv:Header/>",
    "<soapenv:Body>",
    `<api:${operacia}Request>`,
    `<api:auth><api:userId>${xmlText(auth.userId)}</api:userId><api:apiKey>${xmlText(auth.apiKey)}</api:apiKey></api:auth>`,
    telo,
    `</api:${operacia}Request>`,
    "</soapenv:Body>",
    "</soapenv:Envelope>",
  ].join("");
}

/** Hodnota prvku bez ohľadu na menný priestor. */
export function hodnotaPrvku(xml: string, nazov: string): string | null {
  const m = xml.match(
    new RegExp(`<(?:[\\w.-]+:)?${nazov}[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${nazov}>`),
  );
  return m ? m[1].trim() : null;
}

export type ChybaHarku = { pole: string; dovod: string };

/** Chyby z `sheetErrorReport` — pošta ich vracia ako dvojice atribút/dôvod. */
export function chybyHarku(xml: string): ChybaHarku[] {
  const out: ChybaHarku[] = [];
  for (const m of xml.matchAll(/<(?:[\w.-]+:)?error[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?error>/g)) {
    out.push({
      pole: hodnotaPrvku(m[1], "attr") ?? "",
      dovod: hodnotaPrvku(m[1], "reason") ?? "",
    });
  }
  return out;
}

/** SOAP fault — napríklad zlé prihlásenie. */
export function fault(xml: string): string | null {
  if (!/<(?:[\w.-]+:)?Fault[\s>]/.test(xml)) return null;
  return (
    hodnotaPrvku(xml, "faultstring") ??
    hodnotaPrvku(xml, "Text") ??
    hodnotaPrvku(xml, "faultcode") ??
    "SOAP fault bez popisu"
  );
}
