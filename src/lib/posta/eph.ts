// ePodací hárok Slovenskej pošty — čisté časti.
//
// Zdroj: https://mojezasielky.posta.sk/pomoc/webeph-api/ (REST API, v1).
// Nič tu nie je uhádnuté: čísleníky aj limity sú odpísané z ich dokumentácie
// a kontroly nižšie zodpovedajú tomu, čo ich server odmietne.
//
// PREČO SA KONTROLUJE U NÁS: ich API vráti `validation_failed` so zoznamom
// kódov, ktorý zákazníkovi nepovieme. Lepšie je nepustiť zásielku ďalej už
// pri objednávke a povedať rovno, čo chýba — po zaplatení je neskoro.

/** Druh zásielky. Kódy podľa číselníka pošty. */
export const DRUHY = {
  r: "Doporučený list",
  pl: "Poistený list",
  uz: "Úradná zásielka",
  b: "Balík",
  ek: "Expres kuriér",
  ems: "EMS",
  epg: "EPG — Obchodný balík",
  zb: "Balík — zmluvní zákazníci",
  lt: "Balíček",
  epo1: "Easy Expres 1",
  epo10: "Easy Expres 10",
  pz: "Prime zásielka",
  olz: "List",
} as const;
export type Druh = keyof typeof DRUHY;

export const UHRADY = {
  up: "Úver poštovného",
  vsz: "Výplatný stroj",
  pz: "Poštové známky",
  pr: "Prevodom",
  h: "Hotovosť",
  vps: "Vec poštovej služby",
  fa: "Faktúra",
  ol: "Online",
} as const;
export type Uhrada = keyof typeof UHRADY;

export const SLUZBY = {
  doh: "Doručiť do 10:00",
  d: "Doručenka",
  f: "Krehké",
  iod: "Info o doručení",
  ndo: "Nedoposielať",
  neu: "Neukladať",
  nev: "Nevrátiť",
  nsk: "Neskladné",
  od: "Opakované doručenie",
  pr: "Doručenie na poštu / BalíkoBOX / PoštaPOINT",
  sv: "Splnomocnenie vylúčené",
  svd: "Spätné vrátenie potvrdenej dokumentácie",
  vr: "Do vlastných rúk",
  vt: "Výmena tovaru",
} as const;
export type Sluzba = keyof typeof SLUZBY;

/** Stav hárku, ktorý vracia pošta. */
export const STAVY = {
  draft: "rozpracovaný",
  registered: "odoslaný pošte",
  opened: "otvorený poštou",
  received: "prevzatý",
  confirmed: "potvrdený",
  expired: "expirovaný",
  aborted: "zrušený",
} as const;

