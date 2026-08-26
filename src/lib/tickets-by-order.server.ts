// Ktoré z daných objednávok už majú vydanú vstupenku.
//
// Prehľad prevádzky aj dopytovací sken hľadajú to isté: zaplatené objednávky,
// ktorým vstupenky nikdy nevznikli. Pýtať sa na to objednávku po objednávke
// znamená stovky dotazov za sebou, takže sa to pýta hromadne.
//
// Dávka je zámerne malá: `in()` sa v PostgREST prenáša v URL a päťsto UUID by
// ju predĺžilo na devätnásť kilobajtov, čo server odmietne.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DAVKA = 100;

export async function objednavkySVstupenkou(orderIds: string[]): Promise<Set<string>> {
  const maju = new Set<string>();
  for (let i = 0; i < orderIds.length; i += DAVKA) {
    const davka = orderIds.slice(i, i + DAVKA);
    if (davka.length === 0) continue;
    const { data, error } = await supabaseAdmin
      .from("tickets")
      .select("order_id")
      .in("order_id", davka);
    if (error) throw new Error(error.message);
    for (const t of data || []) {
      if (t.order_id) maju.add(t.order_id);
    }
  }
  return maju;
}
