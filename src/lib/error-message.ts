/**
 * Text chyby z čohokoľvek, čo sa dá vyhodiť.
 *
 * `catch` dáva `unknown` — vyhodiť sa dá aj reťazec alebo obyčajný objekt, nie
 * len `Error`. Toto je jedno miesto, kde sa z toho vyrobí text do hlášky
 * zákazníkovi alebo do `payment_logs`, nech to nerobí každý catch po svojom.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const sprava = (e as { message?: unknown }).message;
    if (typeof sprava === "string") return sprava;
  }
  return String(e);
}
