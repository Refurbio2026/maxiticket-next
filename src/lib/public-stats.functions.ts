// Skutočné čísla pre verejný web.
//
// Prečo to vzniklo: na titulke boli napísané naprdlo údaje, ktoré nesedeli
// s realitou — „1.2M+ predaných vstupeniek" pri 1 013 v databáze, počty
// podujatí po mestách (Bratislava 842) a po kategóriách (koncerty 1 240).
// Takéto číslo nikto neudržiava a prvý zákazník, ktorý si to overí, stratí
// dôveru v celý web.
//
// Všetko nižšie sa počíta z databázy. Keď je niečo nula, web to nemá
// zobrazovať vôbec — radšej menej než vymyslené.
import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type VerejneStatistiky = {
  /** Vydané vstupenky — vrátane prenesených zo starého systému. */
  vstupeniek: number;
  /** Zverejnené podujatia, ktoré ešte neboli. */
  vPredaji: number;
  /** Mestá s aspoň jedným budúcim podujatím, od najväčšieho. */
  mesta: Array<{ nazov: string; pocet: number }>;
  /** Kategórie s aspoň jedným budúcim podujatím. */
  kategorie: Array<{ slug: string; pocet: number }>;
};

const PRAZDNE: VerejneStatistiky = { vstupeniek: 0, vPredaji: 0, mesta: [], kategorie: [] };

export const getPublicStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<VerejneStatistiky> => {
    try {
      const dnes = new Date().toISOString().slice(0, 10);

      const [vstupenky, podujatia] = await Promise.all([
        supabaseAdmin.from("tickets").select("id", { count: "exact", head: true }),
        supabaseAdmin
          .from("events")
          .select("city, category")
          .eq("status", "published")
          .is("cancelled_at", null)
          .gte("event_date", dnes),
      ]);

      const zoznam = podujatia.data ?? [];

      const spocitaj = (kluc: "city" | "category") => {
        const mapa = new Map<string, number>();
        for (const e of zoznam) {
          const v = (e[kluc] ?? "").trim();
          if (!v) continue;
          mapa.set(v, (mapa.get(v) ?? 0) + 1);
        }
        return [...mapa.entries()]
          .map(([nazov, pocet]) => ({ nazov, pocet }))
          .sort((a, b) => b.pocet - a.pocet || a.nazov.localeCompare(b.nazov, "sk"));
      };

      return {
        vstupeniek: vstupenky.count ?? 0,
        vPredaji: zoznam.length,
        mesta: spocitaj("city"),
        kategorie: spocitaj("category").map((x) => ({ slug: x.nazov, pocet: x.pocet })),
      };
    } catch (e) {
      // Výpadok štatistík nesmie zhodiť titulku — web ukáže menej, nie chybu.
      console.error("Verejné štatistiky sa nepodarilo načítať", e);
      return PRAZDNE;
    }
  },
);

/** Číslo pre zákazníka: `1 013`, nie `1013`. */
export function cislo(n: number): string {
  return n.toLocaleString("sk-SK");
}
