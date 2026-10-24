// Živé fakty pre asistenta: čo sa práve predáva a za akých podmienok.
//
// Statické znalosti sú v `temy.ts`. Tu sa k nim pridáva to, čo sa mení —
// najbližšie podujatia, mestá, provízia. Bez toho by asistent na otázku
// „čo hráte v Pezinku" odpovedal všeobecne, hoci odpoveď je v databáze.
//
// Čo sa sem NESMIE dostať: údaje konkrétnej objednávky alebo zákazníka.
// Widget je verejný, takže všetko odtiaľto môže čítať ktokoľvek.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PREVADZKOVATEL } from "@/lib/kontakt";
import { nazovKategorie } from "@/lib/kategorie";
import { znalostiText } from "./temy";

type Zaznam = { text: string; nacitane: number };
let cache: Zaznam | null = null;
/** Ponuka sa mení po minútach, nie po sekundách — databázu netreba budiť. */
const PLATNOST_MS = 5 * 60_000;

function datum(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("sk-SK", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

async function zostav(): Promise<string> {
  const dnes = new Date().toISOString().slice(0, 10);
  const [podujatia, nastavenia] = await Promise.all([
    supabaseAdmin
      .from("events")
      .select("id, title, event_date, event_time, city, venue, category, base_price")
      .eq("status", "published")
      .is("cancelled_at", null)
      .gte("event_date", dnes)
      .order("event_date", { ascending: true })
      .limit(25),
    supabaseAdmin.from("platform_settings").select("default_commission_rate").maybeSingle(),
  ]);

  const zoznam = podujatia.data ?? [];
  const riadky = zoznam.map((e) => {
    const cena =
      typeof e.base_price === "number" && Number.isFinite(e.base_price)
        ? `od ${e.base_price.toFixed(2).replace(".", ",")} €`
        : "cena podľa typu vstupenky";
    const kde = [e.venue, e.city].filter(Boolean).join(", ");
    return `- ${e.title} — ${datum(e.event_date)}${e.event_time ? ` o ${e.event_time.slice(0, 5)}` : ""}, ${kde}, ${nazovKategorie(e.category)}, ${cena}. Stránka: /events/${e.id}`;
  });

  const provizia = Number(nastavenia.data?.default_commission_rate ?? 10);

  return [
    znalostiText(),
    "",
    "PREVÁDZKOVATEĽ",
    `${PREVADZKOVATEL.nazov}, ${PREVADZKOVATEL.ulica}, ${PREVADZKOVATEL.psc} ${PREVADZKOVATEL.mesto}, IČO ${PREVADZKOVATEL.ico}. E-mail ${PREVADZKOVATEL.email}, telefón ${PREVADZKOVATEL.telefon}.`,
    "",
    "PROVÍZIA PRE ORGANIZÁTOROV",
    `Štandardne ${provizia} % z ceny predanej vstupenky, bez mesačných poplatkov.`,
    "",
    riadky.length
      ? `PODUJATIA PRÁVE V PREDAJI (${zoznam.length}, od najbližšieho)\n${riadky.join("\n")}`
      : "PODUJATIA PRÁVE V PREDAJI\nMomentálne nie je v predaji žiadne podujatie. Nevymýšľaj si žiadne — povedz to priamo.",
  ].join("\n");
}

/** Znalosti pre systémovú správu. Pri výpadku databázy aspoň tie statické. */
export async function zostavZnalosti(): Promise<string> {
  if (cache && Date.now() - cache.nacitane < PLATNOST_MS) return cache.text;
  try {
    const text = await zostav();
    cache = { text, nacitane: Date.now() };
    return text;
  } catch (e) {
    console.error("Znalosti asistenta sa nepodarilo zostaviť", e);
    return cache?.text ?? znalostiText();
  }
}

export function zabudniZnalosti(): void {
  cache = null;
}

/**
 * Čo má návštevník otvorené.
 *
 * Bez tohto sa otázka „o koľkej to začína" nedá zodpovedať — asistent
 * nevie, čo je to „to". Načítava sa len verejné podujatie; z adresy sa
 * nič iné nečíta.
 */
export async function kontextStranky(cesta: string | undefined): Promise<string | null> {
  if (!cesta) return null;

  const podujatie = cesta.match(/^\/events\/([0-9a-f-]{36})/i);
  if (podujatie) {
    const { data } = await supabaseAdmin
      .from("events")
      .select("title, event_date, event_time, city, venue, base_price, status")
      .eq("id", podujatie[1])
      .maybeSingle();
    if (data && data.status === "published") {
      const kde = [data.venue, data.city].filter(Boolean).join(", ");
      return `Návštevník má otvorené podujatie „${data.title}" — ${datum(data.event_date)}${data.event_time ? ` o ${data.event_time.slice(0, 5)}` : ""}, ${kde}. Keď sa pýta „na toto podujatie" alebo „kedy to začína", myslí práve toto.`;
    }
  }

  const kde: Record<string, string> = {
    "/events": "Návštevník si prezerá zoznam podujatí.",
    "/account": "Návštevník je vo svojom účte (Moje vstupenky).",
    "/contact": "Návštevník je na kontaktnej stránke.",
    "/support": "Návštevník je na stránke podpory.",
    "/onboarding": "Návštevník vypĺňa registráciu organizátora.",
    "/partners": "Návštevník číta stránku o spolupráci — zrejme chce predávať vstupenky.",
  };
  for (const [prefix, popis] of Object.entries(kde)) {
    if (cesta === prefix || cesta.startsWith(`${prefix}/`)) return popis;
  }
  if (cesta.startsWith("/checkout")) {
    return "Návštevník je v pokladni a práve dokončuje nákup — odpovedaj stručne a nezdržuj ho.";
  }
  return null;
}
