// Prístupy k platobným bránam: čítanie, ukladanie a cache.
//
// Hodnota môže prísť z dvoch miest a poradie je dôležité:
//   1. administrácia (tabuľka `payment_credentials`, šifrovane),
//   2. premenné prostredia na serveri.
// Admin má prednosť, nech sa dá brána prenastaviť bez zásahu do servera;
// pôvodné nastavenie v `.env` tým zostáva funkčné ako záloha.
//
// Brány čítajú hodnoty synchrónne (`isConfigured`, `endpoint`), preto sa
// dešifrované prístupy držia v pamäti procesu. Každý vstupný bod, ktorý sa
// brány dotýka, musí najprv zavolať `pripravPristupy()`.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { desifruj, nahlad, zasifruj } from "../secrets.server";
import type { GatewayId, PolozkaKonfiguracie } from "./types";

type Cache = { hodnoty: Map<string, string>; nacitane: number };

let cache: Cache | null = null;
/** Po tomto čase sa cache obnoví, aj keď o zmene nevieme (druhý proces, iný server). */
const PLATNOST_MS = 30_000;

function kluc(provider: string, nazov: string) {
  return `${provider}:${nazov}`;
}

export async function pripravPristupy(): Promise<void> {
  if (cache && Date.now() - cache.nacitane < PLATNOST_MS) return;
  const hodnoty = new Map<string, string>();
  try {
    const { data, error } = await supabaseAdmin
      .from("payment_credentials")
      .select("provider, kluc, hodnota_sifrovana");
    if (error) throw new Error(error.message);
    for (const r of data || []) {
      const otvorene = desifruj(r.hodnota_sifrovana);
      if (otvorene === null) {
        // Zmenený šifrovací kľúč alebo poškodený zápis. Radšej sa tvárime, že
        // hodnota nie je, než by sme bránu kŕmili nezmyslom.
        console.error("Prístup sa nepodarilo dešifrovať", r.provider, r.kluc);
        continue;
      }
      hodnoty.set(kluc(r.provider, r.kluc), otvorene);
    }
  } catch (e) {
    console.error("Prístupy k bránam sa nepodarilo načítať", e);
    // Necháme starú cache, ak nejaká je — výpadok databázy nesmie zhodiť
    // rozrobené platby.
    if (cache) return;
  }
  cache = { hodnoty, nacitane: Date.now() };
}

export function zabudniPristupy(): void {
  cache = null;
}

export type Zdroj = "admin" | "server" | null;

/** Hodnota podľa poradia admin → prostredie. */
export function hodnota(provider: GatewayId, nazov: string): string | undefined {
  const zAdmina = cache?.hodnoty.get(kluc(provider, nazov));
  if (zAdmina && zAdmina.trim()) return zAdmina;
  const zProstredia = process.env[nazov];
  return zProstredia && zProstredia.trim() ? zProstredia : undefined;
}

export function zdroj(provider: GatewayId, nazov: string): Zdroj {
  const zAdmina = cache?.hodnoty.get(kluc(provider, nazov));
  if (zAdmina && zAdmina.trim()) return "admin";
  const zProstredia = process.env[nazov];
  return zProstredia && zProstredia.trim() ? "server" : null;
}

/** Hodnota uložená v admine — pre náhľad. Prostredie sem nezasahuje. */
export function hodnotaZAdmina(provider: GatewayId, nazov: string): string | undefined {
  return cache?.hodnoty.get(kluc(provider, nazov));
}

/**
 * Uloží prístupy. `null` znamená zmazať (brána sa vráti k hodnote
 * z prostredia, ak nejakú má); kľúč, ktorý v objekte nie je, sa nemení.
 */
export async function ulozPristupy(
  provider: GatewayId,
  zmeny: Record<string, string | null>,
  userId: string,
): Promise<void> {
  const naZapis: Array<{
    provider: GatewayId;
    kluc: string;
    hodnota_sifrovana: string;
    updated_by: string;
  }> = [];
  const naZmazanie: string[] = [];

  for (const [nazov, v] of Object.entries(zmeny)) {
    if (v === null) {
      naZmazanie.push(nazov);
      continue;
    }
    const orezane = v.trim();
    if (!orezane) continue;
    naZapis.push({
      provider,
      kluc: nazov,
      hodnota_sifrovana: zasifruj(orezane),
      updated_by: userId,
    });
  }

  if (naZapis.length) {
    const { error } = await supabaseAdmin
      .from("payment_credentials")
      .upsert(naZapis, { onConflict: "provider,kluc" });
    if (error) throw new Error(error.message);
  }
  if (naZmazanie.length) {
    const { error } = await supabaseAdmin
      .from("payment_credentials")
      .delete()
      .eq("provider", provider)
      .in("kluc", naZmazanie);
    if (error) throw new Error(error.message);
  }

  // Nech sa zmena prejaví hneď, nie až o pol minúty.
  zabudniPristupy();
  await pripravPristupy();
}

/**
 * Poskladá položku konfigurácie pre administráciu. Tajnú hodnotu nikdy
 * nevracia celú — len náhľad, podľa ktorého sa dá rozoznať, že tam je tá pravá.
 */
export function polozka(
  provider: GatewayId,
  opts: {
    premenna: string;
    nazov: string;
    popis: string;
    povinna: boolean;
    tajna?: boolean;
    viacriadkova?: boolean;
    /** Iný spôsob, ako sa dá hodnota dodať — napríklad cesta k súboru s kľúčom. */
    inyZdroj?: () => boolean;
  },
): PolozkaKonfiguracie {
  const tajna = opts.tajna ?? false;
  const v = hodnota(provider, opts.premenna);
  const zdrojHodnoty = zdroj(provider, opts.premenna);
  const zInehoZdroja = !v && opts.inyZdroj ? opts.inyZdroj() : false;

  return {
    premenna: opts.premenna,
    nazov: opts.nazov,
    popis: opts.popis,
    povinna: opts.povinna,
    vyplnena: !!v || zInehoZdroja,
    zdroj: zdrojHodnoty ?? (zInehoZdroja ? "server" : null),
    tajna,
    viacriadkova: opts.viacriadkova ?? false,
    ...(tajna ? {} : { hodnota: v }),
    ...(tajna && v ? { nahlad: nahlad(v) } : {}),
  };
}
