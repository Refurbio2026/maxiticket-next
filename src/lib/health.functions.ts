// Prehľad prevádzky: čo sa za posledné dni pokazilo a či beží, čo bežať má.
//
// Chyby sa doteraz zapisovali do payment_logs, superfaktura_logs a email_logs,
// ale nebolo miesto, kde ich vidieť pokope. Keď sa v noci pokazí platba,
// nikto sa to nedozvedel.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { objednavkySVstupenkou } from "./tickets-by-order.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

export type Zavada = {
  /** `chyba` treba riešiť, `pozor` je len upozornenie. */
  uroven: "chyba" | "pozor";
  nazov: string;
  detail: string;
  pocet: number;
};

export type PrehladPrevadzky = {
  odKedy: string;
  zavady: Zavada[];
  /** Naposledy zbehnutý dopytovací sken; `null` = nikdy, teda cron nebeží. */
  skenNaposledy: string | null;
  posledneChyby: Array<{
    kedy: string;
    zdroj: string;
    sprava: string;
    order_id: string | null;
  }>;
};

export const getOperationsHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ hours: z.number().min(1).max(720).default(72) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<PrehladPrevadzky> => {
    await assertAdmin(context.userId);
    const od = new Date(Date.now() - data.hours * 3600_000).toISOString();
    const zavady: Zavada[] = [];

    const spocitaj = async (
      tabulka: "payment_logs" | "superfaktura_logs" | "email_logs",
    ): Promise<number> => {
      const { count } = await supabaseAdmin
        .from(tabulka)
        .select("id", { count: "exact", head: true })
        .eq("status", "error")
        .gte("created_at", od);
      return count ?? 0;
    };

    const [platby, faktury, maily] = await Promise.all([
      spocitaj("payment_logs"),
      spocitaj("superfaktura_logs"),
      spocitaj("email_logs"),
    ]);
    if (platby > 0) {
      zavady.push({
        uroven: "chyba",
        nazov: "Zlyhania pri platbách",
        detail: "Pozri zoznam nižšie — môže ísť o neúspešné vytvorenie platby alebo refundu.",
        pocet: platby,
      });
    }
    if (faktury > 0) {
      zavady.push({
        uroven: "chyba",
        nazov: "Nevystavené faktúry",
        detail: "Objednávka je zaplatená, ale faktúra sa nevystavila. Dá sa vystaviť znovu.",
        pocet: faktury,
      });
    }
    if (maily > 0) {
      zavady.push({
        uroven: "chyba",
        nazov: "Neodoslané e-maily",
        detail: "Zákazník nedostal vstupenky ani oznam. E-mail sa dá poslať znovu.",
        pocet: maily,
      });
    }

    // Duplicitná platba znamená, že niekomu treba vrátiť peniaze.
    const { count: duplicitne } = await supabaseAdmin
      .from("payment_logs")
      .select("id", { count: "exact", head: true })
      .like("endpoint", "duplicitna_platba%")
      .gte("created_at", od);
    if ((duplicitne ?? 0) > 0) {
      zavady.push({
        uroven: "chyba",
        nazov: "Prijaté dve platby za jednu objednávku",
        detail: "Druhú platbu treba zákazníkovi vrátiť.",
        pocet: duplicitne ?? 0,
      });
    }

    // Zaplatené bez vstupeniek by mal dorobiť sken; keď tu niečo visí, sken nebeží.
    //
    // Zámerne to nie je dotaz na objednávku. Táto stránka sa sama obnovuje
    // každú minútu a pri rušnom víkende by to bolo päťsto dotazov za sebou
    // zakaždým. Namiesto toho sa vstupenky načítajú po dávkach a porovnajú.
    const { data: zaplatene } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("status", "paid")
      .gte("created_at", od)
      .limit(500);
    const idcka = (zaplatene || []).map((o) => o.id);
    const sVstupenkou = await objednavkySVstupenkou(idcka);
    const bezVstupeniek = idcka.filter((id) => !sVstupenkou.has(id)).length;
    if (bezVstupeniek > 0) {
      zavady.push({
        uroven: "chyba",
        nazov: "Zaplatené objednávky bez vstupeniek",
        detail: "Dopytovací sken ich má dorobiť. Ak tu visia, pravdepodobne nebeží.",
        pocet: bezVstupeniek,
      });
    }

    // Rozrobené platby staršie než pár hodín znamenajú, že sa výsledok nedoťahuje.
    const { count: visiace } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "awaiting_payment")
      .not("payment_ref", "is", null)
      .lt("created_at", new Date(Date.now() - 6 * 3600_000).toISOString());
    if ((visiace ?? 0) > 0) {
      zavady.push({
        uroven: "pozor",
        nazov: "Platby čakajúce viac než šesť hodín",
        detail: "Buď ich zákazníci nedokončili, alebo sa stav nedoťahuje.",
        pocet: visiace ?? 0,
      });
    }

    const { data: sken } = await supabaseAdmin
      .from("system_heartbeats")
      .select("last_at")
      .eq("name", "reconcile")
      .maybeSingle();
    const skenNaposledy = sken?.last_at ?? null;
    if (!skenNaposledy) {
      zavady.push({
        uroven: "pozor",
        nazov: "Dopytovací sken ešte nebežal",
        detail:
          "GP webpay ani tatrapay+ nemajú notifikáciu, takže bez cronu ostane bez vstupeniek " +
          "každý, kto po zaplatení zavrie okno.",
        pocet: 0,
      });
    } else if (Date.now() - new Date(skenNaposledy).getTime() > 6 * 3600_000) {
      zavady.push({
        uroven: "chyba",
        nazov: "Dopytovací sken dlho nebežal",
        detail: `Naposledy ${new Date(skenNaposledy).toLocaleString("sk")}. Skontroluj cron.`,
        pocet: 0,
      });
    }

    // Posledné konkrétne chyby, nech sa nemusí hľadať v logoch servera.
    const posledne: PrehladPrevadzky["posledneChyby"] = [];
    const zdroje = [
      { t: "payment_logs" as const, nazov: "platba" },
      { t: "superfaktura_logs" as const, nazov: "faktúra" },
      { t: "email_logs" as const, nazov: "e-mail" },
    ];
    for (const z of zdroje) {
      const { data } = await supabaseAdmin
        .from(z.t)
        .select("created_at, error_message, order_id")
        .eq("status", "error")
        .gte("created_at", od)
        .order("created_at", { ascending: false })
        .limit(10);
      for (const r of data || []) {
        posledne.push({
          kedy: r.created_at,
          zdroj: z.nazov,
          sprava: (r.error_message || "").slice(0, 300),
          order_id: r.order_id ?? null,
        });
      }
    }
    posledne.sort((a, b) => b.kedy.localeCompare(a.kedy));

    return { odKedy: od, zavady, skenNaposledy, posledneChyby: posledne.slice(0, 20) };
  });
