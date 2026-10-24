// Označenie pohybov, ktoré nepatria k predaju vstupeniek.
//
// Beží po párovaní, takže sa pozerá len na to, čo zostalo nespárované.
// Rozhodovanie samotné je v `mimo-vstupenky.ts` — čistá funkcia bez databázy,
// aby sa dalo otestovať, čo sa označí a hlavne čo sa NEOZNAČÍ.
//
// Ručnej zmeny sa nedotýka: keď pohyb niekto v admine posúdil (`manual_change`),
// zostáva tak, ako ho nechal človek.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { zaradMimo, type Kontext } from "./mimo-vstupenky";

export type VysledokOznacenia = {
  posudenych: number;
  oznacenych: number;
  podlaDovodu: Record<string, number>;
};

/** Variabilné symboly zo starého systému. Načítajú sa raz za beh. */
async function stareVs(): Promise<Set<string>> {
  const out = new Set<string>();
  // Postupne po stránkach; tabuľka má desaťtisíce riadkov a celé ju
  // nepotrebujeme držať v pamäti dvakrát.
  for (let od = 0; od < 100_000; od += 1000) {
    const { data, error } = await supabaseAdmin
      .from("om_orders")
      .select("vs")
      .not("vs", "is", null)
      .range(od, od + 999);
    if (error || !data?.length) break;
    for (const r of data) if (r.vs) out.add(String(r.vs).replace(/^0+/, ""));
    if (data.length < 1000) break;
  }
  return out;
}

async function zostavKontext(): Promise<Kontext> {
  const { data: ucty } = await supabaseAdmin.from("bank_accounts").select("iban, owner_name");
  const { data: nastavenia } = await supabaseAdmin
    .from("platform_settings")
    .select("transfer_iban, transfer_holder")
    .maybeSingle();

  const ibany = [...(ucty ?? []).map((u) => u.iban ?? ""), nastavenia?.transfer_iban ?? ""].filter(
    Boolean,
  );
  const nazvy = [
    ...(ucty ?? []).map((u) => u.owner_name ?? ""),
    nastavenia?.transfer_holder ?? "",
    "MaxiTicket s.r.o.",
    "MAXITICKET S.R.O",
  ].filter(Boolean);

  return { vlastneIbany: ibany, vlastneNazvy: nazvy, stareVs: await stareVs() };
}

/**
 * Prejde nespárované pohyby a tie, ktoré zjavne nepatria k vstupenkám,
 * prepne na `ignored` s dôvodom.
 */
export async function oznacMimoVstupeniek(limit = 500): Promise<VysledokOznacenia> {
  const v: VysledokOznacenia = { posudenych: 0, oznacenych: 0, podlaDovodu: {} };

  const { data: pohyby } = await supabaseAdmin
    .from("bank_transactions")
    .select(
      "id, amount, vs_normalized, counterparty_name, counterparty_iban, message, manual_change",
    )
    .eq("status", "needs_review")
    .is("matched_order_id", null)
    .limit(limit);

  if (!pohyby?.length) return v;
  const kontext = await zostavKontext();

  for (const p of pohyby) {
    // Čo posúdil človek, stroj neprepisuje.
    if (p.manual_change) continue;
    v.posudenych++;

    const z = zaradMimo(
      {
        amount: Number(p.amount),
        vs_normalized: p.vs_normalized,
        counterparty_name: p.counterparty_name,
        counterparty_iban: p.counterparty_iban,
        message: p.message,
      },
      kontext,
    );
    if (!z) continue;

    const { error } = await supabaseAdmin
      .from("bank_transactions")
      .update({
        status: "ignored",
        review_reason: z.dovod,
        note: z.popis,
        updated_at: new Date().toISOString(),
      })
      .eq("id", p.id);
    if (error) continue;

    v.oznacenych++;
    v.podlaDovodu[z.dovod] = (v.podlaDovodu[z.dovod] ?? 0) + 1;
  }

  return v;
}
