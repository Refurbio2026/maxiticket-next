// Nahrávanie obrázka podujatia do Supabase Storage.
//
// Doteraz sa dal zadať len odkaz na cudzí web — obrázok tak zmizol, keď ho
// zdroj zmazal, a organizátor musel mať súbor kam najprv nahrať. Bucket
// `event-images` je verejný na čítanie (obrázok visí na verejnom katalógu,
// v e-mailoch aj v PDF), zapisuje doň výhradne táto funkcia service-role
// kľúčom — klient sa k storage nedostane.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "event-images";

/** Musí sedieť s `allowed_mime_types` bucketu v migrácii. */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** 5 MB, rovnako ako `file_size_limit` bucketu. */
const MAX_BYTES = 5 * 1024 * 1024;

export const uploadEventImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        content_type: z.string().min(1).max(120),
        // base64 bez dátovej hlavičky; 5 MB binárne je ~6,7 MB textu.
        base64: z.string().min(1).max(7_500_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    // Obrázky smie nahrávať len ten, kto zakladá podujatia. Bez tejto kontroly
    // by hociktorý prihlásený návštevník mal zadarmo úložisko.
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .in("role", ["organizer", "admin"])
      .maybeSingle();
    if (!role) throw new Error("Forbidden: vyžaduje sa rola organizátor alebo admin");

    const ext = EXTENSIONS[data.content_type];
    if (!ext) throw new Error("Podporujeme JPG, PNG, WEBP, GIF a AVIF.");

    const bytes = Buffer.from(data.base64, "base64");
    if (bytes.length === 0) throw new Error("Súbor je prázdny.");
    if (bytes.length > MAX_BYTES) throw new Error("Obrázok má viac ako 5 MB.");

    // Cesta začína id používateľa — v Storage je tak vidno, komu súbor patrí,
    // a náhodné meno bráni tomu, aby si dvaja prepísali obrázok navzájom.
    const path = `${context.userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
      contentType: data.content_type,
      // Meno je náhodné, takže sa obsah na danej ceste už nikdy nezmení.
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw new Error(error.message);

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    return { url: pub.publicUrl };
  });
