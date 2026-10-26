// Volanie ePodacieho hárku Slovenskej pošty.
//
// REST API, v1: https://mojezasielky.posta.sk/integration/rest/v1
// Autentifikácia je hlavička `x-api-auth: apikey {userId}:{apiKey}`; kľúč sa
// zapína v ich webe (Viac → Notifikácie a API → WebEPH API) a u nás sa ukladá
// šifrovane medzi prístupy, rovnako ako platobné brány.
//
// Testovacie prostredie pošty je `ephtest1.posta.sk`. Adresu ich REST API pre
// test dokumentácia neuvádza, preto je celá základná adresa nastaviteľná —
// radšej pole v admine než uhádnutá URL v kóde.
import { hodnota, polozka } from "@/lib/pristupy.server";
import type { PolozkaKonfiguracie } from "@/lib/payment-gateways/types";
import {
  jeUspech,
  precitajChyby,
  skontrolujZasielku,
  teloHarku,
  teloZasielky,
  type Adresa,
  type Druh,
  type Uhrada,
  type Zasielka,
} from "./eph";

export const PROVIDER = "posta";
const PREDVOLENA_ADRESA = "https://mojezasielky.posta.sk/integration/rest/v1";
const CAS_LIMIT_MS = 20_000;

type Pristupy = { userId: string; apiKey: string; zaklad: string };

function pristupy(): Pristupy | null {
  const userId = hodnota(PROVIDER, "EPH_USER_ID");
  const apiKey = hodnota(PROVIDER, "EPH_API_KEY");
  if (!userId || !apiKey) return null;
  return {
    userId,
    apiKey,
    zaklad: (hodnota(PROVIDER, "EPH_BASE_URL") || PREDVOLENA_ADRESA).replace(/\/+$/, ""),
  };
}

export function jeEphNastavene(): boolean {
  return pristupy() !== null;
}

/** Odosielateľ — do hárku ide tak, ako je tu. */
export function odosielatel(): Adresa | null {
  const ulica = hodnota(PROVIDER, "EPH_ODOSIELATEL_ULICA");
  const mesto = hodnota(PROVIDER, "EPH_ODOSIELATEL_MESTO");
  if (!ulica || !mesto) return null;
  return {
    organization: hodnota(PROVIDER, "EPH_ODOSIELATEL_FIRMA") || null,
    name: hodnota(PROVIDER, "EPH_ODOSIELATEL_MENO") || null,
    street: ulica,
    city: mesto,
    zip: hodnota(PROVIDER, "EPH_ODOSIELATEL_PSC") || null,
    country: "sk",
    phone: hodnota(PROVIDER, "EPH_ODOSIELATEL_TELEFON") || null,
    email: hodnota(PROVIDER, "EPH_ODOSIELATEL_EMAIL") || null,
  };
}

export function ephStav(): { pripravene: boolean; detail: string } {
  const p = pristupy();
  if (!p) {
    return {
      pripravene: false,
      detail: "Bez prístupov. Zapni WebEPH API v mojezasielky.posta.sk a vlož userId a kľúč.",
    };
  }
  if (!odosielatel()) {
    return { pripravene: false, detail: "Prístupy sú, ale chýba adresa odosielateľa." };
  }
  const test = p.zaklad !== PREDVOLENA_ADRESA;
  return {
    pripravene: true,
    detail: test ? `Nastavené, volá sa ${p.zaklad}.` : "Nastavené, volá sa ostré API pošty.",
  };
}

export function ephKonfiguracia(): PolozkaKonfiguracie[] {
  const p = (
    premenna: string,
    nazov: string,
    popis: string,
    opts?: { povinna?: boolean; tajna?: boolean },
  ) =>
    polozka(PROVIDER, {
      premenna,
      nazov,
      popis,
      povinna: opts?.povinna ?? false,
      tajna: opts?.tajna ?? false,
    });
  return [
    p("EPH_USER_ID", "userId", "Z nastavenia WebEPH API vo webe pošty.", { povinna: true }),
    p("EPH_API_KEY", "apiKey", "Druhá časť prístupu. Posiela sa v hlavičke, nikdy v adrese.", {
      povinna: true,
      tajna: true,
    }),
    p(
      "EPH_BASE_URL",
      "Adresa API",
      `Prázdne = ostré ${PREDVOLENA_ADRESA}. Pre skúšky adresa testovacieho prostredia pošty.`,
    ),
    p("EPH_ODOSIELATEL_FIRMA", "Odosielateľ — firma", "Názov, ktorý bude na štítku.", {
      povinna: true,
    }),
    p("EPH_ODOSIELATEL_MENO", "Odosielateľ — meno", "Nepovinné, ak je vyplnená firma."),
    p("EPH_ODOSIELATEL_ULICA", "Odosielateľ — ulica a číslo", "", { povinna: true }),
    p("EPH_ODOSIELATEL_MESTO", "Odosielateľ — obec", "", { povinna: true }),
    p("EPH_ODOSIELATEL_PSC", "Odosielateľ — PSČ", "", { povinna: true }),
    p(
      "EPH_ODOSIELATEL_TELEFON",
      "Odosielateľ — telefón",
      "Pošta ho použije pri probléme so zásielkou.",
    ),
    p("EPH_ODOSIELATEL_EMAIL", "Odosielateľ — e-mail", ""),
  ];
}

