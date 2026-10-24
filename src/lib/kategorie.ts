// Názvy kategórií podujatí pre zákazníka.
//
// V databáze je `events.category` krátky kľúč (`kultura`, `stand-up`).
// Zákazníkovi sa ukazuje názov odtiaľto. Kľúč, ktorý tu ešte nie je, sa
// zobrazí tak, ako je — s veľkým prvým písmenom. Nikdy sa nezahadzuje:
// radšej „Kultura" než zmiznuté podujatie.

/** Kľúč z databázy → názov pre zákazníka. */
export const NAZVY_KATEGORII: Record<string, string> = {
  koncert: "Koncerty",
  festival: "Festivaly",
  sport: "Šport",
  divadlo: "Divadlo",
  "stand-up": "Stand-up",
  konferencia: "Konferencie",
  workshop: "Workshopy",
  kultura: "Kultúra",
  kino: "Kino",
  vystava: "Výstavy",
  ostatne: "Ostatné",
};

/** Názov kategórie v množnom čísle („Koncerty") — na dlaždice a filtre. */
export function nazovKategorie(slug: string): string {
  return (
    NAZVY_KATEGORII[slug] ?? (slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : "Podujatie")
  );
}

/** Jedno podujatie danej kategórie („Koncert") — na odznak na karte. */
export function odznakKategorie(slug: string): string {
  const mnozne = nazovKategorie(slug);
  // „Koncerty" → „Koncert", „Festivaly" → „Festival", „Výstavy" → „Výstava".
  if (mnozne.endsWith("y")) return mnozne.slice(0, -1);
  return mnozne;
}
