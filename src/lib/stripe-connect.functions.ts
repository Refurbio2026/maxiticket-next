// Serverové funkcie pre nastavenie výplat organizátora cez Stripe Connect.
//
// Organizátor si cez ne založí Express účet a dostane odkaz na dokončenie
// registrácie u Stripe. Admin to isté vie spraviť za ktoréhokoľvek
// organizátora — stáva sa, že si človek s formulárom neporadí.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  odkazNaOnboarding,
  stavOrganizatora,
  zosynchronizujUcet,
  type StavOrganizatora,
} from "./stripe-connect.server";
import { stripeGateway } from "./payment-gateways/stripe.gateway.server";
import { pripravPristupy } from "./pristupy.server";

export type StavVyplat = StavOrganizatora & {
  /** Je Stripe vôbec nastavený na platforme? Bez kľúčov nemá zmysel nič ponúkať. */
  branaNastavena: boolean;
  /** `test` upozorní, že sa registruje do testovacieho prostredia Stripe. */
  rezim: "test" | "ostrá" | "neznáma";
  /** Môže organizátor výplaty nastavovať? Pred schválením nie. */
  smieNastavovat: boolean;
};

async function maRolu(userId: string, rola: "admin"): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", rola)
    .maybeSingle();
  return !!data;
}

/**
 * Koho účtu sa to týka.
 *
 * Organizátor smie len svoj; admin ktorýkoľvek. Bez tejto kontroly by si
 * organizátor vedel vyžiadať odkaz na cudzí účet.
 */
async function komu(userId: string, ziadany?: string | null): Promise<string> {
  if (!ziadany || ziadany === userId) return userId;
  if (await maRolu(userId, "admin")) return ziadany;
  throw new Error("Na nastavenie výplat cudzieho organizátora nemáš právo.");
}

const vstupOrganizatora = (input: unknown) =>
  z.object({ organizerId: z.string().uuid().optional().nullable() }).parse(input ?? {});

/** Stav výplat — čo zobraziť organizátorovi. */
export const getStavVyplat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(vstupOrganizatora)
  .handler(async ({ data, context }): Promise<StavVyplat> => {
    await pripravPristupy();
    const id = await komu(context.userId, data.organizerId);

    const { data: profil } = await supabaseAdmin
      .from("profiles")
      .select("organizer_status")
      .eq("id", id)
      .maybeSingle();

    return {
      ...(await stavOrganizatora(id)),
      branaNastavena: stripeGateway.isConfigured(),
      rezim: stripeGateway.rezim?.() ?? "neznáma",
      smieNastavovat: profil?.organizer_status === "approved",
    };
  });

/**
 * Odkaz na dokončenie registrácie u Stripe.
 *
 * Odkaz je jednorazový a krátko platný, preto sa negeneruje dopredu ani sa
 * neukladá — vracia sa až na kliknutie.
 */
export const zacniNastavenieVyplat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(vstupOrganizatora)
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    await pripravPristupy();
    if (!stripeGateway.isConfigured()) {
      throw new Error("Stripe nie je na platforme nastavený — chýba tajný kľúč.");
    }
    const id = await komu(context.userId, data.organizerId);
    return { url: await odkazNaOnboarding(id) };
  });

/**
 * Dopýta sa Stripe na aktuálny stav účtu.
 *
 * Volá sa po návrate z onboardingu, aby organizátor videl výsledok hneď
 * a nečakal na `account.updated`; zároveň sa tým dá dobehnúť zmeškaný
 * webhook.
 */
export const obnovStavVyplat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(vstupOrganizatora)
  .handler(async ({ data, context }): Promise<StavVyplat> => {
    await pripravPristupy();
    const id = await komu(context.userId, data.organizerId);
    const stav = await zosynchronizujUcet(id);

    const { data: profil } = await supabaseAdmin
      .from("profiles")
      .select("organizer_status")
      .eq("id", id)
      .maybeSingle();

    return {
      ...stav,
      branaNastavena: stripeGateway.isConfigured(),
      rezim: stripeGateway.rezim?.() ?? "neznáma",
      smieNastavovat: profil?.organizer_status === "approved",
    };
  });
