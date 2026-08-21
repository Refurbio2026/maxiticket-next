// Register platobných brán. Jediné miesto, kde sa rozhoduje, ktorá brána
// objednávku spracuje — všetko ostatné pracuje len s rozhraním PaymentGateway.
//
// Či je brána použiteľná, rozhodujú dve nezávislé veci:
//   1. prístupy v secrets (bez nich sa nedá zaplatiť),
//   2. prepínač v admine (`payment_settings`) — brána môže byť nastavená,
//      ale zámerne vypnutá.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { goPayGateway } from "./gopay.gateway.server";
import { gpWebpayGateway } from "./gpwebpay.server";
import { tatraPayPlusGateway } from "./tatrapayplus.server";
import type { GatewayId, PaymentGateway } from "./types";

const BRANY: Record<GatewayId, PaymentGateway> = {
  gopay: goPayGateway,
  gpwebpay: gpWebpayGateway,
  tatrapayplus: tatraPayPlusGateway,
};

export function vsetkyBrany(): PaymentGateway[] {
  return Object.values(BRANY);
}

export function branaPodlaId(id: string): PaymentGateway {
  const brana = BRANY[id as GatewayId];
  if (!brana) throw new Error(`Neznáma platobná brána '${id}'`);
  return brana;
}

/** Brány, ktoré majú vyplnené prístupy — bez ohľadu na prepínač v admine. */
export function dostupneBrany(): PaymentGateway[] {
  return vsetkyBrany().filter((b) => b.isConfigured());
}

export type NastaveniaBran = {
  zapnute: Record<GatewayId, boolean>;
  predvolena: GatewayId | null;
  updated_at: string | null;
};

/**
 * Nastavenia z databázy. Keď riadok chýba alebo sa nedá prečítať, správame sa,
 * akoby boli všetky brány zapnuté — výpadok tabuľky nesmie zastaviť predaj.
 */
export async function nacitajNastaveniaBran(): Promise<NastaveniaBran> {
  const predvolene: NastaveniaBran = {
    zapnute: { gopay: true, gpwebpay: true, tatrapayplus: true },
    predvolena: null,
    updated_at: null,
  };
  try {
    const { data } = await supabaseAdmin
      .from("payment_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (!data) return predvolene;
    return {
      zapnute: {
        gopay: data.gopay_enabled,
        gpwebpay: data.gpwebpay_enabled,
        tatrapayplus: data.tatrapayplus_enabled,
      },
      predvolena: (data.default_provider as GatewayId | null) ?? null,
      updated_at: data.updated_at,
    };
  } catch (e) {
    console.error("Nastavenia platobných brán sa nepodarilo načítať", e);
    return predvolene;
  }
}

/** Brány, ktoré sa smú ponúknuť zákazníkovi, aj s predvolenou. */
export async function branyPreZakaznika(): Promise<{
  brany: PaymentGateway[];
  predvolena: PaymentGateway | null;
}> {
  const nastavenia = await nacitajNastaveniaBran();
  const brany = dostupneBrany().filter((b) => nastavenia.zapnute[b.id]);

  // Poradie prednosti: nastavenie v admine → premenná PAYMENT_PROVIDER →
  // prvá použiteľná. Admin má prednosť, nech sa brána dá prepnúť bez zásahu
  // do servera.
  const zvolena = nastavenia.predvolena || process.env.PAYMENT_PROVIDER?.trim() || null;
  const predvolena = (zvolena && brany.find((b) => b.id === zvolena)) || brany[0] || null;
  return { brany, predvolena };
}

export type {
  GatewayId,
  PaymentGateway,
  PaymentState,
  PolozkaKonfiguracie,
  StartPaymentInput,
  TestBrany,
} from "./types";
