// Zápis platieb z brány do účtovného pohľadu.
//
// Každá brána dostane vlastný účet typu `psp` (schéma s ním počíta: `kind`
// je `bank` alebo `psp` a namiesto IBAN-u má `psp_key`). Potvrdené platby sa
// doň zapíšu ako pohyby, takže vo „Výpisoch z banky" vidno aj peniaze, ktoré
// cez bankový účet samostatne neprešli.
//
// Pohyb sa zapisuje rovno ako spárovaný s objednávkou — platbu potvrdila
// brána, takže nie je čo riešiť. Do zoznamu nespárovaných sa teda nedostane.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { zasifruj } from "../secrets.server";
import { naPohyb, zapisatelna, type PlatbaBrany } from "./brana-zrkadlenie";

export type VysledokZrkadlenia = {
  platieb: number;
  novych: number;
  uctov: number;
  chyb: number;
};

/** Účet brány; vytvorí sa pri prvej platbe, nie dopredu. */
async function ucetBrany(provider: string, mena: string): Promise<string | null> {
  const { data: existuje } = await supabaseAdmin
    .from("bank_accounts")
    .select("id")
    .eq("kind", "psp")
    .eq("psp_key", provider)
    .maybeSingle();
  if (existuje?.id) return existuje.id;

  const { data, error } = await supabaseAdmin
    .from("bank_accounts")
    .insert({
      kind: "psp",
      psp_key: provider,
      bank_name: provider.charAt(0).toUpperCase() + provider.slice(1),
      account_name: "Platby cez bránu",
      currency: mena,
      connected: true,
      provider,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("Účet brány sa nepodarilo založiť", provider, error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function zrkadliPlatbyBran(limit = 500): Promise<VysledokZrkadlenia> {
  const v: VysledokZrkadlenia = { platieb: 0, novych: 0, uctov: 0, chyb: 0 };

  const { data: platby } = await supabaseAdmin
    .from("payments")
    .select("id, order_id, provider, provider_payment_id, amount, currency, status, created_at")
    .in("status", ["paid", "refunded"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!platby?.length) return v;

  const zapisatelne = platby.filter((p) =>
    zapisatelna({ ...p, amount: Number(p.amount) } as PlatbaBrany),
  );
  if (!zapisatelne.length) return v;
  v.platieb = zapisatelne.length;

  // Objednávky naraz — kvôli variabilnému symbolu a menu zákazníka.
  const idObjednavok = [...new Set(zapisatelne.map((p) => p.order_id).filter(Boolean))];
  const { data: objednavky } = idObjednavok.length
    ? await supabaseAdmin
        .from("orders")
        .select("id, payment_vs, customer_name, customer_email")
        .in("id", idObjednavok as string[])
    : { data: [] };

  const ucty = new Map<string, string>();
  for (const p of zapisatelne) {
    if (ucty.has(p.provider)) continue;
    const id = await ucetBrany(p.provider, (p.currency || "EUR").toUpperCase());
    if (id) {
      ucty.set(p.provider, id);
      v.uctov++;
    }
  }

  // Čo už v knihe je. Kľúč stojí na id platby, takže stačí jeden dopyt.
  const kluce = zapisatelne.map((p) => `platba:${p.id}`);
  const uz = new Set<string>();
  for (let i = 0; i < kluce.length; i += 200) {
    const { data } = await supabaseAdmin
      .from("bank_transactions")
      .select("external_id")
      .in("external_id", kluce.slice(i, i + 200));
    for (const r of data ?? []) if (r.external_id) uz.add(r.external_id);
  }

  const riadky = [];
  for (const p of zapisatelne) {
    if (uz.has(`platba:${p.id}`)) continue;
    const accountId = ucty.get(p.provider);
    if (!accountId) continue;

    const o = (objednavky ?? []).find((x) => x.id === p.order_id) ?? null;
    const t = naPohyb({ ...p, amount: Number(p.amount) } as PlatbaBrany, o);
    riadky.push({
      account_id: accountId,
      source_id: null,
      statement_id: null,
      booked_at: t.booked_at,
      value_date: t.value_date,
      amount: t.amount,
      currency: t.currency,
      counterparty_name: t.counterparty_name,
      counterparty_iban: null,
      variable_symbol: t.variable_symbol,
      vs_normalized: t.vs_normalized,
      specific_symbol: null,
      constant_symbol: null,
      message: t.message,
      external_id: t.external_id,
      provider_tx_id: t.provider_tx_id,
      // Platbu potvrdila brána — pohyb je spárovaný už pri zápise.
      matched_order_id: p.order_id,
      status: "matched",
      raw_payload_enc: zasifruj(JSON.stringify({ platba: p.id, provider: p.provider })),
    });
  }

  if (!riadky.length) return v;

  const { data: vlozene, error } = await supabaseAdmin
    .from("bank_transactions")
    .insert(riadky)
    .select("id");
  if (error && error.code !== "23505") {
    v.chyb++;
    console.error("Platby brány sa nepodarilo zapísať", error.message);
    return v;
  }
  v.novych = vlozene?.length ?? 0;
  return v;
}
