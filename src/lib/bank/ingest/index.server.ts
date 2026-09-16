// Ingest bankových pohybov: nahratý výpis a sťahovanie cez API.
//
// Zápis a rozhodovanie sú oddelené. Tu sa pohyby len uložia v stave
// `received`; či sa spárujú, rozhodne až `sparujTransakcie()`. Starý systém
// obe veci miešal do jednej uloženej procedúry, takže sa nedalo zopakovať
// párovanie bez rizika, že sa znova zapíše transakcia.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { zasifruj } from "../../secrets.server";
import { errorMessage } from "../../error-message";
import { maskujIban } from "../normalize";
import type { NormalizovanaTransakcia } from "../normalize";
import { camt053 } from "./camt053";
import { fioApi, fioCsv } from "./fio";
import type { ApiZdroj, ParserVypisu, SuhrnVypisu, VysledokParsovania } from "./types";

/** Parsery súborových výpisov. Nový formát pribúda sem. */
export const PARSERY: ParserVypisu[] = [camt053, fioCsv];

/** Zdroje, ktoré si pohyby vypýtajú samy. */
export const API_ZDROJE: ApiZdroj[] = [fioApi];

export function parserPodlaId(id: string): ParserVypisu | null {
  return PARSERY.find((p) => p.id === id) ?? null;
}

/**
 * Najväčší prijateľný výpis.
 *
 * Nahratý súbor sa parsuje v procese, ktorý obsluhuje web. Bez stropu by
 * stačil jeden veľký XML súbor na to, aby sa server vyčerpal na pamäti —
 * a build na tomto stroji má aj tak haldu na hrane.
 */
export const MAX_VELKOST = 2 * 1024 * 1024;

export type VysledokImportu = {
  transakcii: number;
  novych: number;
  chyb: number;
  chyby: string[];
  statement_id: string | null;
};

/**
 * Uloží rozparsovaný výpis.
 *
 * Duplicitu rieši unikátny kľúč `(account_id, external_id)` — opakované
 * nahratie toho istého súboru pohyby nezdvojí. Pohyb bez `external_id` sa
 * ukladá vždy, ale dostane odvodený kľúč z podpisu platby, nech sa aspoň
 * druhý import rovnakého súboru zachytí.
 */
