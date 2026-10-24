// Bankové pohyby cez Faktero.
//
// PREČO CEZ FAKTERO: účet je už napojený vo Fakere, ktoré si pohyby z banky
// ťahá samo a vracia ich na `GET /api/v1/bank-transactions` aj s variabilným
// symbolom. Vďaka tomu nepotrebujeme PSD2 certifikát ani stiahnutý výpis —
// a nikto nemusí nič nahrávať ručne.
//
// ČO TO NEDOKÁŽE: pohyb sa objaví najskôr vtedy, keď si ho Faktero stiahne
// z banky; náš cron k tomu pridá najviac svoj interval. Na platbu prevodom
// to stačí, na okamžité potvrdenie nie — od toho je platobná brána.
//
// POZOR na stránkovanie: API vracia najviac 500 pohybov na volanie a
// neponúka „ďalšiu stranu". Keď sa odpoveď dotkne stropu, okno sa rozpolí
// a stiahne sa po častiach — inak by pri rušnom dni ticho vypadli pohyby,
// čo je pri peniazoch to najhoršie, čo sa môže stať.
import { normalizujSumu, normalizujSymbol, maskujKartu } from "../normalize";
import type { NormalizovanaTransakcia, ChybaParsovania } from "../normalize";
import { dopocitajSuhrn, type ApiZdroj, type VysledokParsovania } from "./types";

const ZAKLAD = "https://faktero.sk/api/v1";
/** Strop jedného volania podľa dokumentácie Faktera. */
const STROP = 500;
/** Poistka proti nekonečnému deleniu okna. */
const MAX_HLBKA = 8;
const CAS_LIMIT_MS = 20_000;

export type FakteroPohyb = {
  id?: string;
  bank_account_id?: string;
  booking_date?: string;
  amount?: number | string;
  currency?: string;
  variable_symbol?: string | number | null;
  specific_symbol?: string | number | null;
  constant_symbol?: string | number | null;
  counterparty?: string | null;
  counterparty_iban?: string | null;
  description?: string | null;
  transaction_reference?: string | null;
};