export type Adresa = {
  name?: string | null;
  organization?: string | null;
  street: string;
  city: string;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type Chyba = { pole: string; sprava: string };

const dlzka = (h: string | null | undefined, max: number) => (h ?? "").trim().length <= max;
const je = (h: string | null | undefined) => !!(h ?? "").trim();

/**
 * Kontrola adresy podľa pravidiel pošty.
 *
 * `naPostu` = zásielka so službou `pr` (na poštu, BalíkoBOX, PoštaPOINT);
 * tam pošta vyžaduje telefón alebo e-mail, inak nemá komu oznámiť príchod.
 */
export function skontrolujAdresu(a: Adresa, opts?: { naPostu?: boolean }): Chyba[] {
  const ch: Chyba[] = [];
  const krajina = (a.country ?? "sk").toLowerCase();

  if (!je(a.name) && !je(a.organization)) {
    ch.push({ pole: "name", sprava: "Vyplň meno alebo názov firmy." });
  }
  if (!dlzka(a.name, 100)) ch.push({ pole: "name", sprava: "Meno má najviac 100 znakov." });
  if (!dlzka(a.organization, 100)) {
    ch.push({ pole: "organization", sprava: "Názov firmy má najviac 100 znakov." });
  }
  if (!je(a.street)) ch.push({ pole: "street", sprava: "Vyplň ulicu a číslo." });
  if (!dlzka(a.street, 100)) ch.push({ pole: "street", sprava: "Ulica má najviac 100 znakov." });
  if (!je(a.city)) ch.push({ pole: "city", sprava: "Vyplň obec." });
  if (!dlzka(a.city, 100)) ch.push({ pole: "city", sprava: "Obec má najviac 100 znakov." });
  if (krajina === "sk" && !je(a.zip)) ch.push({ pole: "zip", sprava: "Pre Slovensko vyplň PSČ." });
  if (!dlzka(a.zip, 20)) ch.push({ pole: "zip", sprava: "PSČ má najviac 20 znakov." });
  if (!dlzka(a.phone, 20)) ch.push({ pole: "phone", sprava: "Telefón má najviac 20 znakov." });
  if (!dlzka(a.email, 80)) ch.push({ pole: "email", sprava: "E-mail má najviac 80 znakov." });
  if (opts?.naPostu && !je(a.phone) && !je(a.email)) {
    ch.push({
      pole: "phone",
      sprava: "Pri doručení na poštu treba telefón alebo e-mail — pošta oznamuje príchod zásielky.",
    });
  }
  return ch;
}

export type Zasielka = {
  recipient: Adresa;
  /** Hmotnosť v kg, najviac tri desatinné miesta. */
  weight?: number | null;
  services?: Sluzba[];
  /** Vlastné označenie — dávame tam číslo objednávky. */
  custom_identifier?: string | null;
  note?: string | null;
  handover_period?: number | null;
};

export function skontrolujZasielku(z: Zasielka, druh: Druh, uhrada: Uhrada): Chyba[] {
  const naPostu = (z.services ?? []).includes("pr");
  const ch = skontrolujAdresu(z.recipient, { naPostu });

  // Pri online úhrade pošta hmotnosť vyžaduje — bez nej nevie spočítať cenu.
  if (uhrada === "ol" && (z.weight == null || z.weight <= 0)) {
    ch.push({ pole: "weight", sprava: "Pri online úhrade treba vyplniť hmotnosť." });
  }
  if (z.weight != null && Math.round(z.weight * 1000) !== z.weight * 1000) {
    ch.push({ pole: "weight", sprava: "Hmotnosť má najviac tri desatinné miesta." });
  }
  if (z.custom_identifier && !/^[0-9]{1,100}$/.test(z.custom_identifier)) {
    ch.push({
      pole: "custom_identifier",
      sprava: "Vlastné označenie smie obsahovať len číslice, najviac sto.",
    });
  }
  if (!dlzka(z.note, 200)) ch.push({ pole: "note", sprava: "Poznámka má najviac 200 znakov." });

  // Odberná lehota: list do 17 dní, balík a expres do 9.
  if (z.handover_period != null) {
    const jeList = druh === "r" || druh === "pl" || druh === "uz" || druh === "olz";
    const max = jeList ? 17 : 9;
    if (z.handover_period < 1 || z.handover_period > max) {
      ch.push({
        pole: "handover_period",
        sprava: `Odberná lehota pre tento druh je 1 až ${max} dní.`,
      });
    }
  }
  return ch;
}

function ocisti(a: Adresa): Adresa {
  const t = (x: string | null | undefined) => (x ?? "").trim() || undefined;
  return {
    name: t(a.name),
    organization: t(a.organization),
    street: (a.street ?? "").trim(),
    city: (a.city ?? "").trim(),
    zip: t(a.zip),
    country: (a.country ?? "sk").toLowerCase(),
    phone: t(a.phone),
    email: t(a.email),
  };
}

export function teloHarku(
  odosielatel: Adresa,
  opts: {
    druh: Druh;
    uhrada: Uhrada;
    podaj?: "post" | "courier";
    zmluva?: boolean;
  },
): Record<string, unknown> {
  return {
    sheet: {
      parcel_category: opts.druh,
      payment_type: opts.uhrada,
      reception_method: opts.podaj ?? "post",
      contract: opts.zmluva ?? false,
      own_parcel_numbers: false,
      skip_parcel_numbers: false,
      sender: ocisti(odosielatel),
    },
  };
}

export function teloZasielky(z: Zasielka): Record<string, unknown> {
  return {
    parcel: {
      recipient: ocisti(z.recipient),
      ...(z.weight != null ? { weight: z.weight } : {}),
      ...(z.services?.length ? { services: z.services } : {}),
      ...(z.custom_identifier ? { custom_identifier: z.custom_identifier } : {}),
      ...(z.note ? { note: z.note.slice(0, 200) } : {}),
      ...(z.handover_period != null ? { handover_period: z.handover_period } : {}),
    },
  };
}

/**
 * Chyby z odpovede pošty do zrozumiteľnej podoby.
 *
 * Ich tvar: `{ status: "validation_failed", validation_errors: [{attribute, code}] }`.
 * Kódy sú strohé, preto sa prekladajú — a čo nepoznáme, ukážeme tak, ako prišlo,
 * nech sa to dá dohľadať.
 */
export function precitajChyby(json: unknown): string[] {
  const d = (json ?? {}) as { status?: string; validation_errors?: unknown[] };
  if (d.status === "ok") return [];
  const zoznam = Array.isArray(d.validation_errors) ? d.validation_errors : [];
  if (!zoznam.length) return d.status ? [`Pošta odpovedala „${d.status}".`] : [];

  return zoznam.map((x) => {
    const e = (x ?? {}) as { attribute?: string; code?: string; message?: string };
    const pole = e.attribute ? `${e.attribute}: ` : "";
    return `${pole}${e.message || e.code || "neznáma chyba"}`;
  });
}

export function jeUspech(json: unknown): boolean {
  return ((json ?? {}) as { status?: string }).status === "ok";
}
