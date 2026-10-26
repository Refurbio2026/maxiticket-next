// Zásielky na podaj — admin.
//
// PREČO: objednávka s doručením poštou je záväzok, ktorý sa nesplní sám.
// Niekto musí vytlačiť vstupenky, zalepiť obálku a odniesť ju na poštu.
// Tento zoznam je ten „niekto" na strane systému: ukáže, čo čaká, zlúči to
// do jedného ePodacieho hárku a po podaji si od pošty vyžiada podacie čísla.
//
// Hárok sa posiela cez SOAP rozhranie pošty (`eph.server.ts`). Pošta vráti
// číslo hárku; podacie čísla zásielok sú známe až po spracovaní, preto sa
// dopytujú zvlášť.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pripravPristupy } from "@/lib/pristupy.server";
import { ChybaPosty, ephStav, harok, importujHarok, odosielatel } from "./eph.server";
import type { ZasielkaEph } from "./eph-soap";

export type ZasielkaRiadok = {
  order_id: string;
  created_at: string;
  paid_at: string | null;
  customer_name: string | null;
  customer_email: string | null;
  event_title: string | null;
  pocet_vstupeniek: number;
  delivery_fee: number;
  adresa: {
    meno: string | null;
    ulica: string | null;
    mesto: string | null;
    psc: string | null;
  };
  eph_sheet_id: string | null;
  eph_code: string | null;
  posted_at: string | null;
};

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: vyžaduje sa rola admin");
}

/**
 * Zoznam zásielok. Predvolene tie, čo čakajú na podaj — to je otázka, ktorú
 * si človek kladie každé ráno. `podane: true` ukáže naopak odoslané, aby sa
 * dalo dohľadať podacie číslo, keď sa zákazník ozve.
 */
export const listZasielky = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        podane: z.boolean().default(false),
        limit: z.number().int().positive().max(500).default(200),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    let q = supabaseAdmin
      .from("orders")
      // Jeden reťazec, nie zlepený: supabase-js si z literálu odvodzuje typy.
      .select(
        "id, created_at, paid_at, customer_name, customer_email, delivery_fee, delivery_name, delivery_street, delivery_city, delivery_zip, eph_sheet_id, eph_code, posted_at, events(title), order_items(quantity)",
      )
      .eq("delivery_method", "posta")
      // Nezaplatená objednávka sa neposiela. Toto je jediná podmienka, ktorá
      // tu musí byť železná — obálka odoslaná pred zaplatením sa nevráti.
      .eq("status", "paid")
      .order("paid_at", { ascending: true })
      .limit(data.limit);

    q = data.podane ? q.not("posted_at", "is", null) : q.is("posted_at", null);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const riadky: ZasielkaRiadok[] = (rows || []).map((r) => {
      const polozky = (r.order_items as Array<{ quantity: number | null }> | null) || [];
      return {
        order_id: r.id,
        created_at: r.created_at,
        paid_at: r.paid_at,
        customer_name: r.customer_name,
        customer_email: r.customer_email,
        event_title: (r.events as { title: string } | null)?.title ?? null,
        pocet_vstupeniek: polozky.reduce((s, p) => s + (p.quantity || 1), 0),
        delivery_fee: Number(r.delivery_fee ?? 0),
        adresa: {
          meno: r.delivery_name,
          ulica: r.delivery_street,
          mesto: r.delivery_city,
          psc: r.delivery_zip,
        },
        eph_sheet_id: r.eph_sheet_id,
        eph_code: r.eph_code,
        posted_at: r.posted_at,
      };
    });
    return { riadky, posta: ephStav() };
  });

/**
 * Zlúči vybrané objednávky do jedného ePodacieho hárku a pošle ho pošte.
 *
 * `posted_at` sa zapíše až po tom, čo pošta hárok prijme. Opačné poradie by
 * pri chybe nechalo objednávku označenú ako podanú — a tá by z frontu zmizla
 * bez toho, aby obálka kedykoľvek odišla.
 */