function den(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Jeden pohyb z Faktera do nášho tvaru. */
export function prevedPohyb(surovy: FakteroPohyb): NormalizovanaTransakcia | ChybaParsovania {
  const suma = normalizujSumu(surovy.amount);
  const datum = surovy.booking_date?.slice(0, 10) ?? null;
  if (suma == null || !datum) {
    return { chyba: "Pohyb z Faktera bez sumy alebo dátumu zaúčtovania." };
  }

  const vs = normalizujSymbol(surovy.variable_symbol);
  // `id` je stabilné UUID od Faktera — podľa neho sa pozná, že pohyb už máme.
  const id = surovy.id ?? null;

  return {
    external_id: id ? `faktero:${id}` : null,
    booked_at: new Date(`${datum}T00:00:00Z`).toISOString(),
    value_date: datum,
    amount: suma,
    currency: (surovy.currency || "EUR").toUpperCase(),
    vs_normalized: vs,
    variable_symbol: vs,
    specific_symbol: normalizujSymbol(surovy.specific_symbol),
    constant_symbol: normalizujSymbol(surovy.constant_symbol, 4),
    counterparty_iban: surovy.counterparty_iban ?? null,
    counterparty_name: surovy.counterparty ?? null,
    // Popis chodí z banky, takže v ňom môže byť aj číslo karty.
    message: maskujKartu(surovy.description ?? "") || null,
    provider_tx_id: surovy.transaction_reference ?? id,
  };
}

/** Odpoveď API do nášho tvaru. Čistá funkcia — testuje sa bez siete. */
export function prevedOdpoved(json: unknown): VysledokParsovania {
  const vysledok: VysledokParsovania = { suhrn: null, transakcie: [], chyby: [] };
  const riadky = (json as { data?: unknown[] })?.data;

  if (!Array.isArray(riadky)) {
    vysledok.chyby.push({ chyba: "Odpoveď Faktera nemá očakávaný tvar (chýba pole `data`)." });
    return vysledok;
  }

  for (const surovy of riadky) {
    const v = prevedPohyb((surovy ?? {}) as FakteroPohyb);
    if ("chyba" in v) vysledok.chyby.push(v);
    else vysledok.transakcie.push(v);
  }

  vysledok.suhrn = dopocitajSuhrn(vysledok.transakcie);
  return vysledok;
}

type Dotaz = { kluc: string; ucet?: string; od: Date; do: Date };

async function volaj({ kluc, ucet, od, do: doDatumu }: Dotaz): Promise<unknown> {
  const u = new URL(`${ZAKLAD}/bank-transactions`);
  u.searchParams.set("date_from", den(od));
  u.searchParams.set("date_to", den(doDatumu));
  u.searchParams.set("limit", String(STROP));
  if (ucet) u.searchParams.set("bank_account_id", ucet);

  // Bez časového limitu by zaseknutá odpoveď zablokovala celý beh cronu —
  // a ten rieši peniaze, takže nesmie visieť na jednom zdroji.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAS_LIMIT_MS);
  try {
    const res = await fetch(u.toString(), {
      headers: { accept: "application/json", Authorization: `Bearer ${kluc}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      // Kľúč je v hlavičke, do hlášky sa nikdy nedostane.
      throw new Error(`Faktero odpovedalo ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Stiahne okno; pri dotyku so stropom ho rozpolí a stiahne po častiach. */
async function stiahniOkno(dotaz: Dotaz, hlbka = 0): Promise<VysledokParsovania> {
  const vysledok = prevedOdpoved(await volaj(dotaz));
  const pocet = vysledok.transakcie.length + vysledok.chyby.length;

  const jedenDen = den(dotaz.od) === den(dotaz.do);
  if (pocet < STROP || hlbka >= MAX_HLBKA || jedenDen) {
    if (pocet >= STROP && (jedenDen || hlbka >= MAX_HLBKA)) {
      // Deliť sa už nedá; radšej to povieme nahlas, než aby pohyby ticho zmizli.
      vysledok.chyby.push({
        chyba: `Za ${den(dotaz.od)} je ${STROP} a viac pohybov — časť sa nemusela stiahnuť.`,
      });
    }
    return vysledok;
  }

  const stred = new Date((dotaz.od.getTime() + dotaz.do.getTime()) / 2);
  const prva = await stiahniOkno({ ...dotaz, do: stred }, hlbka + 1);
  const druha = await stiahniOkno(
    { ...dotaz, od: new Date(stred.getTime() + 86_400_000) },
    hlbka + 1,
  );

  // Okná sa môžu dotknúť toho istého dňa, preto zlúčenie bez duplicít.
  const videne = new Set<string>();
  const spolu: NormalizovanaTransakcia[] = [];
  for (const t of [...prva.transakcie, ...druha.transakcie]) {
    const kluc = t.external_id ?? `${t.booked_at}|${t.amount}|${t.variable_symbol ?? ""}`;
    if (videne.has(kluc)) continue;
    videne.add(kluc);
    spolu.push(t);
  }

  return {
    transakcie: spolu,
    chyby: [...prva.chyby, ...druha.chyby],
    suhrn: dopocitajSuhrn(spolu),
  };
}

export const fakteroApi: ApiZdroj = {
  id: "faktero_api",
  async stiahni({ tajomstvo, config, od, do: doDatumu }) {
    // Bez `bank_account_id` vráti Faktero pohyby zo všetkých účtov; keď je
    // účtov viac, je to takmer vždy chyba v nastavení zdroja.
    const ucet = typeof config.bank_account_id === "string" ? config.bank_account_id : undefined;
    return stiahniOkno({ kluc: tajomstvo, ucet, od, do: doDatumu });
  },
};
