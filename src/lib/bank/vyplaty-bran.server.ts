// Odsúhlasenie výplat z platobnej brány.
//
// Brána drží peniaze za potvrdené platby a raz za čas pošle na účet súhrnnú
// výplatu. Doteraz sme vedeli len to, že nejaká prišla — nie, či sedí.
//
// Čo krok robí:
//   1. vypýta si od brány zoznam výplat za posledné dni,
//   2. ku každej si vyžiada rozpad na jednotlivé platby,
//   3. porovná ho s našou knihou platieb (účet typu `psp`),
//   4. k bankovému pohybu, ktorý výplate zodpovedá, dopíše, z čoho sa skladá.
//
// Rozdiel sa NEOPRAVUJE automaticky — zapíše sa ako chyba do `payment_logs`.
// Pri peniazoch je lepšie upozorniť človeka než ticho dorovnať číslo.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hodnota, pripravPristupy } from "../pristupy.server";
import {
  porovnaj,
  precitajRozpad,
  precitajVyplaty,
  type Vyplata,
} from "../payment-gateways/comgate-vyplaty";
import { errorMessage } from "../error-message";

const API = "https://payments.comgate.cz/v2.0";
const CAS_LIMIT_MS = 20_000;

export type VysledokVyplat = {
  vyplat: number;
  sediacich: number;
  nesediacich: number;
  bezPohybu: number;
  chyb: number;
  detail: string[];
};

async function volaj(cesta: string): Promise<unknown> {
  const merchant = hodnota("comgate", "COMGATE_MERCHANT");
  const secret = hodnota("comgate", "COMGATE_SECRET");
  if (!merchant || !secret) throw new Error("ComGate nemá vyplnené prístupy.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAS_LIMIT_MS);
  try {
    const r = await fetch(`${API}/${cesta}`, {
      headers: {
        accept: "application/json",
        Authorization: "Basic " + Buffer.from(`${merchant}:${secret}`).toString("base64"),
      },
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`ComGate odpovedal ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function den(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Naša kniha platieb brány: referencia → suma. */
async function nasaKniha(od: string): Promise<Map<string, number>> {
  const { data } = await supabaseAdmin
    .from("payments")
    .select("provider_payment_id, amount, status")
    .eq("provider", "comgate")
    .in("status", ["paid", "refunded"])
    .gte("created_at", od);

  const m = new Map<string, number>();
  for (const p of data ?? []) {
    if (!p.provider_payment_id) continue;
    m.set(p.provider_payment_id, (m.get(p.provider_payment_id) ?? 0) + Number(p.amount));
  }
  return m;
}

/** Bankový pohyb, ktorý výplate zodpovedá sumou a dátumom. */
async function najdiPohyb(v: Vyplata): Promise<{ id: string; note: string | null } | null> {
  if (v.suma == null || !v.datum) return null;
  const odD = new Date(`${v.datum}T00:00:00Z`);
  const od = new Date(odD.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  const doD = new Date(odD.getTime() + 5 * 86_400_000).toISOString().slice(0, 10);

  const { data } = await supabaseAdmin
    .from("bank_transactions")
    .select("id, amount, note, counterparty_name")
    .gte("value_date", od)
    .lte("value_date", doD)
    .ilike("counterparty_name", "%comgate%");

  // Tolerancia na cent: brána a banka zaokrúhľujú nezávisle.
  const sedi = (data ?? []).find((t) => Math.abs(Number(t.amount) - (v.suma ?? 0)) < 0.011);
  return sedi ? { id: sedi.id, note: sedi.note } : null;
}

export async function odsuhlasVyplaty(dni = 14): Promise<VysledokVyplat> {
  const v: VysledokVyplat = {
    vyplat: 0,
    sediacich: 0,
    nesediacich: 0,
    bezPohybu: 0,
    chyb: 0,
    detail: [],
  };
  await pripravPristupy();
  if (!hodnota("comgate", "COMGATE_MERCHANT")) return v;

  const kniha = await nasaKniha(new Date(Date.now() - (dni + 30) * 86_400_000).toISOString());

  for (let i = 0; i < dni; i++) {
    const d = new Date(Date.now() - i * 86_400_000);
    let vyplaty: Vyplata[];
    try {
      vyplaty = precitajVyplaty(await volaj(`transferList.json?date=${den(d)}`));
    } catch (e) {
      v.chyb++;
      v.detail.push(`${den(d)}: ${errorMessage(e)}`);
      continue;
    }

    for (const vyplata of vyplaty) {
      v.vyplat++;
      try {
        const rozpad = precitajRozpad(
          await volaj(`singleTransfer.json?transferId=${encodeURIComponent(vyplata.id)}`),
        );
        const p = porovnaj(rozpad, kniha);

        const pohyb = await najdiPohyb(vyplata);
        if (!pohyb) v.bezPohybu++;

        const zhrnutie =
          `Výplata ${vyplata.id} z ${vyplata.datum ?? "?"}: ${rozpad.length} platieb, ` +
          `brána ${p.suctyBrany} €, naša kniha ${p.suctyNase} €` +
          (p.chybajuNam.length ? `, chýbajú nám: ${p.chybajuNam.join(", ")}` : "");

        if (Math.abs(p.rozdiel) < 0.011 && !p.chybajuNam.length) {
          v.sediacich++;
          if (pohyb && pohyb.note !== zhrnutie) {
            await supabaseAdmin
              .from("bank_transactions")
              .update({ note: zhrnutie })
              .eq("id", pohyb.id);
          }
        } else {
          v.nesediacich++;
          v.detail.push(zhrnutie);
          await supabaseAdmin.from("payment_logs").insert({
            provider: "comgate",
            endpoint: `vyplata:${vyplata.id}`,
            response_payload: { rozpad: rozpad.length, ...p },
            status: "error",
            error_message: zhrnutie,
          });
          if (pohyb) {
            await supabaseAdmin
              .from("bank_transactions")
              .update({ note: `NESEDÍ — ${zhrnutie}`, status: "needs_review" })
              .eq("id", pohyb.id);
          }
        }
      } catch (e) {
        v.chyb++;
        v.detail.push(`výplata ${vyplata.id}: ${errorMessage(e)}`);
      }
    }
  }

  return v;
}
