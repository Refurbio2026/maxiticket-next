// PIN pokladníka — hashovanie a overenie.
//
// Štvorciferný PIN má 10 000 možností, takže obyčajný SHA-256 by sa dal
// prelúskať hotovou tabuľkou. Preto ho podpisujeme tajomstvom aplikácie
// (rovnakým, akým sa podpisujú QR vstupenky) a overujeme v konštantnom čase.
//
// Oddelené od `pos.functions.ts` zámerne: ten modul ťahá serverového Supabase
// klienta, takže sa nedá načítať v teste. Toto je autentifikácia na pokladni —
// patrí sa jej mať testy.
import crypto from "node:crypto";

function pinSecret(): string {
  const secret = process.env.TICKET_QR_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Chýba TICKET_QR_SECRET — PIN sa nedá bezpečne uložiť.");
  return secret;
}

/** Odtlačok PIN-u. Do hashu ide aj id pokladníka, takže dvaja s rovnakým PIN-om majú iný. */
export function hashPin(cashierId: string, pin: string): string {
  return crypto.createHmac("sha256", pinSecret()).update(`${cashierId}:${pin}`).digest("hex");
}

/**
 * Porovnanie v konštantnom čase. Bežné `===` skončí na prvom odlišnom znaku,
 * takže z dĺžky odpovede sa dá odtlačok uhádnuť znak po znaku.
 */
export function pinMatches(cashierId: string, pin: string, hash: string): boolean {
  const candidate = Buffer.from(hashPin(cashierId, pin));
  const stored = Buffer.from(hash);
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}