export class ChybaPosty extends Error {
  constructor(
    message: string,
    readonly chyby: string[] = [],
    readonly stav?: number,
  ) {
    super(message);
    this.name = "ChybaPosty";
  }
}

async function volaj(
  metoda: "GET" | "PUT" | "POST" | "DELETE",
  cesta: string,
  telo?: unknown,
): Promise<Record<string, unknown>> {
  const p = pristupy();
  if (!p) throw new ChybaPosty("ePodací hárok nemá vyplnené prístupy.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAS_LIMIT_MS);
  try {
    const r = await fetch(`${p.zaklad}${cesta}`, {
      method: metoda,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        // Kľúč je v hlavičke, takže sa nedostane do logu adries ani do historie.
        "x-api-auth": `apikey ${p.userId}:${p.apiKey}`,
      },
      body: telo === undefined ? undefined : JSON.stringify(telo),
      signal: controller.signal,
    });

    const text = await r.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new ChybaPosty(
        `Pošta vrátila odpoveď, ktorá nie je JSON (HTTP ${r.status}).`,
        [],
        r.status,
      );
    }

    if (!r.ok || !jeUspech(json)) {
      const chyby = precitajChyby(json);
      throw new ChybaPosty(
        chyby.length ? `Pošta odmietla požiadavku: ${chyby[0]}` : `Pošta odpovedala ${r.status}.`,
        chyby,
        r.status,
      );
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export type Harok = { id: string; ephid?: string; state?: string; charge?: unknown };

/** Založí podací hárok. Zásielky sa doň pridávajú zvlášť. */
export async function vytvorHarok(opts: {
  druh: Druh;
  uhrada: Uhrada;
  podaj?: "post" | "courier";
  zmluva?: boolean;
}): Promise<Harok> {
  const od = odosielatel();
  if (!od) throw new ChybaPosty("Nie je vyplnená adresa odosielateľa.");
  const o = await volaj("PUT", "/sheets", teloHarku(od, opts));
  const sheet = (o.sheet ?? o) as Record<string, unknown>;
  return {
    id: String(sheet.id ?? ""),
    ephid: sheet.ephid ? String(sheet.ephid) : undefined,
    state: sheet.state ? String(sheet.state) : undefined,
    charge: sheet.charge,
  };
}

export type PridanaZasielka = { id: string; parcel_number?: string };

export async function pridajZasielku(
  harokId: string,
  z: Zasielka,
  druh: Druh,
  uhrada: Uhrada,
): Promise<PridanaZasielka> {
  // Kontrolujeme skôr, než to pošleme — ich chybové kódy sú strohé a
  // zákazníkovi by sme z nich aj tak nič zrozumiteľné nepovedali.
  const chyby = skontrolujZasielku(z, druh, uhrada);
  if (chyby.length) {
    throw new ChybaPosty(
      chyby[0].sprava,
      chyby.map((c) => `${c.pole}: ${c.sprava}`),
    );
  }
  const o = await volaj("PUT", `/sheets/${encodeURIComponent(harokId)}/parcels`, teloZasielky(z));
  const parcel = (o.parcel ?? o) as Record<string, unknown>;
  return {
    id: String(parcel.id ?? ""),
    parcel_number: parcel.parcel_number ? String(parcel.parcel_number) : undefined,
  };
}

export async function zmazZasielku(harokId: string, zasielkaId: string): Promise<void> {
  await volaj(
    "DELETE",
    `/sheets/${encodeURIComponent(harokId)}/parcels/${encodeURIComponent(zasielkaId)}`,
  );
}

/** Adresný štítok v PDF (A6). Vracia adresu na stiahnutie. */
export async function stitok(harokId: string, zasielkaId: string): Promise<string | null> {
  const o = await volaj(
    "POST",
    `/sheets/${encodeURIComponent(harokId)}/parcels/${encodeURIComponent(zasielkaId)}/labels`,
    { format: "pdf", type: "address" },
  );
  const url = (o.url ?? (o.label as Record<string, unknown> | undefined)?.url) as
    string | undefined;
  return url ?? null;
}

/** Odošle hárok pošte. Po tomto sa už zásielky pridávať nedajú. */
export async function odosliHarok(harokId: string): Promise<Harok> {
  const o = await volaj("POST", `/sheets/${encodeURIComponent(harokId)}/register`, {});
  const sheet = (o.sheet ?? o) as Record<string, unknown>;
  return {
    id: harokId,
    ephid: sheet.ephid ? String(sheet.ephid) : undefined,
    state: sheet.state ? String(sheet.state) : undefined,
  };
}

export async function detailHarku(
  harokId: string,
  soZasielkami = true,
): Promise<Record<string, unknown>> {
  return volaj("GET", `/sheets/${encodeURIComponent(harokId)}${soZasielkami ? "?parcels=1" : ""}`);
}