export async function ulozVysledok(
  accountId: string,
  sourceId: string | null,
  vysledok: VysledokParsovania,
  opts?: { fileName?: string; userId?: string; ukladajOriginal?: boolean },
): Promise<VysledokImportu> {
  const chyby = vysledok.chyby.map((c) => c.chyba);

  let statementId: string | null = null;
  if (vysledok.suhrn) {
    statementId = await ulozSuhrn(accountId, sourceId, vysledok.suhrn, opts);
  }

  if (vysledok.transakcie.length === 0) {
    return { transakcii: 0, novych: 0, chyb: chyby.length, chyby, statement_id: statementId };
  }

  const riadky = vysledok.transakcie.map((t) => ({
    account_id: accountId,
    source_id: sourceId,
    statement_id: statementId,
    booked_at: t.booked_at,
    value_date: t.value_date,
    amount: t.amount,
    currency: t.currency,
    counterparty_name: t.counterparty_name,
    counterparty_iban: t.counterparty_iban,
    variable_symbol: t.variable_symbol,
    vs_normalized: t.vs_normalized,
    specific_symbol: t.specific_symbol,
    constant_symbol: t.constant_symbol,
    message: t.message,
    external_id: t.external_id ?? odvodenyKluc(t),
    provider_tx_id: t.provider_tx_id,
    // Originál sa šifruje: sú v ňom mená, čísla účtov a niekedy aj karty.
    // Retencia ho po čase zmaže — na párovanie ho už netreba.
    raw_payload_enc: opts?.ukladajOriginal ? zasifruj(JSON.stringify(t)) : null,
    status: "received",
  }));

  const { data: vlozene, error } = await supabaseAdmin
    .from("bank_transactions")
    .upsert(riadky, { onConflict: "account_id,external_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(error.message);

  return {
    transakcii: riadky.length,
    novych: vlozene?.length ?? 0,
    chyb: chyby.length,
    chyby,
    statement_id: statementId,
  };
}

/**
 * Kľúč pre pohyb, ktorý vlastné ID nemá.
 *
 * Nie je to náhrada za ID z banky, len ochrana pred dvojitým nahratím toho
 * istého súboru. Dve rôzne platby rovnakej sumy v ten istý deň od toho istého
 * platiteľa s rovnakým VS by sa zlúčili — to je v praxi ten istý pohyb.
 */
function odvodenyKluc(t: NormalizovanaTransakcia): string {
  return [
    "odvodene",
    t.booked_at.slice(0, 10),
    t.amount.toFixed(2),
    t.vs_normalized ?? "-",
    t.counterparty_iban ?? "-",
  ].join("|");
}

async function ulozSuhrn(
  accountId: string,
  sourceId: string | null,
  s: SuhrnVypisu,
  opts?: { fileName?: string; userId?: string },
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("bank_statements")
    .upsert(
      {
        account_id: accountId,
        source_id: sourceId,
        period_from: s.period_from,
        period_to: s.period_to,
        opening_balance: s.opening_balance,
        closing_balance: s.closing_balance,
        credit_sum: s.credit_sum,
        debit_sum: s.debit_sum,
        charges_sum: s.charges_sum,
        credit_count: s.credit_count,
        debit_count: s.debit_count,
        currency: s.currency,
        file_name: opts?.fileName ?? null,
        imported_by: opts?.userId ?? null,
      },
      { onConflict: "account_id,period_from,period_to" },
    )
    .select("id")
    .single();
  if (error) {
    console.error("Súhrn výpisu sa nepodarilo uložiť", error.message);
    return null;
  }
  return data?.id ?? null;
}

export type VysledokStahovania = {
  zdrojov: number;
  novych: number;
  chyb: number;
  detail: Array<{ zdroj: string; novych: number; chyba?: string }>;
};

/**
 * Stiahne pohyby zo všetkých zapnutých API zdrojov.
 *
 * Okno sa prekrýva o `window_days` — bez prekryvu by transakcia, ktorá
 * v banke pribudla tesne po behu, vypadla nadobro. Zdvojeniu bráni unikátny
 * kľúč, takže prekryv nič nestojí.
 */
export async function stiahniZoZdrojov(): Promise<VysledokStahovania> {
  const v: VysledokStahovania = { zdrojov: 0, novych: 0, chyb: 0, detail: [] };

  const { data: zdroje } = await supabaseAdmin
    .from("bank_statement_sources")
    .select("id, account_id, name, kind, provider, config, secret_enc, window_days")
    .eq("kind", "api")
    .eq("enabled", true);

  for (const z of zdroje || []) {
    v.zdrojov++;
    const adapter = API_ZDROJE.find((a) => a.id === `${z.provider}_api`);

    if (!adapter) {
      v.chyb++;
      v.detail.push({ zdroj: z.name, novych: 0, chyba: `Pre ${z.provider} nie je adaptér.` });
      continue;
    }
    if (!z.secret_enc) {
      v.chyb++;
      v.detail.push({ zdroj: z.name, novych: 0, chyba: "Chýba prístupový token." });
      continue;
    }

    try {
      const { desifruj } = await import("../../secrets.server");
      const tajomstvo = desifruj(z.secret_enc);
      if (!tajomstvo) throw new Error("Token sa nepodarilo dešifrovať.");

      const doDatumu = new Date();
      const od = new Date(doDatumu.getTime() - (z.window_days || 2) * 86_400_000);
      const vysledok = await adapter.stiahni({
        tajomstvo,
        config: (z.config ?? {}) as Record<string, unknown>,
        od,
        do: doDatumu,
      });

      const ulozene = await ulozVysledok(z.account_id, z.id, vysledok, { ukladajOriginal: true });
      v.novych += ulozene.novych;
      v.detail.push({ zdroj: z.name, novych: ulozene.novych });

      await supabaseAdmin
        .from("bank_statement_sources")
        .update({
          last_success_at: new Date().toISOString(),
          last_error: null,
          last_error_at: null,
        })
        .eq("id", z.id);
    } catch (e) {
      // Zlyhanie jedného zdroja nesmie zastaviť ostatné ani celý beh cronu.
      v.chyb++;
      const sprava = errorMessage(e);
      v.detail.push({ zdroj: z.name, novych: 0, chyba: sprava });
      console.error("Sťahovanie zo zdroja zlyhalo", z.name, sprava);
      await supabaseAdmin
        .from("bank_statement_sources")
        .update({ last_error: sprava.slice(0, 500), last_error_at: new Date().toISOString() })
        .eq("id", z.id);
    }
  }

  return v;
}

/**
 * Zmaže staré originály zo zdrojov.
 *
 * Surový záznam obsahuje osobné údaje a niekedy aj čísla kariet. Po spárovaní
 * ho na nič nepotrebujeme, tak ho nedržíme dlhšie, než treba na dohľadanie.
 */
export async function upracOriginaly(dni: number): Promise<number> {
  const hranica = new Date(Date.now() - dni * 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("bank_transactions")
    .update({ raw_payload_enc: null })
    .lt("received_at", hranica)
    .not("raw_payload_enc", "is", null)
    .select("id");
  return data?.length ?? 0;
}

/** Popis účtu do logu — nikdy celý IBAN. */
export function popisUctu(a: { bank_name: string; iban: string | null; psp_key: string | null }) {
  return `${a.bank_name} ${a.iban ? maskujIban(a.iban) : (a.psp_key ?? "")}`.trim();
}