export const vytvorHarok = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        order_ids: z.array(z.string().uuid()).min(1).max(200),
        /** Nasucho: poskladá hárok a vráti, čo by odišlo, ale nepošle ho. */
        nasucho: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    await pripravPristupy();

    const stav = ephStav();
    if (!stav.pripravene) throw new Error(`Pošta nie je nastavená: ${stav.detail}`);
    if (!odosielatel()) throw new Error("V nastavení pošty chýba adresa odosielateľa.");

    const { data: rows, error } = await supabaseAdmin
      .from("orders")
      .select(
        "id, status, delivery_method, delivery_name, delivery_street, delivery_city, delivery_zip, posted_at, customer_email, customer_phone, payment_vs",
      )
      .in("id", data.order_ids);
    if (error) throw new Error(error.message);

    // Radšej sa zastaviť, než poslať polovicu. Keby sa chybné riadky len
    // preskočili, obsluha by si myslela, že odišlo všetko vybrané.
    for (const r of rows || []) {
      if (r.delivery_method !== "posta") {
        throw new Error(`Objednávka ${r.id.slice(0, 8)} nemá doručenie poštou.`);
      }
      if (r.status !== "paid") {
        throw new Error(`Objednávka ${r.id.slice(0, 8)} nie je zaplatená.`);
      }
      if (r.posted_at) {
        throw new Error(`Objednávka ${r.id.slice(0, 8)} už bola podaná.`);
      }
    }
    if (!rows?.length) throw new Error("Nič na podaj — vybrané objednávky sa nenašli.");

    const zasielky: ZasielkaEph[] = rows.map((r) => ({
      adresat: {
        meno: r.delivery_name,
        ulica: r.delivery_street || "",
        mesto: r.delivery_city || "",
        psc: (r.delivery_zip || "").replace(/\s+/g, ""),
        krajina: "SK",
        email: r.customer_email,
        telefon: r.customer_phone,
      },
      // Naše označenie. Keď sa pri podaji niečo rozsype, podľa tohto sa
      // zásielka priradí k objednávke aj ručne.
      zasielkaId: r.payment_vs ? String(r.payment_vs) : r.id.slice(0, 8).toUpperCase(),
    }));

    if (data.nasucho) {
      return { nasucho: true as const, pocet: zasielky.length, sheetId: null, zasielky };
    }

    let sheetId: string;
    try {
      ({ sheetId } = await importujHarok(zasielky));
    } catch (e) {
      if (e instanceof ChybaPosty) {
        throw new Error(e.chyby.length ? `${e.message} (${e.chyby.join("; ")})` : e.message);
      }
      throw e;
    }

    const teraz = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
      .from("orders")
      .update({ eph_sheet_id: sheetId, posted_at: teraz })
      .in(
        "id",
        rows.map((r) => r.id),
      );
    // Hárok u pošty už je. Keby sa zápis nepodaril, nesmieme mlčať —
    // inak by sa tie isté zásielky podali druhýkrát.
    if (updErr) {
      throw new Error(
        `Pošta hárok ${sheetId} prijala, ale zápis do objednávok zlyhal: ${updErr.message}.` +
          " Zapíš číslo hárku ručne, inak sa zásielky podajú dvakrát.",
      );
    }

    return { nasucho: false as const, pocet: zasielky.length, sheetId, zasielky: [] };
  });

/**
 * Dopýta sa pošty na podacie čísla z hárku a doplní ich k objednávkam.
 *
 * Pošta ich prideľuje až pri spracovaní, takže hneď po importe ešte nie sú.
 * Priraďujú sa podľa nášho označenia zásielky (`zasielkaId`), nie podľa
 * poradia — poradie v odpovedi nie je nikde zaručené.
 */
export const dopytajPodacieCisla = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ sheet_id: z.string().min(1).max(60) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    await pripravPristupy();

    const { stav, xml } = await harok(data.sheet_id);

    // Z odpovede vyberáme páry „naše označenie → podacie číslo". Robí sa to
    // regulárnym výrazom nad XML, nie parserom: ide o dva prvky v známom
    // tvare a ďalšia závislosť by sa za to neoplatila.
    const pary: Array<{ oznacenie: string; kod: string }> = [];
    const bloky = xml.split(/<[\w.-]*:?Zasielka>/).slice(1);
    for (const b of bloky) {
      const oznacenie = b.match(/<[\w.-]*:?ZasielkaID>([^<]*)</)?.[1]?.trim();
      const kod = b.match(/<[\w.-]*:?CiarovyKod>([^<]*)</)?.[1]?.trim();
      if (oznacenie && kod) pary.push({ oznacenie, kod });
    }

    let doplnene = 0;
    for (const p of pary) {
      const { data: najdene } = await supabaseAdmin
        .from("orders")
        .select("id, payment_vs")
        .eq("eph_sheet_id", data.sheet_id)
        .is("eph_code", null);
      const riadok = (najdene || []).find(
        (r) =>
          String(r.payment_vs ?? "") === p.oznacenie ||
          r.id.slice(0, 8).toUpperCase() === p.oznacenie,
      );
      if (!riadok) continue;
      const { error } = await supabaseAdmin
        .from("orders")
        .update({ eph_code: p.kod })
        .eq("id", riadok.id);
      if (!error) doplnene += 1;
    }

    return { stav, najdenych: pary.length, doplnene };
  });

/**
 * Adresné štítky na obálky ako PDF.
 *
 * Tlačia sa ešte pred podajom — hárok sa dá vytvoriť až keď sú obálky
 * zalepené a popísané, lehota na podaj je od vytvorenia hárku desať dní.
 */
export const stitkyZasielok = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ order_ids: z.array(z.string().uuid()).min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    await pripravPristupy();

    const od = odosielatel();
    if (!od) throw new Error("V nastavení pošty chýba adresa odosielateľa.");

    const { data: rows, error } = await supabaseAdmin
      .from("orders")
      .select(
        "id, delivery_name, delivery_street, delivery_city, delivery_zip, eph_code, payment_vs",
      )
      .in("id", data.order_ids)
      .eq("delivery_method", "posta");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Nič na tlač — vybrané objednávky sa nenašli.");

    const { stitkyPdf } = await import("./stitky.server");
    const pdf = stitkyPdf(
      rows.map((r) => ({
        adresat: {
          meno: r.delivery_name || "",
          ulica: r.delivery_street || "",
          mesto: r.delivery_city || "",
          psc: r.delivery_zip || "",
        },
        oznacenie: r.payment_vs ? String(r.payment_vs) : r.id.slice(0, 8).toUpperCase(),
        podacieCislo: r.eph_code,
      })),
      od,
    );
    return { pdf, pocet: rows.length };
  });
