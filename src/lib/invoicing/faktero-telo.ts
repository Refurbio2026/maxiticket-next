// Telá požiadaviek pre Faktero — čisté, aby sa dali otestovať.
//
// Vytiahnuté z `faktero.server.ts`, kde boli zamiešané medzi volania API.
// Fakturácia je peňažná cesta a stála doteraz bez jediného testu; pritom
// chyba v sadzbe DPH alebo v splatnosti sa neprejaví chybou, ale nesprávnou
// faktúrou, ktorú niekto objaví o mesiace.
//
// Dátumy sa sem posielajú ako text, nie počítajú vnútri — inak by test
// závisel od toho, kedy beží.
import type { FakturaVstup, FakturaZakaznik } from "./types";

/** `zaklad` sú zdokumentované polia, `navyse` tie, ktoré API nemusí poznať. */
export type Telo = { zaklad: Record<string, unknown>; navyse: Record<string, unknown> };

/**
 * Odberateľ. Keď kupujúci uviedol firmu, na faktúre je odberateľom firma
 * a jeho meno ide do kontaktnej osoby — nie naopak.
 *
 * Prázdne polia sa **vynechávajú**, neposielajú sa ako prázdny text: Faktero
 * by si inak prepísalo údaje firmy prázdnom.
 */
export function teloOdberatela(customer: FakturaZakaznik, orderId: string): Telo {
  const firma = customer.company;
  const nepovinne = (kluc: string, hodnota?: string | null) =>
    hodnota && String(hodnota).trim() ? { [kluc]: hodnota } : {};

  return {
    zaklad: {
      name: firma?.name || customer.name || "Zákazník",
      email: customer.email || "",
      ...nepovinne("ico", firma?.ico),
      ...nepovinne("ic_dph", firma?.ic_dph),
      ...nepovinne("street", firma?.street),
      ...nepovinne("city", firma?.city),
      ...nepovinne("zip", firma?.zip),
      ...nepovinne("country", firma?.country),
    },
    navyse: {
      ...nepovinne("phone", customer.phone),
      ...nepovinne("dic", firma?.dic),
      ...(firma ? { contact_person: customer.name } : {}),
      external_id: orderId,
    },
  };
}

/**
 * Faktúra. Zaplatené vstupenky majú splatnosť v deň vystavenia; faktúra, ktorá
 * ešte zaplatená nie je (provízia organizátorovi), má lehotu.
 */
export function teloFaktury(args: {
  customerId: string;
  input: FakturaVstup;
  dnes: string;
  splatnostNezaplatene: string;
}): Telo {
  const { customerId, input, dnes, splatnostNezaplatene } = args;
  const zaplatene = input.alreadyPaid !== false;

  return {
    zaklad: {
      customer_id: customerId,
      issue_date: dnes,
      due_date: zaplatene ? dnes : splatnostNezaplatene,
      currency: "EUR",
      items: input.items.map((it) => ({
        name: it.name,
        quantity: it.quantity,
        unit: "ks",
        unit_price: it.unit_price,
        // Sadzba ide z položky, nie z predvolenej hodnoty platformy —
        // divadlo má 5 %, koncert 23 % a na jednej faktúre môžu byť obe.
        vat_rate: it.tax,
      })),
    },
    navyse: {
      variable_symbol: input.variableSymbol,
      order_number: input.variableSymbol,
      external_id: input.orderId,
      payment_method: input.paymentType || "card",
      notes: input.name || `Vstupenky – objednávka ${input.variableSymbol}`,
    },
  };
}
