// Verejná adresa webu.
//
// Skladajú sa z nej všetky odkazy, ktoré opúšťajú server: návrat zákazníka
// z platobnej brány, NOTIFIKAČNÁ adresa, na ktorú GoPay hlási zaplatenie,
// a odkaz na vstupenky v potvrdzovacom e-maile.
//
// Predtým mal každý z týchto modulov vlastnú natvrdo zapísanú zálohu a tie si
// navzájom odporovali — platby ukazovali na dávno mŕtvu vývojovú adresu.
// Dôsledok by sa prejavil až pri prvej ostrej platbe: webhook by nedorazil,
// objednávka by neprešla na zaplatenú, vstupenky by sa nevydali a sedadlo by
// sa po pätnástich minútach uvoľnilo. Peniaze inkasované, zákazník bez lístka.
//
// Preto tu žiadna záloha nie je. Chýbajúca konfigurácia má spadnúť hneď
// a nahlas, nie potichu poslať peniaze do prázdna.

/** Adresa webu bez lomky na konci. Vyhodí chybu, ak nie je nastavená. */
export function siteUrl(): string {
  const fromEnv = process.env.PUBLIC_SITE_URL || process.env.SITE_URL;
  if (!fromEnv || !fromEnv.trim()) {
    throw new Error(
      "Chýba PUBLIC_SITE_URL (alebo SITE_URL). Bez nej by GoPay poslal zákazníka " +
        "aj notifikáciu o zaplatení na cudziu adresu a objednávka by nikdy " +
        "neprešla na zaplatenú.",
    );
  }
  return fromEnv.trim().replace(/\/+$/, "");
}
