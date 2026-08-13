// Obsahové stránky verejného webu (O nás, obchodné podmienky, …).
//
// Nepublikovaná stránka na webe neexistuje — verejné funkcie ju nevrátia vôbec,
// aby sa rozpracovaný text nedal prečítať uhádnutím adresy.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SitePage = {
  id: string;
  slug: string;
  title: string;
  body: string;
  meta_description: string | null;
  published: boolean;
  show_in_footer: boolean;
  sort_order: number;
  updated_at: string;
};

/** Položka do pätičky — bez tela, to by sa do každej stránky ťahalo zbytočne. */
export type SitePageLink = { slug: string; title: string };

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

/** Odkazy do pätičky — len publikované a označené na zobrazenie. */
export const listFooterPages = createServerFn({ method: "POST" }).handler(
  async (): Promise<SitePageLink[]> => {
    const { data } = await supabaseAdmin
      .from("site_pages")
      .select("slug, title")
      .eq("published", true)
      .eq("show_in_footer", true)
      .order("sort_order", { ascending: true });
    return (data || []).map((p) => ({ slug: p.slug, title: p.title }));
  },
);

/** Verejný detail. Nepublikovaná stránka sa tvári, že neexistuje. */
export const getSitePage = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ slug: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }): Promise<SitePage | null> => {
    const { data: row } = await supabaseAdmin
      .from("site_pages")
      .select(
        "id, slug, title, body, meta_description, published, show_in_footer, sort_order, updated_at",
      )
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    return row ?? null;
  });

/** Zoznam pre admin — vrátane rozpracovaných. */
export const listSitePages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SitePage[]> => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("site_pages")
      .select(
        "id, slug, title, body, meta_description, published, show_in_footer, sort_order, updated_at",
      )
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  });

const PageInput = z.object({
  id: z.string().uuid().optional(),
  slug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9-]+$/, "Adresa smie obsahovať len malé písmená, číslice a pomlčky."),
  title: z.string().min(1).max(300),
  body: z.string().max(100000).default(""),
  meta_description: z.string().max(500).optional().nullable(),
  published: z.boolean().default(false),
  show_in_footer: z.boolean().default(true),
  sort_order: z.number().int().min(0).max(9999).default(100),
});

export type SitePageInput = z.input<typeof PageInput>;

export const upsertSitePage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PageInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await assertAdmin(context.userId);

    // Prázdnu stránku nepustíme na web — návštevník by našiel nadpis a nič pod ním.
    if (data.published && !data.body.trim()) {
      throw new Error("Prázdnu stránku nemá zmysel publikovať — najprv doplň text.");
    }

    const row = {
      slug: data.slug.trim(),
      title: data.title.trim(),
      body: data.body,
      meta_description: data.meta_description?.trim() || null,
      published: data.published,
      show_in_footer: data.show_in_footer,
      sort_order: data.sort_order,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await supabaseAdmin.from("site_pages").update(row).eq("id", data.id);
      if (error) throw new Error(friendly(error.message));
      return { id: data.id };
    }

    const { data: created, error } = await supabaseAdmin
      .from("site_pages")
      .insert(row)
      .select("id")
      .single();
    if (error || !created) throw new Error(friendly(error?.message || "Uloženie zlyhalo"));
    return { id: created.id };
  });

function friendly(message: string): string {
  if (message.includes("site_pages_slug_key")) return "Stránka s touto adresou už existuje.";
  return message;
}

export const deleteSitePage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("site_pages").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
